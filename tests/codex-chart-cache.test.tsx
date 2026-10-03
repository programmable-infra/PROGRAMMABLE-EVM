import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { acceptsCodexChart, createCodexChartCache } from "@/lib/market/codex-chart-cache";
import { CodexPriceChart } from "@/components/codex-price-chart";
import type { CodexChart } from "@/lib/market/codex";

const token = `0x${"ab".repeat(20)}`, time = Date.parse("2026-10-03T09:30:00Z");
const chart = (range: CodexChart["range"] = "1D", now = time): CodexChart => ({ tokenAddress: token, chainId: 4663, range, source: "codex", observedAt: new Date(now).toISOString(), points: [{ time: now - 60_000, price: .001 }, { time: now, price: .002 }] });

describe("Shared chart navigation cache", () => {
  it("coalesces requests across mounts and reuses periods during rapid navigation", async () => {
    let now = time;
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => Response.json(chart(new URL(String(input), "https://example.com").searchParams.get("range") as CodexChart["range"], now)));
    const cache = createCodexChartCache({ fetcher, now: () => now });
    const values = await Promise.all([cache.load(token, 4663, "1D"), cache.load(token.toUpperCase(), 4663, "1D")]);
    expect(values[0]).toEqual(values[1]); expect(fetcher).toHaveBeenCalledTimes(1);
    await cache.load(token, 4663, "1H"); await cache.load(token, 4663, "1D"); await cache.load(token, 4663, "1H");
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 60_001; await cache.load(token, 4663, "1D");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("preserves valid history and throttles failures before recovering", async () => {
    let now = time;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(chart())).mockRejectedValueOnce(new Error("Unavailable"));
    const cache = createCodexChartCache({ fetcher, now: () => now });
    await cache.load(token, 4663, "1D"); now += 60_001;
    await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    for (let index = 0; index < 3; index++) await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    expect(cache.peek(token, 4663, "1D")).toEqual(chart()); expect(fetcher).toHaveBeenCalledTimes(2);
    now += 60_001; fetcher.mockResolvedValueOnce(Response.json(chart("1D", now)));
    await expect(cache.load(token, 4663, "1D")).resolves.toEqual(chart("1D", now));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("isolates tokens, networks and periods and rejects malformed or stale values", async () => {
    for (const invalid of [
      { ...chart(), tokenAddress: `0x${"cd".repeat(20)}` }, { ...chart(), chainId: 1 }, { ...chart(), range: "1W" },
      { ...chart(), observedAt: new Date(time - 180_001).toISOString() }, { ...chart(), points: [{ time, price: 0 }] },
      { ...chart(), points: [chart().points[1], chart().points[0]] },
    ]) expect(acceptsCodexChart(invalid, token, 4663, "1D", time)).toBe(false);
    const fetcher = vi.fn().mockResolvedValue(Response.json(chart("1H")));
    const cache = createCodexChartCache({ fetcher, now: () => time });
    await expect(cache.load(token, 4663, "1D")).rejects.toThrow();
    expect(cache.peek(token, 4663, "1D")).toBeUndefined();
    expect(cache.peek(token, 1, "1H")).toBeUndefined();
  });
  it("keeps the chart controls minimal with a minute option", () => {
    const html = renderToStaticMarkup(<CodexPriceChart tokenAddress={token} chainId={4663} name="Coin" />);
    expect(html).toContain('title="One-minute candles over the last 30 minutes"'); expect(html).toContain(">1m</button>");
    expect(html).not.toContain("<footer"); expect(html).not.toContain(">Codex<"); expect(html).not.toContain(">Price <");
  });
});
