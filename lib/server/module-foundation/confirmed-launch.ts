import "server-only";
import { createPublicClient, decodeEventLog, getAddress, http, type Address, type Hex, type PublicClient } from "viem";
import { foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";
import { parseFoundationAvailability } from "@/lib/module-foundation/availability";
import { foundationFactoryV2Abi, foundationFactoryV3Abi } from "@/lib/module-foundation/abi";
import { decodeFoundationLaunchCall } from "@/lib/module-foundation/atomic-launch";
import { decodeFoundationEthereumTransaction } from "@/lib/module-foundation/ethereum-graph";
import { readFoundationMinedCall } from "@/lib/module-foundation/mined-call";
import { foundationFactoryVersion, type FoundationDeploymentBinding } from "@/lib/module-foundation/protocol";
import { verifyFoundationLaunchReceipt } from "@/lib/module-foundation/readback";
import { foundationMetadataLinks } from "@/lib/module-foundation/ui-readback";
import type { RecentFoundationLaunch } from "@/lib/module-foundation/recent-launches";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import { readFoundationAvailabilityResponse } from "./availability";
import { foundationMainnetReadClient, foundationMainnetRpcs } from "./rpc";

export type ConfirmedLaunchRequest = { chainId: FoundationChainId; token: Address; transactionHash: Hex };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function confirmedLaunchClients(chainId: FoundationChainId): readonly PublicClient[] {
  if (chainId === 1) return foundationMainnetRpcs().map(foundationMainnetReadClient) as PublicClient[];
  const profile = foundationChainProfile(chainId);
  const urls = [process.env.ROBINHOOD_RPC_URL?.trim() || profile.publicRpcUrls[0],
    process.env.ROBINHOOD_RPC_SECONDARY_URL?.trim() || profile.publicRpcUrls[1]].map(value => new URL(value));
  if (urls.some(url => url.protocol !== "https:" || url.username || url.password) || urls[0].hostname === urls[1].hostname) {
    throw new Error("Independent launch providers are required.");
  }
  return urls.map(url => createPublicClient({ chain: profile.chain,
    transport: http(url.href, { retryCount: 0, timeout: 8_000, batch: { wait: 10 } }) })) as PublicClient[];
}

async function confirmWithClient(input: ConfirmedLaunchRequest, binding: FoundationDeploymentBinding, client: PublicClient) {
  if (await client.getChainId() !== input.chainId) throw new Error("Launch provider network mismatch.");
  const [receipt, mined] = await Promise.all([client.getTransactionReceipt({ hash: input.transactionHash }),
    client.getTransaction({ hash: input.transactionHash })]);
  if (receipt.status !== "success" || !mined.to || mined.input.length > 1_048_578
    || receipt.blockNumber < binding.startBlock) throw new Error("The launch is not confirmed.");
  const version = foundationFactoryVersion(binding);
  if (version === "v1") throw new Error("This launch version uses the historical index.");
  const events = receipt.logs.flatMap(log => {
    if (!binding.ethereumGraph && !same(log.address, binding.factory.address)) return [];
    try {
      const event = version === "v3"
        ? decodeEventLog({ abi: foundationFactoryV3Abi, eventName: "FoundationLaunchedV3", data: log.data, topics: log.topics, strict: true }).args
        : decodeEventLog({ abi: foundationFactoryV2Abi, eventName: "FoundationLaunchedV2", data: log.data, topics: log.topics, strict: true }).args;
      return same(event.token, input.token) ? [{ event, address: log.address }] : [];
    } catch { return []; }
  });
  if (events.length !== 1) throw new Error("The receipt does not identify one module launch.");
  const { event, address } = events[0];
  const transaction = binding.ethereumGraph ? await readFoundationMinedCall(client, mined, {
    account: event.creator, target: getAddress(ethereum.canonicalStamp.router.address),
    accepts(call) { try { return same(decodeFoundationEthereumTransaction(call).token, input.token); } catch { return false; } },
  }) : { from: mined.from, to: mined.to, data: mined.input, value: mined.value };
  if (binding.ethereumGraph) {
    const graph = decodeFoundationEthereumTransaction(transaction);
    if (!same(graph.engine, address)) throw new Error("The launch emitter differs from its source.");
    binding = { ...binding, factory: { address: graph.engine, runtimeCodeHash: binding.ethereumGraph.proxyRuntimeCodeHash } };
  }
  const { parameters } = decodeFoundationLaunchCall(binding, transaction);
  const verified = await verifyFoundationLaunchReceipt({ client, binding, transactionHash: input.transactionHash,
    expected: { transaction, parameters, result: event.result, metadataHash: event.metadataHash } });
  const details = verified.details;
  const row: RecentFoundationLaunch["row"] = {
    sourceKind: "module-foundation-v1", sourceAddress: binding.factory.address, sourceReleaseDigest: binding.releaseDigest,
    factoryVersion: version, routerAddress: null, stampHash: null, launchId: event.poolId, tokenAddress: input.token,
    hookAddress: event.hook, creator: event.creator, poolManager: foundationChainProfile(input.chainId).infrastructure.poolManager.address,
    poolId: event.poolId, quoteAsset: event.quote, quoteSymbol: details.quote.symbol, feeLedgerAddress: event.ledger,
    metadataHash: event.metadataHash, compositionHash: event.compositionHash, transactionHash: input.transactionHash,
    blockNumber: verified.checkpoint.blockNumber.toString(), blockHash: verified.checkpoint.blockHash,
    logIndex: verified.logIndex, launchedAt: new Date(Number(verified.checkpoint.timestamp) * 1_000).toISOString(),
    name: details.token.name, symbol: details.token.symbol, decimals: 18,
  };
  return { chainId: input.chainId, row, presentation: { chainId: input.chainId, tokenAddress: input.token,
    name: row.name!, symbol: row.symbol, imageUrl: details.token.imageURI || null, description: details.token.description || null,
    links: foundationMetadataLinks(details), market: null } };
}

/** Checks inclusion and immutable pool/source identity on both providers, without claiming settlement finality. */
export async function confirmFoundationLaunch(input: ConfirmedLaunchRequest): Promise<RecentFoundationLaunch> {
  const available = parseFoundationAvailability(await readFoundationAvailabilityResponse(fetch, 12_000, undefined, input.chainId));
  if (!available.available || !available.binding) throw new Error("The launch source is unavailable.");
  const results = await Promise.all(confirmedLaunchClients(input.chainId).map(client => confirmWithClient(input, available.binding!, client)));
  if (JSON.stringify(results[0]) !== JSON.stringify(results[1])) throw new Error("Launch providers disagree.");
  return { ...results[0], observedAt: Date.now() };
}
