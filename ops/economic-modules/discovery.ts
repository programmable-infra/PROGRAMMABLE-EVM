import { decodeEventLog, getAbiItem, getAddress, keccak256, parseAbi, stringToHex, type Address, type Hex, type PublicClient } from "viem";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import { foundationFactoryV2Abi, foundationFactoryV3Abi } from "@/lib/module-foundation/abi";
import { foundationActionRuntimeAbiV1 } from "@/lib/module-foundation/action-runtime";
import { discoverFoundationLaunch, FOUNDATION_DISCOVERY_MAX_BLOCKS } from "@/lib/module-foundation/discovery";
import { hashFoundationModuleDescriptorV1 } from "@/lib/module-foundation/manifest";
import { foundationBindingChainId } from "@/lib/module-foundation/chains";
import type { FoundationDeploymentBinding } from "@/lib/module-foundation/protocol";

const stampAbi = parseAbi([
  "event ProgrammableLaunchStampedV1(bytes32 indexed launchId,address indexed token,address indexed hook,address poolManager,bytes32 poolId,bytes32 stampHash)",
  "event ProgrammableComponentStampedV1(bytes32 indexed launchId,address indexed component,uint8 indexed kind,bytes32 runtimeCodeHash)",
]);
const stamp = getAbiItem({ abi: stampAbi, name: "ProgrammableLaunchStampedV1" });
const launched = getAbiItem({ abi: foundationFactoryV3Abi, name: "FoundationLaunchedV3" });
const launchedV2 = getAbiItem({ abi: foundationFactoryV2Abi, name: "FoundationLaunchedV2" });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
export const ECONOMIC_AUTOMATIC_FAMILIES = ["buyback-burn", "dip-buyback", "lp-rewards", "full-range-lp", "buyer-rewards", "nth-buy-pot", "king-of-the-hill"] as const;
export const ECONOMIC_DISCOVERY_MAX_BLOCKS = FOUNDATION_DISCOVERY_MAX_BLOCKS;
export interface AutomaticModuleAdmission {
  family: typeof ECONOMIC_AUTOMATIC_FAMILIES[number]; factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; descriptorHash: Hex;
}
export interface EconomicTarget {
  family: AutomaticModuleAdmission["family"]; host: Address; module: Address; index: number;
  runtimeHash: Hex; configurationHash: Hex; deployedBlock: string; deploymentBlockHash: Hex; transactionHash: Hex;
}
export interface DiscoveryPosition { block: string; logIndex: number; blockHash?: Hex }
interface Candidate { token: Address; transactionHash: Hex; blockNumber: bigint; blockHash: Hex; logIndex: number; launchId?: Hex }

async function targetsForCandidate(client: PublicClient, original: FoundationDeploymentBinding, candidate: Candidate,
  admissions: readonly AutomaticModuleAdmission[]): Promise<EconomicTarget[]> {
  let binding = original;
  if (binding.ethereumGraph) {
    const receipt = await client.getTransactionReceipt({ hash: candidate.transactionHash });
    if (receipt.status !== "success" || !same(receipt.blockHash, candidate.blockHash)) throw Error("The stamped launch was reorganized.");
    const components = receipt.logs.flatMap(log => {
      if (!same(log.address, ethereum.canonicalStamp.router.address)) return [];
      try { return [decodeEventLog({ abi: stampAbi, eventName: "ProgrammableComponentStampedV1", data: log.data, topics: log.topics, strict: true }).args]; }
      catch { return []; }
    }).filter(component => component.launchId === candidate.launchId && component.kind === 0
      && same(component.runtimeCodeHash, binding.ethereumGraph!.proxyRuntimeCodeHash));
    if (!components.length) return []; // A canonical Custom Hook launch can use another engine.
    if (components.length !== 1) throw Error("Ambiguous module engine in the launch stamp.");
    binding = { ...binding, factory: { address: getAddress(components[0].component), runtimeCodeHash: binding.ethereumGraph.proxyRuntimeCodeHash } };
  }
  const launch = await discoverFoundationLaunch({ client, binding, token: candidate.token, transactionHash: candidate.transactionHash });
  if (launch.checkpoint.blockNumber !== candidate.blockNumber || !same(launch.checkpoint.blockHash, candidate.blockHash)) {
    throw Error("The discovered launch differs from its canonical event.");
  }
  const host = launch.receipt.event.hook;
  const targets: EconomicTarget[] = [];
  for (let index = 0; index < launch.moduleSelections.length; index++) {
    const selection = launch.moduleSelections[index];
    const admitted = admissions.find(item => same(item.factory, selection.factory)
      && same(item.factoryCodeHash, selection.factoryCodeHash) && same(item.moduleCodeHash, selection.moduleCodeHash)
      && same(item.descriptorHash, selection.descriptorHash));
    if (!admitted) continue;
    const blockNumber = launch.observedAt.blockNumber;
    const bound = await client.readContract({ address: host, abi: foundationActionRuntimeAbiV1, functionName: "moduleAt", args: [BigInt(index)], blockNumber });
    const code = await client.getCode({ address: bound.instance, blockNumber });
    if (!code || !same(keccak256(code), admitted.moduleCodeHash) || !same(bound.codeHash, admitted.moduleCodeHash)
      || !same(bound.configurationHash, keccak256(selection.configuration))
      || !same(hashFoundationModuleDescriptorV1(bound.descriptor), admitted.descriptorHash)
      || bound.descriptor.moduleId !== keccak256(stringToHex(`programmable.foundation.${admitted.family}.v1`))) {
      throw Error("The module instance differs from the admitted source and launch settings.");
    }
    targets.push({ family: admitted.family, host, module: getAddress(bound.instance), index, runtimeHash: admitted.moduleCodeHash,
      configurationHash: bound.configurationHash, deployedBlock: candidate.blockNumber.toString(),
      deploymentBlockHash: candidate.blockHash, transactionHash: candidate.transactionHash });
  }
  return targets;
}

/** One bounded forward page from canonical launch emitters. Both providers must
 * agree before registration; a website list or a forged ModuleBound log is never authority. */
export async function discoverEconomicTargets(input: {
  clients: readonly [PublicClient, PublicClient]; binding: FoundationDeploymentBinding;
  admissions: readonly AutomaticModuleAdmission[]; position: DiscoveryPosition; toBlock: bigint; maxLaunches?: number;
}) {
  const { clients, binding, admissions, position, toBlock } = input;
  const maxLaunches = input.maxLaunches ?? 8;
  const chainId = foundationBindingChainId(binding), fromBlock = BigInt(position.block);
  if (!["v2", "v3"].includes(binding.factoryVersion ?? "") || fromBlock < binding.startBlock || toBlock < fromBlock || toBlock - fromBlock >= ECONOMIC_DISCOVERY_MAX_BLOCKS
    || !Number.isSafeInteger(position.logIndex) || position.logIndex < -1 || admissions.length > 128
    || !Number.isInteger(maxLaunches) || maxLaunches < 1 || maxLaunches > 8
    || admissions.some(item => !ECONOMIC_AUTOMATIC_FAMILIES.includes(item.family))) throw Error("Invalid discovery window or admission.");
  if (!(await Promise.all(clients.map(client => client.getChainId()))).every(id => id === chainId)) throw Error("Discovery RPC chain mismatch.");
  const address = binding.ethereumGraph ? getAddress(ethereum.canonicalStamp.router.address) : binding.factory.address;
  const expectedCode = binding.ethereumGraph ? ethereum.canonicalStamp.router.runtimeCodeHash : binding.factory.runtimeCodeHash;
  const pages = await Promise.all(clients.map(async client => {
    const code = await client.getCode({ address, blockNumber: toBlock });
    if (!code || !same(keccak256(code), expectedCode)) throw Error("Canonical launch emitter changed.");
    if (position.blockHash && (await client.getBlock({ blockNumber: fromBlock })).hash !== position.blockHash) {
      throw Error("Discovery cursor was reorganized; rewind before registering more targets.");
    }
    const logs = binding.ethereumGraph
      ? await client.getLogs({ address, event: stamp, fromBlock, toBlock, strict: true })
      : await client.getLogs({ address, event: binding.factoryVersion === "v3" ? launched : launchedV2, fromBlock, toBlock, strict: true });
    if (logs.length > 2000) throw Error("Discovery window is too dense; use a smaller block range.");
    return logs.map(log => {
      if (log.removed || !same(log.address, address) || !log.transactionHash || !log.blockHash
        || log.blockNumber < fromBlock || log.blockNumber > toBlock) throw Error("Invalid launch event.");
      return { token: getAddress(log.args.token), transactionHash: log.transactionHash, blockNumber: log.blockNumber,
        blockHash: log.blockHash, logIndex: log.logIndex, ...("launchId" in log.args ? { launchId: log.args.launchId } : {}) } as Candidate;
    }).filter(log => log.blockNumber > fromBlock || log.logIndex > position.logIndex)
      .sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
  }));
  if (json(pages[0]) !== json(pages[1])) throw Error("Discovery providers disagree.");
  const candidates = pages[0].slice(0, maxLaunches), targets: EconomicTarget[] = [];
  for (const candidate of candidates) {
    const results = await Promise.all(clients.map(client => targetsForCandidate(client, binding, candidate, admissions)));
    if (json(results[0]) !== json(results[1])) throw Error("Module registration providers disagree.");
    targets.push(...results[0]);
  }
  const blocks = await Promise.all(clients.map(client => client.getBlock({ blockNumber: toBlock })));
  if (!blocks[0].hash || blocks[0].hash !== blocks[1].hash) throw Error("Discovery checkpoint changed.");
  const last = candidates.at(-1);
  const next: DiscoveryPosition = pages[0].length > candidates.length && last
    ? { block: last.blockNumber.toString(), logIndex: last.logIndex, blockHash: last.blockHash }
    : { block: toBlock.toString(), logIndex: Number.MAX_SAFE_INTEGER, blockHash: blocks[0].hash };
  return { targets, position: next, processed: candidates.length };
}
