import release from "../../config/classic-launch-catalog.v1.json";
import { canonicalSha256 } from "../server/projection-target/hashing";
import type { ClassicLaunchCatalogV1 } from "./classic-launch-catalog.server";

export const CLASSIC_PUBLIC_SNAPSHOT_SCHEMA = "programmable.classic-launch-identity-snapshot.v1";

/** Publish the verified source before any Explore visibility or market-data filters. */
export function classicPublicSnapshot(catalog: ClassicLaunchCatalogV1) {
  const entries = JSON.parse(JSON.stringify(catalog.entries)) as ClassicLaunchCatalogV1["entries"];
  const identity = { chainId: 1, releaseDigest: catalog.evidence.releaseDigest,
    asOfBlock: catalog.asOfBlock, asOfBlockHash: catalog.asOfBlockHash, entries };
  return { schemaVersion: CLASSIC_PUBLIC_SNAPSHOT_SCHEMA, source: catalog.source,
    status: catalog.status, generatedAt: catalog.generatedAt, ...identity,
    finalityConfirmations: release.confirmations, identityCount: entries.length,
    identityCommitment: canonicalSha256(CLASSIC_PUBLIC_SNAPSHOT_SCHEMA, identity),
    evidence: catalog.evidence, release };
}
