import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { buildFoundationEthereumGraph, assertFoundationEthereumTransaction } from "./ethereum-graph-builder";
import { foundationEthereumFactoryGraphAbi } from "./ethereum-graph-simulation";
import { encodeFoundationParameters, foundationFactoryV3Abi, foundationMetadataParameters, type FoundationLaunchParametersV3 } from "./abi";
import { encodeFoundationFundingPath, type FoundationEthFunding } from "./funding-path";
import { requestEthereumModuleAuthorization } from "./ethereum-authorization";
import { simulateFoundationSequence, type FoundationCheckpoint, type FoundationPreparedStep, type FoundationBalanceCheck, type readFoundationQuote } from "./client";
import { assertFoundationV2Result, foundationV2PositionSpecs, foundationV2PositionCalls, verifyFoundationV2PositionData, type FoundationDeploymentBinding } from "./protocol";
import { parseFoundationStartPrice, type planFoundationStartPrice, type FoundationStartPrice } from "./start-price";
import { assertFoundationNativeBalance } from "./native-funding";
import { foundationPoolId } from "./pool-key";
import type { FoundationAssetPinV1 } from "./assets";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";

export async function prepareFoundationEthereumLaunch(input: {
  client: PublicClient; binding: FoundationDeploymentBinding; account: Address; parameters: FoundationLaunchParametersV3;
  ethFunding?: FoundationEthFunding; slippageBps: number; checkpoint: FoundationCheckpoint;
  price: ReturnType<typeof planFoundationStartPrice>; quote: Awaited<ReturnType<typeof readFoundationQuote>>;
  startPrice: FoundationStartPrice; modulePackageIds: readonly Hex[]; moduleAssetPins: readonly FoundationAssetPinV1[];
  accessToken: () => Promise<string | null>; signal?: AbortSignal;
}) {
  const { client, account, binding, quote, price, startPrice, modulePackageIds, moduleAssetPins, ethFunding, signal } = input;
  const source = binding.ethereumGraph;
  if (!source || getAddress(binding.factory.address) !== getAddress(source.implementation.address)) throw new Error("Choose the current Ethereum launch source.");
  const p = structuredClone(input.parameters), path = ethFunding?.path ?? [], value = ethFunding?.maximumEth ?? 0n;
  const graph = await buildFoundationEthereumGraph({ source, account, parameters: p, fundingPath: path, value, signal });
  p.hookSalt = graph.parameters.hookSalt;
  const router = getAddress(ethereum.canonicalStamp.router.address), factory = getAddress(ethereum.canonicalStamp.graphFactory.address);
  const recordCall = { to: graph.engine, data: encodeFunctionData({ abi: foundationFactoryV3Abi, functionName: "launchOf", args: [graph.token] }) };
  // One read-only quote against the exact fixed graph. Only the simulated Router receives a balance override.
  const unsigned = await client.simulateCalls({ account: router, blockNumber: input.checkpoint.blockNumber,
    stateOverrides: [{ address: router, balance: value }], calls: [
      { to: factory, value, data: encodeFunctionData({ abi: foundationEthereumFactoryGraphAbi, functionName: "deployGraph",
        args: [{ ...graph.identity, graphCommitment: graph.graphCommitment, authorizedLauncher: router, totalValue: value }, graph.targets] }) }, recordCall] });
  if (unsigned.results.length !== 2 || unsigned.results.some(r => r.status !== "success")) throw new Error("The Ethereum module quote could not be simulated.");
  const provisional = decodeFunctionResult({ abi: foundationFactoryV3Abi, functionName: "launchOf", data: unsigned.results[1].data! });
  assertFoundationV2Result(provisional, p);
  if (p.initialBuyQuoteAmount > 0n) {
    p.initialBuyMinimumTokenAmount = provisional.initialBuyTokenAmount * BigInt(10_000 - input.slippageBps) / 10_000n;
    if (p.initialBuyMinimumTokenAmount === 0n) throw new Error("The initial buy is too small.");
  }
  signal?.throwIfAborted();
  const access = await input.accessToken(); if (!access) throw new Error("Connect your wallet to authorize this launch.");
  const authorization = await requestEthereumModuleAuthorization({ schemaVersion: "programmable.ethereum-module-authorization-request.v1", chainId: "1",
    launchWallet: account, releaseDigest: source.releaseDigest, parameters: encodeFoundationParameters(p), fundingPath: encodeFoundationFundingPath(path, 1), valueWei: String(value) }, access, signal);
  const transaction = { from: account, to: authorization.transaction.to, data: authorization.transaction.calldata, value };
  const checked = await assertFoundationEthereumTransaction({ source, transaction, signal });
  if (encodeFoundationParameters(checked.graph.parameters) !== encodeFoundationParameters(p) || checked.graph.token !== graph.token
    || checked.graph.hook !== graph.hook || checked.graph.engine !== graph.engine) throw new Error("The authorized launch settings changed.");
  const block = await client.getBlock({ blockNumber: BigInt(authorization.simulation.blockNumber) });
  if (!block.hash || block.hash !== authorization.simulation.blockHash) throw new Error("The authorization checkpoint changed.");
  const checkpoint = { blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp };
  const step: FoundationPreparedStep = { kind: "launch", label: "Launch coin and pool", transaction, gasUsed: BigInt(authorization.simulation.gasEstimate),
    effect: "Create your coin and pool with the selected modules. Liquidity positions are sent permanently to DEAD.", amount: p.initialBuyQuoteAmount + p.additionalQuoteAmount };
  const checks: FoundationBalanceCheck[] = [{ token: quote.address, account, minimumDelta: 0n },
    { token: graph.token, account, newToken: true, minimumDelta: p.initialBuyMinimumTokenAmount },
    ...moduleAssetPins.map(([token]) => ({ token, account, minimumDelta: 0n }))];
  const first = await simulateFoundationSequence(client, [step], checkpoint, checks, [recordCall]);
  const result = { ...decodeFunctionResult({ abi: foundationFactoryV3Abi, functionName: "launchOf", data: first.postData[0] }), factoryVersion: "v3" as const };
  assertFoundationV2Result(result, p);
  if (getAddress(result.token) !== graph.token || getAddress(result.hook) !== graph.hook || result.poolId !== foundationPoolId(graph.poolKey)
    || result.baseTokenPrincipal !== price.base.principal || result.baseTokenRounding !== price.base.dust
    || result.creatorQuotePrincipal !== (price.creator?.principal ?? 0n) || result.initialBuyTokenAmount !== first.balances[1].delta
    || result.actualQuoteRefund !== first.balances[0].delta) throw new Error("The Ethereum launch balances differ from the selected settings.");
  const specs = foundationV2PositionSpecs(result, quote.address, p.initialTick, { base: price.base.liquidity, creator: price.creator?.liquidity });
  const nftCalls = foundationV2PositionCalls(specs, 1);
  const simulation = await simulateFoundationSequence(client, [step], checkpoint, checks, [recordCall, ...nftCalls]);
  if (simulation.postData[0] !== first.postData[0]) throw new Error("The Ethereum launch result changed during verification.");
  verifyFoundationV2PositionData(specs, result.poolId, simulation.postData.slice(1));
  await assertFoundationNativeBalance(client, account, simulation.steps, checkpoint.blockNumber);
  parseFoundationStartPrice(startPrice, quote);
  const deadline = BigInt(authorization.deadline), priceExpiry = BigInt(startPrice.price.validUntil);
  return { kind: "launch" as const, sourceKind: "module-foundation-v1" as const, account, binding, checkpoint,
    expiresAt: priceExpiry < deadline ? priceExpiry : deadline, quote, ethFunding, parameters: p, result,
    factoryVersion: result.factoryVersion, price, startPrice, poolKey: graph.poolKey, modulePackageIds, moduleAssetPins,
    balanceChecks: checks, metadataHash: keccak256(encodeAbiParameters(foundationMetadataParameters, [p.metadata])),
    steps: simulation.steps, balances: simulation.balances, simulation: "rpc-sequence" as const };
}
