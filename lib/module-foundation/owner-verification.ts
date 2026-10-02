import { getAddress, recoverMessageAddress, type Hex } from "viem";
import { validateModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";
import { moduleHash, moduleRecord } from "@/lib/module-mode/release";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { createFoundationModuleManifestV1, foundationDataDigest, hashFoundationModuleManifestV1, readFoundationPackageExtensionV1 } from "./manifest";
import { FOUNDATION_OWNER_PUBLICATION_V1, foundationOwnerDigestV1, foundationOwnerSigningMessageV1, type FoundationOwnerPublicationV1 } from "./owner-publication";

/** Owner release authority replaces contributor submission and reviewer approval, without inventing a DB decision. */
export async function verifyFoundationOwnerPublicationV1(value: unknown, publishers: readonly string[]): Promise<FoundationOwnerPublicationV1> {
  const raw = moduleRecord(nativeJson(value), ["schemaVersion", "publisher", "sourceCommit", "publishedAt", "protocolReleaseDigest", "source", "manifest", "release", "deployment", "tests", "publicationDigest", "signature"], "ownerPublication");
  if (raw.schemaVersion !== FOUNDATION_OWNER_PUBLICATION_V1 || typeof raw.publisher !== "string"
    || !publishers.includes(raw.publisher.toLowerCase()) || getAddress(raw.publisher) !== raw.publisher
    || !(raw.sourceCommit === null || typeof raw.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(raw.sourceCommit))
    || typeof raw.publishedAt !== "string" || !Number.isFinite(Date.parse(raw.publishedAt))) throw new Error("Owner publication identity is invalid.");
  const source = validateModuleSubmissionRequest(raw.source);
  if (!source.ok) throw new Error("Owner module source is invalid.");
  const manifest = createFoundationModuleManifestV1(source.request.descriptor, source.requestDigest as Hex);
  if (foundationDataDigest("owner.manifest", raw.manifest) !== foundationDataDigest("owner.manifest", manifest)) throw new Error("Owner source and manifest differ.");
  const extension = readFoundationPackageExtensionV1(manifest);
  const release = moduleRecord(raw.release, ["chainId", "hostAdapterId", "releaseDigest", "manifestHash", "deploymentEvidenceDigest", "runtimeVerificationDigest", "factory", "factoryCodeHash", "moduleCodeHash", "descriptorHash"], "owner.release");
  if (release.chainId !== 4663 || release.hostAdapterId !== extension.hostAdapterId || release.descriptorHash !== extension.descriptorHash
    || release.manifestHash !== hashFoundationModuleManifestV1(manifest) || typeof release.factory !== "string" || BigInt(getAddress(release.factory)) === 0n) throw new Error("Owner module runtime binding differs.");
  for (const field of ["releaseDigest", "manifestHash", "deploymentEvidenceDigest", "runtimeVerificationDigest", "factoryCodeHash", "moduleCodeHash", "descriptorHash"]) moduleHash(release[field], `owner.release.${field}`);
  const deployment = moduleRecord(raw.deployment, ["transactionHash", "blockNumber", "creationCodeHash"], "owner.deployment");
  if (typeof deployment.blockNumber !== "string" || !/^[1-9][0-9]*$/.test(deployment.blockNumber)) throw new Error("Owner deployment block is invalid.");
  moduleHash(deployment.transactionHash, "owner.transaction"); moduleHash(deployment.creationCodeHash, "owner.creationCodeHash");
  const tests = moduleRecord(raw.tests, ["command", "reportHash", "completedAt", "success"], "owner.tests");
  if (tests.success !== true || !Array.isArray(tests.command) || tests.command.length < 1 || tests.command.length > 64
    || !tests.command.every(v => typeof v === "string" && v.length > 0 && v.length < 2048)
    || typeof tests.completedAt !== "string" || !Number.isFinite(Date.parse(tests.completedAt))) throw new Error("Owner module test result is invalid.");
  moduleHash(tests.reportHash, "owner.testReport"); moduleHash(raw.protocolReleaseDigest, "owner.host");
  const { signature, publicationDigest, ...contents } = raw;
  const digest = foundationOwnerDigestV1(contents as unknown as Omit<FoundationOwnerPublicationV1, "publicationDigest" | "signature">);
  if (publicationDigest !== digest || typeof signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(signature)
    || (await recoverMessageAddress({ message: foundationOwnerSigningMessageV1(digest), signature: signature as Hex })).toLowerCase() !== raw.publisher.toLowerCase()) throw new Error("Owner publication signature is invalid.");
  return raw as unknown as FoundationOwnerPublicationV1;
}
