import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCodexBars } from "@/lib/market/codex";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
let readCodexChart: typeof import("@/lib/server/codex-market").readCodexChart;
let readCodexMarkets: typeof import("@/lib/server/codex-market").readCodexMarkets;
const address = `0x${"ab".repeat(20)}`, poolId = `0x${"ef".repeat(32)}`;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ now: new Date("2026-10-03T09:30:00Z") });
  ({ readCodexChart, readCodexMarkets } = await import("@/lib/server/codex-market"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const bars = (overrides = {}) => ({ token: { address, networkId: 4663 }, s: "ok", t: [100, 160, 220], c: [.001, null, .002], ...overrides });
const pool = (overrides = {}) => ({ address: poolId, networkId: 4663, token0: `0x${"00".repeat(20)}`, token1: address, ...overrides });
const row = () => ({ token: { address, networkId: 4663 }, priceUSD: "0.001", marketCap: "1000000", circulatingMarketCap: "500000", liquidity: "215595", totalLiquidityUsd: "2027259", volume24: "0", change24: "-0.05" });

describe("Codex price history", () => {
  it("does not show unknown circulating supply as zero market cap when the provider has a total-supply valuation", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { filterTokens: { results: [{ ...row(), circulatingMarketCap: "0" }] }, filterPairs: { results: [] } } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }])).get(address))
      .toMatchObject({ marketCapUsd: null, fdvUsd: 1_000_000, valuationKind: "fdv" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves candle times and gaps, with no invented prices", () => {
    expect(parseCodexBars(bars(), address, 4663, 100, 220)).toEqual([{ time: 100_000, price: .001 }, { time: 220_000, price: .002 }]);
    expect(parseCodexBars(bars({ s: "no_data", t: [], c: [] }), address, 4663, 100, 220)).toEqual([]);
    expect(parseCodexBars(bars({ token: { address: address.toUpperCase(), networkId: 4663 } }), address, 4663, 100, 220)).toHaveLength(2);
  });
  it.each([
    { token: { address, networkId: 1 } }, { token: { address: `0x${"cd".repeat(20)}`, networkId: 4663 } },
    { t: [100, 100, 160] }, { t: [100, 160, 221] }, { c: [1] }, { c: [0, 1, 2] }, { c: [1, NaN, 2] }, { s: "error" },
  ])("rejects a mismatched or corrupt history: %j", overrides => {
    expect(() => parseCodexBars(bars(overrides), address, 4663, 100, 220)).toThrow();
  });
});

describe("Codex server market adapter", () => {
  it.each([4663, 1])("reads the paired ticker in the existing batch on chain %s", async chainId => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const quote = `0x${"cd".repeat(20)}`;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: {
      filterTokens: { results: [{ ...row(), token: { address, networkId: chainId } }] },
      filterPairs: { results: [{ liquidity: "12", pair: pool({ networkId: chainId, token0: quote,
        token0Data: { address: quote, networkId: chainId, symbol: "PAIR" },
        token1Data: { address, networkId: chainId, symbol: "BASE" } }) }] },
    } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }], chainId)).get(address)?.quoteAsset)
      .toEqual({ address: quote, symbol: "PAIR" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).query).toContain("token0Data { address networkId symbol }");
  });
  it.each([
    { address, networkId: 4663, symbol: "WRONG_TOKEN" },
    { address: pool().token0, networkId: 1, symbol: "WRONG_CHAIN" },
    { address: pool().token0, networkId: 4663, symbol: "spoof\u202e" },
  ])("ignores mismatched or unsafe paired metadata: %j", async token0Data => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: {
      filterTokens: { results: [row()] }, filterPairs: { results: [{ liquidity: "12", pair: pool({ token0Data }) }] },
    } })));
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }])).get(address)?.quoteAsset)
      .toEqual({ address: pool().token0, symbol: null });
  });
  it("batches verified identities and distinguishes circulating cap from FDV", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { filterTokens: { results: [row()] }, filterPairs: { results: [{ liquidity: "172345", pair: pool() }] } } }));
    vi.stubGlobal("fetch", fetcher);
    const markets = await readCodexMarkets([{ tokenAddress: address, poolId }]);
    expect(markets.get(address)).toMatchObject({ poolId, source: "codex", marketCapUsd: 500000, fdvUsd: 1000000, liquidityUsd: 172345, volume24hUsd: 0, change24hPercent: -5 });
    expect(markets.get(address)?.quoteAsset).toEqual({ address: pool().token0, symbol: null });
    const request = fetcher.mock.calls[0][1];
    expect(JSON.parse(request.body).variables.tokens).toEqual([`${address}:4663`]);
    expect(JSON.parse(request.body).variables.pairs).toEqual([`${poolId}:4663`]);
    expect(request.headers.Authorization).toBe("test-private-key");
    expect(JSON.stringify([...markets.values()])).not.toContain("test-private-key");
  });
  it.each([
    { results: [] }, { results: [{ liquidity: "172345", pair: pool({ networkId: 1 }) }] },
    { results: [{ liquidity: "172345", pair: pool({ token1: `0x${"cd".repeat(20)}` }) }] },
    { results: [{ liquidity: "bad", pair: pool() }] },
  ])("does not replace missing or mismatched pool liquidity with aggregated balances: %j", async ({ results }) => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { filterTokens: { results: [row()] }, filterPairs: { results } } })));
    expect((await readCodexMarkets([{ tokenAddress: address, poolId }])).get(address)).toMatchObject({ liquidityUsd: null, priceUsd: .001 });
  });
  it("rejects conflicting canonical pools before sending a request", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readCodexMarkets([{ tokenAddress: address, poolId }, { tokenAddress: address, poolId: `0x${"cd".repeat(32)}` }])).rejects.toThrow("Ambiguous market identity");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("batches one hundred identities and coalesces simultaneous catalog reads", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const tokens = Array.from({ length: 105 }, (_, index) => ({ tokenAddress: `0x${index.toString(16).padStart(40, "0")}`, poolId: `0x${index.toString(16).padStart(64, "0")}` }));
    const fetcher = vi.fn(async (_url, request) => {
      const variables = JSON.parse(request.body).variables;
      return Response.json({ data: { filterTokens: { results: variables.tokens.map((id: string) => ({ token: { address: id.split(":")[0], networkId: 4663 }, priceUSD: "1" })) }, filterPairs: { results: [] } } });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await Promise.all([readCodexMarkets(tokens), readCodexMarkets(tokens)]);
    expect(result.every(markets => markets.size === 105)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { body: { data: { filterTokens: { results: [{ ...row(), token: { address, networkId: 1 } }] } } } },
    { body: { data: { filterTokens: { results: [{ ...row(), token: { address: `0x${"cd".repeat(20)}`, networkId: 4663 } }] } } } },
    { body: { data: { filterTokens: { results: [row(), row()] } } } },
    { body: { errors: [{ message: "provider error" }] } },
  ])("does not enrich another network, unknown token, duplicate row or provider error: %j", async ({ body }) => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetcher);
    expect(await readCodexMarkets([{ tokenAddress: address, poolId }])).toEqual(new Map());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns only fixed chart data and rejects unknown periods before requesting", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const now = Math.floor(Date.now() / 1000);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { getTokenBars: bars({ t: [now - 60, now], c: [.001, .002] }) } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await readCodexChart(address, 4663, "1H")).toMatchObject({ source: "codex", chainId: 4663, tokenAddress: address, points: [{ time: (now - 60) * 1000, price: .001 }, { time: now * 1000, price: .002 }] });
    // @ts-expect-error -- malformed public input must fail closed.
    await expect(readCodexChart(address, 4663, "unknown")).rejects.toThrow("Invalid chart request");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("requests thirty minutes of one-minute candles and accepts a resolution-aligned leading candle", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const now = Math.floor(Date.now() / 1000);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { getTokenBars: bars({ t: [now - 1_860, now], c: [.001, .002] }) } }));
    vi.stubGlobal("fetch", fetcher);
    const values = await Promise.all([readCodexChart(address, 4663, "1m"), readCodexChart(address.toUpperCase(), 4663, "1m")]);
    expect(values[0].points).toHaveLength(2); expect(values[1]).toEqual(values[0]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toMatchObject({ from: now - 1_800, to: now, resolution: "1" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).query).not.toContain("countback");
  });
  it("backs off a failed provider request instead of repeatedly retrying it", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const fetcher = vi.fn().mockRejectedValue(new Error("private provider response")); vi.stubGlobal("fetch", fetcher);
    for (let attempt = 0; attempt < 3; attempt++) await expect(readCodexChart(address, 4663, "1H")).rejects.toThrow("Market data unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 15_001);
    await expect(readCodexChart(address, 4663, "1H")).rejects.toThrow("Market data unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
