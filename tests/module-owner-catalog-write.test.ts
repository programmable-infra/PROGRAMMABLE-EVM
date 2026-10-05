import { expect, it, vi } from "vitest";
import type { FoundationOwnerPublicationV1 } from "@/lib/module-foundation/owner-publication";

const storage = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), Conflict: class extends Error {} }));
vi.mock("@vercel/blob", () => ({ get: storage.get, put: storage.put, BlobPreconditionFailedError: storage.Conflict }));
vi.mock("@/lib/module-foundation/owner-verification", () => ({ verifyFoundationOwnerPublicationV1: async (p: unknown) => p }));
import { publishCatalog } from "@/ops/module-owner-publication/main";

it("merges concurrent publications after an ETag conflict without losing another module", async () => {
  const record = (id: string) => ({ publicationDigest: id, manifest: { packageId: id }, release: { factory: "factory" }, publisher: "owner" }) as unknown as FoundationOwnerPublicationV1;
  const a = record("a"), b = record("b"), c = record("c");
  const catalog = (publications: FoundationOwnerPublicationV1[], etag: string) => ({ statusCode: 200,
    blob: { etag }, stream: new Response(JSON.stringify({ schemaVersion: "programmable.module-foundation.owner-catalog.v1", publications })).body });
  storage.get.mockResolvedValueOnce(catalog([a], "before"))
    .mockResolvedValueOnce(catalog([a, b], "after"))
    .mockResolvedValueOnce(catalog([a, b, c], "written"));
  storage.put.mockRejectedValueOnce(new storage.Conflict()).mockResolvedValueOnce({});
  const save = vi.fn<(name: string, value: unknown) => Promise<void>>().mockResolvedValue(undefined), log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await publishCatalog(c, "test-storage-token", save);
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(JSON.parse(storage.put.mock.calls[1][1]).publications.map((p: FoundationOwnerPublicationV1) => p.publicationDigest)).toEqual(["a", "b", "c"]);
    expect(storage.put.mock.calls[1][2].ifMatch).toBe("after");
    expect(save.mock.calls.some(call => call[0] === "complete.json")).toBe(true);
  } finally { log.mockRestore(); }
});

it("publishes both chain bindings in one write and rejects partial or mismatched source sets", async () => {
  const { publishCatalogBatch } = await import("@/ops/module-owner-publication/main");
  storage.get.mockReset(); storage.put.mockReset(); storage.put.mockResolvedValue({});
  const record = (chainId: number, digest: string) => ({ publicationDigest: digest, manifest: { packageId: "same-source", requestDigest: "same-request", familyId: "family" },
    release: { chainId, hostAdapterId: "host", factory: `factory-${chainId}` }, publisher: "owner" }) as unknown as FoundationOwnerPublicationV1;
  const targets = [record(1, "eth"), record(4663, "rh")];
  const old = record(1, "old"); old.manifest = { ...old.manifest, packageId: "0x1111" };
  const result = { schemaVersion: "programmable.module-foundation.owner-catalog.v1", publications: [old, ...targets] };
  storage.get.mockResolvedValueOnce({ statusCode: 200, blob: { etag: "before" }, stream: new Response(JSON.stringify({ ...result, publications: [old] })).body })
    .mockResolvedValueOnce({ statusCode: 200, stream: new Response(JSON.stringify(result)).body });
  const save = vi.fn().mockResolvedValue(undefined), log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await expect(publishCatalogBatch([targets[0], { ...targets[1], manifest: { ...targets[1].manifest, requestDigest: "0x2222" } }], "test", save)).rejects.toThrow("identical source");
    expect(storage.put).not.toHaveBeenCalled();
    await publishCatalogBatch(targets, "test", save);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.put.mock.calls[0][1]).publications).toEqual(result.publications);
  } finally { log.mockRestore(); }
});
