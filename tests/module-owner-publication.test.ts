import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, type PublicClient } from "viem";
import frozen from "./fixtures/module-foundation-review.json";
import { validateModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";
import { createFoundationModuleManifestV1, foundationDataDigest, hashFoundationModuleManifestV1, readFoundationPackageExtensionV1 } from "@/lib/module-foundation/manifest";
import { FOUNDATION_OWNER_PUBLICATION_V1, foundationOwnerDigestV1, foundationOwnerReferenceV1, foundationOwnerSigningMessageV1 } from "@/lib/module-foundation/owner-publication";
import { verifyFoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-verification";
import { verifyFoundationOwnerRuntimeV1 } from "@/lib/module-foundation/owner-runtime";
import { bindFoundationCatalogV1, FOUNDATION_CATALOG_SCHEMA_V1 } from "@/lib/module-foundation/catalog";
import { verifySharedActivation } from "@/ops/module-owner-publication/shared";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`), hash = (value: string) => keccak256(toHex(value));
async function fixture(chainId: 1 | 4663 = 4663) {
  const source = validateModuleSubmissionRequest(frozen.module.source);
  if (!source.ok) throw Error("fixture");
  const manifest = createFoundationModuleManifestV1(source.request.descriptor, source.requestDigest);
  const extension = readFoundationPackageExtensionV1(manifest), code = "0x6000" as const;
  const contents = { schemaVersion: FOUNDATION_OWNER_PUBLICATION_V1, publisher: account.address,
    sourceCommit: "a".repeat(40), publishedAt: "2026-10-02T00:00:00.000Z", protocolReleaseDigest: hash("host"),
    source: source.request, manifest,
    release: { chainId, hostAdapterId: extension.hostAdapterId, manifestHash: hashFoundationModuleManifestV1(manifest),
      releaseDigest: hash("release"), deploymentEvidenceDigest: hash("deployment"), runtimeVerificationDigest: hash("runtime"),
      factory: account.address, factoryCodeHash: keccak256(code), moduleCodeHash: hash("module"), descriptorHash: extension.descriptorHash },
    deployment: { transactionHash: hash("transaction"), blockNumber: "100", creationCodeHash: keccak256(code) },
    tests: { command: ["module-tests"], reportHash: foundationDataDigest("report", "passed"), completedAt: "2026-10-02T00:00:00.000Z", success: true as const } };
  const publicationDigest = foundationOwnerDigestV1(contents);
  return { ...contents, publicationDigest, signature: await account.signMessage({ message: foundationOwnerSigningMessageV1(publicationDigest) }) };
}
describe("direct owner module publication", () => {
  it("admits a newly signed module on both live hosts without editing the seeded host release", async () => {
    const publications = await Promise.all([fixture(1), fixture(4663)]);
    const readLive = vi.fn(async (url: string | URL | Request) => Response.json({
      available: true, chainId: Number(new URL(String(url)).searchParams.get("chainId")), binding: { releaseDigest: hash("host") },
    }));
    await expect(verifySharedActivation(publications, [account.address.toLowerCase()], readLive)).resolves.toBeUndefined();
    expect(readLive).toHaveBeenCalledTimes(2);
    await expect(verifySharedActivation(publications, [], readLive)).rejects.toThrow();
  });
  it("keeps partial, mixed-source and stale-host releases inactive", async () => {
    const publications = await Promise.all([fixture(1), fixture(4663)]);
    const inactive = vi.fn(async () => Response.json({ available: false }));
    await expect(verifySharedActivation(publications.slice(0, 1), [account.address.toLowerCase()], inactive)).rejects.toThrow("Both networks");
    await expect(verifySharedActivation([publications[0], { ...publications[1], manifest: { ...publications[1].manifest, requestDigest: hash("different") } }],
      [account.address.toLowerCase()], inactive)).rejects.toThrow("identical source");
    expect(inactive).not.toHaveBeenCalled();
    await expect(verifySharedActivation(publications, [account.address.toLowerCase()], inactive)).rejects.toThrow("live target host");
    const stale = vi.fn(async (url: string | URL | Request) => Response.json({
      available: true, chainId: Number(new URL(String(url)).searchParams.get("chainId")), binding: { releaseDigest: hash("previous-host") },
    }));
    await expect(verifySharedActivation(publications, [account.address.toLowerCase()], stale)).rejects.toThrow("live target host");
  });
  it.each([1, 4663] as const)("makes signed source selectable through owner authority, without a contributor submission or DB review on chain %i", async chainId => {
    const p = await verifyFoundationOwnerPublicationV1(await fixture(chainId), [account.address.toLowerCase()]);
    const review = foundationOwnerReferenceV1(p), document = { schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries: [{ manifest: p.manifest, review, release: p.release }] };
    expect(bindFoundationCatalogV1(document).entries[0].status).toBe("authority_unverified");
    expect(bindFoundationCatalogV1(document, { admissions: [review], releases: [p.release] }).entries[0].status).toBe("available");
  });
  it("rejects an unauthorized publisher, modified source, runtime and test result", async () => {
    const p = await fixture();
    await expect(verifyFoundationOwnerPublicationV1(p, [])).rejects.toThrow();
    for (const change of [
      { source: { ...p.source, files: [] } }, { release: { ...p.release, factory: "0x0000000000000000000000000000000000000001" } },
      { tests: { ...p.tests, success: false } }, { release: { ...p.release, chainId: 1 } }, { signature: `0x${"00".repeat(65)}` },
    ]) await expect(verifyFoundationOwnerPublicationV1({ ...p, ...change }, [account.address.toLowerCase()])).rejects.toThrow();
  });
  it("checks the actual deployment and rejects a mismatched factory or reorg", async () => {
    const p = await fixture(), blockHash = hash("block");
    const client = { getChainId: vi.fn(async () => 4663), getCode: vi.fn(async () => "0x6000"),
      getTransactionReceipt: vi.fn(async () => ({ status: "success", contractAddress: p.release.factory, blockNumber: 100n, transactionHash: p.deployment.transactionHash, blockHash })),
      getTransaction: vi.fn(async () => ({ hash: p.deployment.transactionHash, to: null, value: 0n, input: "0x6000", blockHash })),
      getBlock: vi.fn(async () => ({ hash: blockHash })) };
    await expect(Promise.all([verifyFoundationOwnerRuntimeV1(p, client as unknown as PublicClient),
      verifyFoundationOwnerRuntimeV1(p, client as unknown as PublicClient)])).resolves.toEqual([undefined, undefined]);
    expect(client.getChainId).toHaveBeenCalledTimes(1);
    expect(client.getCode).toHaveBeenCalledTimes(1);
    client.getCode.mockResolvedValueOnce("0x6001");
    await expect(verifyFoundationOwnerRuntimeV1(p, client as unknown as PublicClient)).rejects.toThrow();
    client.getBlock.mockResolvedValueOnce({ hash: hash("reorg") });
    await expect(verifyFoundationOwnerRuntimeV1(p, client as unknown as PublicClient)).rejects.toThrow();
  });
  it("requires Ethereum runtime and deployment finality for an Ethereum owner release", async () => {
    const p = await fixture(1), blockHash = hash("ethereum-block");
    const client = { getChainId: vi.fn(async () => 1), getCode: vi.fn(async () => "0x6000"),
      getBlockNumber: vi.fn(async () => 163n),
      getTransactionReceipt: vi.fn(async () => ({ status: "success", contractAddress: p.release.factory, blockNumber: 100n, transactionHash: p.deployment.transactionHash, blockHash })),
      getTransaction: vi.fn(async () => ({ chainId: 1, hash: p.deployment.transactionHash, to: null, value: 0n, input: "0x6000", blockHash })),
      getBlock: vi.fn(async ({ blockTag }: { blockTag?: string }) => ({ number: blockTag === "finalized" ? 99n : 100n, hash: blockHash })) };
    await expect(verifyFoundationOwnerRuntimeV1(p, client as unknown as PublicClient)).resolves.toBeUndefined();
    expect(client.getBlock).not.toHaveBeenCalledWith({ blockTag: "finalized" });
    client.getBlockNumber.mockResolvedValue(110n);
    await expect(verifyFoundationOwnerRuntimeV1(p, client as unknown as PublicClient)).rejects.toThrow("waiting for Ethereum finality");
    client.getChainId.mockResolvedValue(4663);
    await expect(verifyFoundationOwnerRuntimeV1(p, client as unknown as PublicClient)).rejects.toThrow("network differs");
  });
});
