import type { Address, Hex } from "viem";
import type { ModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";
import { foundationDataDigest, hashFoundationModuleManifestV1,
  type FoundationModuleManifestV1 } from "./manifest";
import type { FoundationReleaseReferenceV1 } from "./catalog";

export const FOUNDATION_OWNER_PUBLICATION_V1 = "programmable.module-foundation.owner-publication.v1" as const;
export const FOUNDATION_OWNER_CATALOG_V1 = "programmable.module-foundation.owner-catalog.v1" as const;
export const FOUNDATION_OWNER_CATALOG_PATH = "module-foundation/owner-catalog-v1.json";
export interface FoundationOwnerReferenceV1 {
  schemaVersion: typeof FOUNDATION_OWNER_PUBLICATION_V1;
  publicationDigest: Hex; publisher: Address; requestDigest: Hex; sourceManifestHash: Hex; manifestHash: Hex;
}
export interface FoundationOwnerPublicationV1 {
  schemaVersion: typeof FOUNDATION_OWNER_PUBLICATION_V1;
  publisher: Address; sourceCommit: string | null; publishedAt: string; protocolReleaseDigest: Hex;
  source: ModuleSubmissionRequest; manifest: FoundationModuleManifestV1; release: FoundationReleaseReferenceV1;
  deployment: { transactionHash: Hex; blockNumber: string; creationCodeHash: Hex };
  tests: { command: string[]; reportHash: Hex; completedAt: string; success: true };
  publicationDigest: Hex; signature: Hex;
}
export function foundationOwnerDigestV1(value: Omit<FoundationOwnerPublicationV1, "publicationDigest" | "signature">): Hex {
  return foundationDataDigest(FOUNDATION_OWNER_PUBLICATION_V1, value);
}
export function foundationOwnerSigningMessageV1(digest: Hex): string { return `Programmable module publication\n${digest}`; }
export function foundationOwnerReferenceV1(publication: FoundationOwnerPublicationV1): FoundationOwnerReferenceV1 {
  return { schemaVersion: FOUNDATION_OWNER_PUBLICATION_V1, publicationDigest: publication.publicationDigest,
    publisher: publication.publisher, requestDigest: publication.manifest.requestDigest,
    sourceManifestHash: foundationDataDigest("programmable.modules.source-manifest.v1", publication.manifest.sourceDescriptor),
    manifestHash: hashFoundationModuleManifestV1(publication.manifest) };
}
