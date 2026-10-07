import "server-only";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import { ETHEREUM_ROUTING_FEE_BOUNDARY_V1, validateEthereumFeeClassificationV1, type EthereumFeeClassificationV1 } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import { metadataMatchesRouterEntryV1, readProductionFinalizedCustomLaunchMetadataFeedV1,
  type FinalizedCustomLaunchMetadataFeedV1 } from "./finalized-custom-launch-metadata-feed-v1";

/** The reviewed boundary precedes all profile 3.6 authorizations. Older stamps
 * retain their original route; newer stamps require explicit API classification.
 * Missing data never becomes a zero-fee authorization. */
export async function readEthereumFeeClassificationV1(entry: CanonicalTokenExploreEntry,
  readFeed: () => Promise<FinalizedCustomLaunchMetadataFeedV1> = readProductionFinalizedCustomLaunchMetadataFeedV1,
): Promise<EthereumFeeClassificationV1 | undefined> {
  const stamp = entry.launchStampProvenance;
  if (!stamp || stamp.chainId !== 1 || stamp.kind !== "custom-graph") throw new TypeError("Ethereum launch stamp required");
  if (BigInt(stamp.blockNumber) <= BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber)) return undefined;
  const matches = (await readFeed()).launches.filter(row => row.routerLaunchId.toLowerCase() === stamp.launchId.toLowerCase());
  if (matches.length !== 1 || !metadataMatchesRouterEntryV1(matches[0]!, entry)) {
    throw new TypeError("Ethereum launch fee classification is not available yet");
  }
  const metadata = matches[0]!;
  return validateEthereumFeeClassificationV1({ launchId: stamp.launchId, stampHash: stamp.stampHash,
    profileVersion: metadata.launchProfileVersion, routingFeePolicy: metadata.routingFeePolicy ?? null }, stamp);
}
