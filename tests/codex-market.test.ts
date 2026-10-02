import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCodexBars } from "@/lib/market/codex";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
import { readCodexChart, readCodexMarkets } from "@/lib/server/codex-market";
const address = `0x${"ab".repeat(20)}`, poolId = `0x${"ef".repeat(32)}`;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const bars = (overrides = {}) => ({ token: { address, networkId: 4663 }, s: "ok", t: [100, 160, 220], c: [.001, null, .002], ...overrides });

describe("Codex price history", () => {
  it("preserves candle times and gaps, with no invented prices", () => {
    expect(parseCodexBars(bars(), address, 4663, 100, 220)).toEqual([{ time: 100_000, price: .001 }, { time: 220_000, price: .002 }]);
    expect(parseCodexBars(bars({ s: "no_data", t: [], c: [] }), address, 4663, 100, 220)).toEqual([]);
  });
  it.each([
    { token: { address, networkId: 1 } }, { token: { address: `0x${"cd".repeat(20)}`, networkId: 4663 } },
    { t: [100, 100, 160] }, { t: [100, 160, 221] }, { c: [1] }, { c: [0, 1, 2] }, { c: [1, NaN, 2] }, { s: "error" },
  ])("rejects a mismatched or corrupt history: %j", overrides => {
    expect(() => parseCodexBars(bars(overrides), address, 4663, 100, 220)).toThrow();
  });
});

describe("Codex server market adapter", () => {
  it("batches verified identities and distinguishes circulating cap from FDV", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const row = { token: { address, networkId: 4663 }, priceUSD: "0.001", marketCap: "1000000", circulatingMarketCap: "500000", liquidity: "1000", totalLiquidityUsd: "2000", volume24: "0", change24: "-0.05" };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { filterTokens: { results: [row] } } }));
    vi.stubGlobal("fetch", fetcher);
    const markets = await readCodexMarkets([{ tokenAddress: address, poolId }]);
    expect(markets.get(address)).toMatchObject({ poolId, source: "codex", marketCapUsd: 500000, fdvUsd: 1000000, liquidityUsd: 2000, volume24hUsd: 0, change24hPercent: -5 });
    const request = fetcher.mock.calls[0][1];
    expect(JSON.parse(request.body).variables.tokens).toEqual([`${address}:4663`]);
    expect(request.headers.Authorization).toBe("test-private-key");
    expect(JSON.stringify([...markets.values()])).not.toContain("test-private-key");
  });
  it("does not enrich another network, unknown token, duplicate row or provider error", async () => {
    vi.stubEnv("CODEX_API_KEY", "test-private-key");
    const row = { token: { address, networkId: 4663 }, priceUSD: "0.001" };
    for (const body of [
      { data: { filterTokens: { results: [{ ...row, token: { address, networkId: 1 } }] } } },
      { data: { filterTokens: { results: [{ ...row, token: { address: `0x${"cd".repeat(20)}`, networkId: 4663 } }] } } },
      { data: { filterTokens: { results: [row, row] } } },
      { errors: [{ message: "provider error" }] },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
      expect(await readCodexMarkets([{ tokenAddress: address, poolId }])).toEqual(new Map());
    }
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
});
