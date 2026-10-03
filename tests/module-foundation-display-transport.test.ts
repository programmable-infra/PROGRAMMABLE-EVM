import { afterEach, describe, expect, it, vi } from "vitest";
import { createFoundationClient } from "@/lib/module-foundation/client";

afterEach(() => vi.unstubAllGlobals());

function mockRpc(failPrimary = false) {
  const requests: { url: string; body: { id: number; method: string } | { id: number; method: string }[] }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    requests.push({ url: String(url), body });
    if (failPrimary && String(url).includes("blockmachine")) return new Response("unavailable", { status: 503 });
    const result = (entry: { id: number; method: string }) => ({ jsonrpc: "2.0", id: entry.id,
      result: entry.method === "eth_chainId" ? "0x1237" : "0x123456" });
    // Providers may return a batch in a different order.
    return Response.json(Array.isArray(body) ? body.map(result).reverse() : result(body));
  }));
  return requests;
}

describe("Foundation display RPC transport", () => {
  it("combines concurrent display reads and resolves responses by request identity", async () => {
    const requests = mockRpc(), client = createFoundationClient({ batchRpc: true });
    await expect(Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })]))
      .resolves.toEqual([4663, 0x123456n]);
    expect(requests).toHaveLength(1);
    expect(Array.isArray(requests[0].body)).toBe(true);
    expect(requests[0].body).toHaveLength(2);
  });

  it("retains the fixed secondary provider when the primary batch fails", async () => {
    const requests = mockRpc(true), client = createFoundationClient({ batchRpc: true });
    await expect(Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })]))
      .resolves.toEqual([4663, 0x123456n]);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1].url).origin).toBe("https://rpc.mainnet.chain.robinhood.com");
    expect(requests[1].body).toHaveLength(2);
  });

  it("keeps the preparation client on its original immediate transport", async () => {
    const requests = mockRpc(), client = createFoundationClient();
    await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })]);
    expect(requests).toHaveLength(2);
    expect(requests.every(request => !Array.isArray(request.body))).toBe(true);
  });
});
