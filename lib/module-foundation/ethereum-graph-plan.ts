import {
  concatHex, encodeAbiParameters, encodeFunctionData, getAddress, getContractAddress,
  keccak256, parseAbiParameters, stringToHex, type Address, type Hex,
} from "viem";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import type { FoundationPoolKey } from "./pool-key";
import { foundationEthereumRouteParameters, foundationEthereumStampAbi } from "./ethereum-graph";

const hash = (text: string) => keccak256(stringToHex(text));
const factory = getAddress(ethereum.canonicalStamp.graphFactory.address);
const router = getAddress(ethereum.canonicalStamp.router.address);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nonzero = (value: Hex) => /^0x[0-9a-f]{64}$/i.test(value) && BigInt(value) !== 0n;
const fail = (): never => { throw new Error("The Ethereum module graph does not match its exact launch plan."); };
const types = {
  salt: hash("ProgrammableCreate2GraphTargetSaltV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 targetIdHash,bytes32 applicantSalt,address authorizedLauncher)"),
  target: hash("ProgrammableCreate2GraphTargetCommitmentV1(uint256 targetIndex,bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes32 initCodeHash,bytes32 initializerCalldataHash)"),
  graph: hash("ProgrammableCreate2GraphCommitmentV1(uint256 chainId,address factory,bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,address authorizedLauncher,uint256 totalValue,bytes32 targetCommitmentsHash)"),
  accumulator: hash("ProgrammableCreate2GraphDeploymentAccumulatorV1(bytes32 previous,uint256 targetIndex,bytes32 targetIdHash,address deployment,bytes32 effectiveSalt,bytes32 initCodeHash,bytes32 initializerCalldataHash,bytes32 runtimeCodeHash,uint256 deploymentValue,uint256 initializerValue)"),
  output: hash("ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"),
  result: hash("ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)"),
  component: hash("ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)"),
  pool: hash("ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"),
  stamp: hash("ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)"),
};

export interface FoundationEthereumGraphTarget {
  targetIdHash: Hex; applicantSalt: Hex; deploymentValue: bigint; initializerValue: bigint;
  initCode: Hex; initializerCalldata: Hex;
}
export interface FoundationEthereumGraphIdentity {
  routeNamespace: Hex; routeNonce: Hex; topologyHash: Hex;
}
export interface FoundationEthereumGraphOutput {
  targetIndex: number; targetIdHash: Hex; account: Address; runtimeCodeHash: Hex;
}

/** Salt domain is identical to the existing Ethereum Graph Factory. No RPC per mining attempt. */
export function foundationEthereumTargetSalt(identity: FoundationEthereumGraphIdentity, target: Pick<FoundationEthereumGraphTarget, "targetIdHash" | "applicantSalt">): Hex {
  if (![identity.routeNamespace, identity.routeNonce, identity.topologyHash, target.targetIdHash].every(nonzero)) fail();
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,bytes32,bytes32,bytes32,bytes32,address"),
    [types.salt, 1n, factory, identity.routeNamespace, identity.routeNonce, target.targetIdHash, target.applicantSalt, router]));
}

export function predictFoundationEthereumTarget(identity: FoundationEthereumGraphIdentity, target: FoundationEthereumGraphTarget): Address {
  return getContractAddress({ opcode: "CREATE2", from: factory,
    salt: foundationEthereumTargetSalt(identity, target), bytecodeHash: keccak256(target.initCode) });
}

export function foundationEthereumGraphCommitment(identity: FoundationEthereumGraphIdentity, targets: readonly FoundationEthereumGraphTarget[]) {
  if (targets.length !== 3 || ![identity.routeNamespace, identity.routeNonce, identity.topologyHash].every(nonzero)) fail();
  let totalValue = 0n, totalBytes = 0;
  const addresses = new Set<string>();
  const commitments = targets.map((target, index) => {
    if (!same(target.targetIdHash, hash(["engine", "token", "hook"][index])) || target.deploymentValue !== 0n
      || target.initializerValue < 0n || (index > 0 && (target.initializerValue !== 0n || target.initializerCalldata !== "0x"))
      || (index === 0 && target.initializerCalldata === "0x")
      || !/^0x(?:[0-9a-f]{2})+$/i.test(target.initCode) || target.initCode.length > 49_152 * 2 + 2
      || !/^0x(?:[0-9a-f]{2})*$/i.test(target.initializerCalldata) || target.initializerCalldata.length > 131_072 * 2 + 2) fail();
    const address = predictFoundationEthereumTarget(identity, target);
    if (addresses.has(address)) fail(); addresses.add(address);
    totalValue += target.initializerValue;
    totalBytes += (target.initCode.length + target.initializerCalldata.length - 4) / 2;
    return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,bytes32,bytes32,uint256,uint256,bytes32,bytes32"),
      [types.target, BigInt(index), target.targetIdHash, target.applicantSalt, target.deploymentValue,
        target.initializerValue, keccak256(target.initCode), keccak256(target.initializerCalldata)]));
  });
  if (totalBytes > 524_288 || totalValue > (1n << 127n) - 1n) fail();
  const graphCommitment = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,bytes32,bytes32,bytes32,address,uint256,bytes32"),
    [types.graph, 1n, factory, identity.routeNamespace, identity.routeNonce, identity.topologyHash, router, totalValue,
      keccak256(encodeAbiParameters(parseAbiParameters("bytes32[]"), [commitments]))]));
  return { graphCommitment, totalValue };
}

/** Pure encoding only. Runtime hashes must come from source-bound graph simulation. */
export function prepareFoundationEthereumStamp(input: {
  identity: FoundationEthereumGraphIdentity; targets: readonly FoundationEthereumGraphTarget[];
  outputs: readonly FoundationEthereumGraphOutput[]; launchId: Hex; account: Address;
  poolKey: FoundationPoolKey; validAfter: bigint; deadline: bigint;
}) {
  const { identity, targets, outputs } = input;
  const { graphCommitment, totalValue } = foundationEthereumGraphCommitment(identity, targets);
  if (!nonzero(input.launchId) || BigInt(getAddress(input.account)) === 0n || outputs.length !== 3
    || input.validAfter < 0n || input.deadline <= input.validAfter || input.deadline - input.validAfter > 3_600n
    || input.deadline > (1n << 64n) - 1n) fail();
  let graphDeploymentHash = graphCommitment;
  const outputHashes = outputs.map((output, index) => {
    const target = targets[index];
    if (output.targetIndex !== index || !same(output.targetIdHash, target.targetIdHash) || !nonzero(output.runtimeCodeHash)
      || !same(output.account, predictFoundationEthereumTarget(identity, target))) fail();
    graphDeploymentHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,uint256,bytes32,address,bytes32,bytes32,bytes32,bytes32,uint256,uint256"),
      [types.accumulator, graphDeploymentHash, BigInt(index), target.targetIdHash, output.account,
        foundationEthereumTargetSalt(identity, target), keccak256(target.initCode), keccak256(target.initializerCalldata),
        output.runtimeCodeHash, target.deploymentValue, target.initializerValue]));
    return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint8,bytes32,address,bytes32"),
      [types.output, index, output.targetIdHash, output.account, output.runtimeCodeHash]));
  });
  const { poolKey } = input;
  if (!same(poolKey.hooks, outputs[2].account) || poolKey.fee !== 0 || poolKey.tickSpacing !== 60
    || BigInt(poolKey.currency0) >= BigInt(poolKey.currency1)
    || ![poolKey.currency0, poolKey.currency1].some(currency => same(currency, outputs[1].account))) fail();
  const components = outputs.map((output, index) => ({ resultIndex: index, account: output.account,
    runtimeCodeHash: output.runtimeCodeHash, kind: index === 1 ? 1 : index === 2 ? 2 : 0, scope: 1 }))
    .sort((a, b) => BigInt(a.account) < BigInt(b.account) ? -1 : 1);
  const componentSetHash = keccak256(concatHex(components.map(component =>
    keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint8,address,bytes32,uint8,uint8"),
      [types.component, component.resultIndex, component.account, component.runtimeCodeHash, component.kind, component.scope])))));
  const poolKeyHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,address,address,uint24,int24,address"),
    [types.pool, poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]));
  const stamp = { launchId: input.launchId, token: outputs[1].account, tokenRuntimeCodeHash: outputs[1].runtimeCodeHash,
    poolKey, hookRuntimeCodeHash: outputs[2].runtimeCodeHash, components };
  const stampRequestHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,address,bytes32,bytes32,bytes32,bytes32"),
    [types.stamp, stamp.launchId, stamp.token, stamp.tokenRuntimeCodeHash, poolKeyHash, stamp.hookRuntimeCodeHash, componentSetHash]));
  const route = { ...identity, graphCommitment, targets, expectedOutputs: outputs, expectedGraphDeploymentHash: graphDeploymentHash };
  const routePayload = encodeAbiParameters(foundationEthereumRouteParameters, [route]);
  const expectedResultHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32"),
    [types.result, keccak256(concatHex(outputHashes)), graphDeploymentHash]));
  const permit = { chainId: 1n, router, launchWallet: getAddress(input.account), kind: 1,
    routePayloadHash: keccak256(routePayload), expectedResultHash, stampRequestHash, nonce: identity.routeNonce,
    validAfter: input.validAfter, deadline: input.deadline, value: totalValue };
  return { route, routePayload, stamp, permit };
}

/** A prepared plan is not a permit. The canonical Router verifies the real authority signature. */
export function encodeFoundationEthereumStamp(plan: ReturnType<typeof prepareFoundationEthereumStamp>, signature: Hex) {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(signature)) throw new Error("The launch authority has not signed this plan.");
  return { to: router, value: plan.permit.value, data: encodeFunctionData({ abi: foundationEthereumStampAbi,
    functionName: "launchAndStampV1", args: [plan.permit, plan.stamp, plan.routePayload, signature] }) };
}
