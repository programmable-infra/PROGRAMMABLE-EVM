import { describe, expect, it, vi } from "vitest";
import { foundationMainnetPoolHints } from "@/lib/server/module-foundation/pool-hints";
import { rpcProviderCommitment } from "@/lib/data-pipeline/rpc-provider-commitments";
vi.mock("server-only", () => ({}));
const endpoint = "https://eth-mainnet.g.alchemy.com/v2/fixture-only-not-a-key";
const env = { PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: endpoint,
  PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT: rpcProviderCommitment("endpoint", endpoint) };

describe("Ethereum pool discovery index", () => {
  it("validates the configured index endpoint and permits only read-only log discovery", async () => {
    expect(foundationMainnetPoolHints({})).toBeUndefined();
    expect(() => foundationMainnetPoolHints({ ...env, PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT: "0x00" })).toThrow("configuration");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ jsonrpc: "2.0", id: 1, result: [] }));
    const hints = foundationMainnetPoolHints(env, fetcher)!;
    await expect(hints("eth_call", [])).rejects.toThrow("discovery");
    expect(fetcher).not.toHaveBeenCalled();
    const params = [{ fromBlock: "0x1", toBlock: "0x2", topics: [] }];
    expect(await hints("eth_getLogs", params)).toEqual([]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]!.body)).params).toEqual(params);
  });

  it("bounds responses and rejects provider failures without leaking details or retrying", async () => {
    for (const response of [Response.json({ jsonrpc: "2.0", id: 2, result: [] }),
      Response.json({ jsonrpc: "2.0", id: 1, result: [], error: { message: "private details" } }),
      Response.json({ jsonrpc: "2.0", id: 1, result: {} }), new Response("x".repeat(1_048_577)),
      new Response("private details", { status: 429 })]) {
      const fetcher = vi.fn<typeof fetch>(async () => response);
      await expect(foundationMainnetPoolHints(env, fetcher)!("eth_getLogs", []))
        .rejects.toThrow("Ethereum pool discovery is temporarily unavailable.");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
