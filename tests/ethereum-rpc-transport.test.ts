import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/server/action-rpc-quorum.server", () => ({
  tradeActionRpcProviders: () => [
    { identity: "test-primary", endpoint: "https://primary.example/rpc" },
    { identity: "test-secondary", endpoint: "https://secondary.example/rpc" },
  ],
}));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const responseFor = (init: RequestInit, error?: { code: number; message: string }) => {
  const request = JSON.parse(String(init.body)) as { id: number } | { id: number }[];
  const reply = (item: { id: number }) => ({ jsonrpc: "2.0", id: item.id, ...(error ? { error } : { result: "0x1" }) });
  return Response.json(Array.isArray(request) ? request.map(reply) : reply(request));
};

describe("Ethereum private provider transport", () => {
  it("retries HTTP 429 once after the shared cooldown, with identical read parameters", async () => {
    const issued: unknown[] = [];
    const fetcher = vi.fn(async (_input: unknown, init: RequestInit) => {
      issued.push(JSON.parse(String(init.body)));
      return issued.length === 1 ? new Response("", { status: 429 }) : responseFor(init);
    });
    vi.stubGlobal("fetch", fetcher);
    const { productionEthereumSwapRpcs } = await import("@/lib/server/swap/ethereum-stamped");
    const pending = productionEthereumSwapRpcs()[0]("eth_chainId", []);
    await vi.advanceTimersByTimeAsync(1_120);
    expect(await pending).toBe("0x1"); expect(fetcher).toHaveBeenCalledTimes(2);
    const calls = issued.flat() as { method: string; params: unknown[] }[];
    expect(calls.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: "eth_chainId", params: [] }, { method: "eth_chainId", params: [] },
    ]);
  });

  it("stops after a second provider limit instead of issuing repeated requests", async () => {
    const fetcher = vi.fn(async (_input: unknown, init: RequestInit) => responseFor(init, { code: -32007, message: "Rate limited" }));
    vi.stubGlobal("fetch", fetcher);
    const { productionEthereumSwapRpcs } = await import("@/lib/server/swap/ethereum-stamped");
    const pending = expect(productionEthereumSwapRpcs()[0]("eth_chainId", [])).rejects.toMatchObject({ code: "ETHEREUM_RPC_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(1_120); await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry execution errors or expose the provider's message", async () => {
    const fetcher = vi.fn(async (_input: unknown, init: RequestInit) => responseFor(init, { code: 3, message: "execution reverted https://private.example/credential" }));
    vi.stubGlobal("fetch", fetcher);
    const { productionEthereumSwapRpcs } = await import("@/lib/server/swap/ethereum-stamped");
    const pending = expect(productionEthereumSwapRpcs()[0]("eth_call", [])).rejects.toMatchObject({
      code: "ETHEREUM_RPC_UNAVAILABLE", message: "This swap could not be checked. Please try again.",
    });
    await vi.advanceTimersByTimeAsync(10); await pending;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects broadcast methods before contacting either provider", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { productionEthereumSwapRpcs } = await import("@/lib/server/swap/ethereum-stamped");
    await expect(productionEthereumSwapRpcs()[0]("eth_sendRawTransaction", ["0x00"])).rejects.toMatchObject({ code: "ETHEREUM_RPC_REQUEST_LIMIT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
