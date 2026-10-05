import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foundationMainnetRpcs } from "@/lib/server/module-foundation/rpc";
import { TradeRpcExecutionRevertedV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

const fixtures = vi.hoisted(() => ({ version: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/onchain/website-rpc-providers.server", () => ({ productionMainnetRpcPair: () => ({
  primary: { url: `https://primary.fixture/${fixtures.version}` }, secondary: { url: `https://secondary.fixture/${fixtures.version}` },
}) }));
const ok = () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x01" });

describe("Ethereum quote RPC request budget", () => {
  beforeEach(() => { fixtures.version++; vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
  afterEach(() => vi.useRealTimers());

  it("paces concurrent contexts together and keeps independent providers parallel", async () => {
    const sent: { url: string; at: number }[] = [];
    const fetcher = vi.fn<typeof fetch>(async url => { sent.push({ url: String(url), at: Date.now() }); return ok(); });
    const a = foundationMainnetRpcs({}, fetcher), b = foundationMainnetRpcs({}, fetcher);
    const results = Promise.all([a[0]("eth_chainId", []), b[0]("eth_chainId", []), a[1]("eth_chainId", []), b[0]("eth_chainId", [])]);
    await vi.runAllTimersAsync();
    expect(await results).toEqual(["0x01", "0x01", "0x01", "0x01"]);
    const primary = sent.filter(x => x.url.includes("primary"));
    expect(primary.map(x => x.at - primary[0].at)).toEqual([0, 50, 100]);
    expect(sent.find(x => x.url.includes("secondary"))!.at).toBe(primary[0].at);
  });

  it.each(["http", "rpc"])("retries a %s rate limit once with exactly the same checkpoint", async kind => {
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => kind === "http" ? new Response(null, { status: 429, headers: { "Retry-After": "1" } })
        : Response.json({ code: -32007, message: "private account details" }))
      .mockImplementationOnce(async () => ok());
    const params = [{ to: "0x1111111111111111111111111111111111111111", data: "0x1234" }, { blockHash: "0xab", requireCanonical: true }];
    const result = foundationMainnetRpcs({}, fetcher)[0]("eth_call", params);
    await vi.runAllTimersAsync();
    expect(await result).toBe("0x01");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(fetcher.mock.calls[1][0]);
    expect(fetcher.mock.calls.map(call => JSON.parse(String(call[1]!.body)).params)).toEqual([params, params]);
  });

  it("stops after the second rate limit and does not expose provider details", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: -32007, message: "private account details" }));
    const result = foundationMainnetRpcs({}, fetcher)[0]("eth_chainId", []).catch(error => error);
    await vi.runAllTimersAsync();
    expect((await result).message).toBe("An Ethereum provider is temporarily unavailable.");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry execution reverts or ordinary malformed/provider failures", async () => {
    const responses = [new Response(null, { status: 503 }), Response.json({ jsonrpc: "2.0", id: 2, result: "0x01" }),
      Response.json({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted", data: "0xabcd" } })];
    for (const [index, response] of responses.entries()) {
      const fetcher = vi.fn<typeof fetch>(async () => response);
      const result = foundationMainnetRpcs({}, fetcher)[0]("eth_call", []).catch(error => error);
      await vi.runAllTimersAsync();
      const error = await result;
      if (index === 2) { expect(error).toBeInstanceOf(TradeRpcExecutionRevertedV1); expect(error.data).toBe("0xabcd"); }
      else expect(error.message).toBe("An Ethereum provider is temporarily unavailable.");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
