export const CODEX_CHART_RANGES = {
  "1m": { seconds: 1_800, resolution: "1", candleSeconds: 60, refreshMs: 30_000, label: "One-minute candles over the last 30 minutes" },
  "1H": { seconds: 3_600, resolution: "1", candleSeconds: 60, refreshMs: 30_000, label: "Last hour" },
  "1D": { seconds: 86_400, resolution: "15", candleSeconds: 900, refreshMs: 60_000, label: "Last day" },
  "1W": { seconds: 604_800, resolution: "60", candleSeconds: 3_600, refreshMs: 60_000, label: "Last week" },
} as const;
export type CodexChartRange = keyof typeof CODEX_CHART_RANGES;
export type CodexPricePoint = { time: number; price: number };
export type CodexChart = { tokenAddress: string; chainId: number; range: CodexChartRange; points: CodexPricePoint[]; observedAt: string; source: "codex" };
export const marketAddress = /^0x[\da-f]{40}$/i;
export const marketPool = /^0x(?:[\da-f]{40}|[\da-f]{64})$/i;
export const marketObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function marketNumber(value: unknown, signed = false): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) && (signed || n >= 0) ? n : null;
}

/** Keep real provider timestamps and reject a response for a different token or network. */
export function parseCodexBars(raw: unknown, address: string, chainId: number, from: number, to: number): CodexPricePoint[] {
  if (!marketObject(raw) || !marketObject(raw.token) || typeof raw.token.address !== "string" || raw.token.address.toLowerCase() !== address.toLowerCase()
    || raw.token.networkId !== chainId || !["ok", "no_data"].includes(String(raw.s))
    || !Array.isArray(raw.t) || !Array.isArray(raw.c) || raw.t.length !== raw.c.length || raw.t.length > 1_000) throw new Error("Invalid price history");
  const points: CodexPricePoint[] = [];
  for (let index = 0; index < raw.t.length; index++) {
    const time: unknown = raw.t[index];
    const price: unknown = raw.c[index];
    if (typeof time !== "number" || !Number.isSafeInteger(time) || time < from || time > to
      || (index && time <= raw.t[index - 1])) throw new Error("Invalid price history");
    // An empty candle is a gap, never a zero price or an invented trade.
    if (price === null) continue;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) throw new Error("Invalid price history");
    points.push({ time: time * 1_000, price });
  }
  return points;
}
