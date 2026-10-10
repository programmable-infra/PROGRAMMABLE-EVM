import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const blob = vi.hoisted(() => ({ get: vi.fn(), head: vi.fn(), put: vi.fn() }));
vi.mock("@vercel/blob", () => blob);
import { indexStore } from "@/lib/server/robinhood-index/store";

const etag = `"${"a".repeat(32)}"`;
const snapshot = { version: 1, chainId: 4663, routerAddress: `0x${"1".repeat(40)}`, binding: `0x${"2".repeat(64)}`,
  startBlock: "100", cursor: null, checkpoints: [], finalizedBlock: "100", updatedAt: "2026-10-10T00:00:00.000Z", items: [] };
const body = JSON.stringify(snapshot);
function response(text = body, headers: HeadersInit = {}) {
  return { statusCode: 200, stream: new Response(text).body, headers: new Headers(headers), blob: { etag: `W/${etag}` } };
}
beforeEach(() => { vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN", "test-storage-token"); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("Robinhood index atomic reads", () => {
  it("uses one compressed response and preserves its ETag for a conflicting conditional write", async () => {
    blob.get.mockResolvedValue(response(body, { "content-encoding": "br", "content-length": "80" }));
    blob.head.mockResolvedValue({ etag: `"${"b".repeat(32)}"`, size: body.length + 42 });
    const store = indexStore();
    const saved = await store.read();
    expect(saved).toMatchObject({ etag, snapshot });
    expect(blob.head).not.toHaveBeenCalled();
    blob.put.mockRejectedValue(new Error("Precondition failed"));
    await expect(store.write(saved!.snapshot, saved!.etag)).rejects.toThrow("Precondition failed");
    expect(blob.put.mock.calls[0][2]).toMatchObject({ ifMatch: etag, allowOverwrite: true });
  });
  it("rejects a truncated unencoded response and invalid snapshot contents", async () => {
    blob.get.mockResolvedValueOnce(response(body, { "content-length": String(Buffer.byteLength(body) + 1) }));
    await expect(indexStore().read()).rejects.toThrow("size mismatch");
    blob.get.mockResolvedValueOnce(response(JSON.stringify({ ...snapshot, chainId: 1 })));
    await expect(indexStore().read()).rejects.toThrow("Invalid Robinhood index");
  });
  it("limits decoded bytes even when the compressed transfer declares a small size", async () => {
    blob.get.mockResolvedValue(response(" ".repeat(16 * 1024 * 1024 + 1), { "content-encoding": "br", "content-length": "80" }));
    await expect(indexStore().read()).rejects.toThrow("size exceeded");
  });
});
