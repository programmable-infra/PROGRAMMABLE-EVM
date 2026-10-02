"use client";
import { useEffect, useState } from "react";
import { CODEX_CHART_RANGES, marketObject, type CodexChart, type CodexChartRange } from "@/lib/market/codex";
import { coinDollars, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import styles from "./robinhood-live-chart.module.css";

const saved = new Map<string, CodexChart>();
const stamp = (time: number) => new Date(time).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
function acceptsChart(value: unknown, token: string, chain: number, range: string): value is CodexChart {
  if (!marketObject(value) || value.tokenAddress !== token.toLowerCase() || value.chainId !== chain || value.range !== range || value.source !== "codex"
    || typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt)) || Date.now() - Date.parse(value.observedAt) > 180_000
    || Date.parse(value.observedAt) > Date.now() + 30_000 || !Array.isArray(value.points) || value.points.length > 1_000) return false;
  const points = value.points;
  return points.every((point, index) => marketObject(point) && typeof point.time === "number" && Number.isSafeInteger(point.time)
    && point.time > 0 && point.time <= Date.now() + 30_000 && (!index || point.time > points[index - 1].time)
    && typeof point.price === "number" && Number.isFinite(point.price) && point.price > 0);
}
export function CodexPriceChart({ tokenAddress, chainId, name, market }: { tokenAddress: string; chainId: 1 | 4663; name: string; market?: RobinhoodCoinMarket | null }) {
  const [range, setRange] = useState<CodexChartRange>("1D");
  const key = `${chainId}:${tokenAddress.toLowerCase()}:${range}`;
  const [state, setState] = useState<{ key: string; chart?: CodexChart; failed: boolean }>({ key, chart: saved.get(key), failed: false });
  const [now, setNow] = useState(() => Date.now());
  const [hover, setHover] = useState<number | null>(null);
  const chart = state.key === key ? state.chart : saved.get(key);
  useEffect(() => {
    let disposed = false, active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visibleNow = () => document.visibilityState !== "hidden";
    async function load() {
      if (disposed || active || document.visibilityState === "hidden") return;
      active = new AbortController();
      const controller = active;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`/api/market/chart?token=${encodeURIComponent(tokenAddress)}&chain=${chainId}&range=${range}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Unavailable");
        const value: unknown = await response.json();
        if (!acceptsChart(value, tokenAddress, chainId, range)) throw new Error("Unavailable");
        if (disposed || controller.signal.aborted) return;
        saved.delete(key); saved.set(key, value);
        if (saved.size > 80) saved.delete(saved.keys().next().value!);
        setState({ key, chart: value, failed: false });
      } catch { if (!disposed) setState(current => ({ key, chart: current.key === key ? current.chart : saved.get(key), failed: true })); }
      finally { clearTimeout(timeout); active = null; if (!disposed) setNow(Date.now()); if (!disposed && visibleNow()) timer = setTimeout(load, 20_000); }
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState !== "hidden") void load(); else active?.abort(); };
    const cached = saved.get(key);
    if (cached && Date.now() - Date.parse(cached.observedAt) < 15_000) timer = setTimeout(load, 15_000 - (Date.now() - Date.parse(cached.observedAt)));
    else void load();
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; active?.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [key, tokenAddress, chainId, range]);
  const points = chart?.points ?? [];
  const last = points.at(-1);
  const inspected = hover !== null ? points[hover] : undefined;
  const shown = inspected ?? last;
  const price = shown?.price ?? market?.priceUsd;
  const high = Math.max(...points.map(point => point.price), 0);
  const low = Math.min(...points.map(point => point.price));
  const relativeLow = high ? low / high : 0;
  const pad = Math.max((1 - relativeLow) * .12, .025);
  const floor = Math.max(0, relativeLow - pad), ceiling = 1 + pad;
  const coordinates = points.map(point => ({ x: points.length === 1 ? 400 : 16 + (point.time - points[0].time) / (last!.time - points[0].time) * 768,
    y: 16 + (ceiling - point.price / high) / (ceiling - floor) * 288 }));
  const gap = Number(CODEX_CHART_RANGES[range].resolution) * 60_000 * 1.5;
  const path = coordinates.map((point, index) => `${index === 0 || points[index].time - points[index - 1].time > gap ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const selected = hover !== null ? coordinates[hover] : undefined;
  const failed = state.key === key && state.failed;
  const delayed = chart && now - Date.parse(chart.observedAt) > 180_000;
  return <figure className={styles.figure} aria-label={`${name} price chart`}>
    <header className={styles.header}><div><p className={styles.label}>Price <span>USD</span></p><p className={styles.price}>{price != null ? coinDollars(price, true) : "—"}</p></div>
      <nav className={styles.ranges} aria-label="Chart period">{(Object.keys(CODEX_CHART_RANGES) as CodexChartRange[]).map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => { setHover(null); setRange(value); }}>{value}</button>)}</nav>
    </header>
    <div className={styles.plot} onPointerLeave={() => setHover(null)} onPointerMove={event => {
      if (!points.length) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const time = points[0].time + Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 800 - 16) / 768)) * (last!.time - points[0].time);
      let nearest = 0; for (let index = 1; index < points.length; index++) if (Math.abs(points[index].time - time) < Math.abs(points[nearest].time - time)) nearest = index;
      setHover(nearest);
    }}>
      {points.length ? <svg className={styles.svg} viewBox="0 0 800 320" preserveAspectRatio="none" role="img" aria-label={`${name}: ${points.length} recorded prices from ${stamp(points[0].time)} to ${stamp(last!.time)} UTC.`}>

        <path className={styles.line} d={path} vectorEffect="non-scaling-stroke" />
        {selected ? <><line className={styles.crosshair} x1={selected.x} x2={selected.x} y1="0" y2="320" vectorEffect="non-scaling-stroke" /><circle className={styles.point} cx={selected.x} cy={selected.y} r="4" /></> : points.length === 1 ? <circle className={styles.point} cx={400} cy={coordinates[0].y} r="4" /> : null}
      </svg> : <div className={styles.empty} role="status">{!chart && !failed ? <span className={styles.skeleton} aria-label="Loading price history" /> : failed ? "Chart is temporarily unavailable." : "No trades in this period."}</div>}
    </div>
    <footer className={styles.chartFooter}><span>{shown ? `${stamp(shown.time)} UTC` : ""}</span><span>{failed || delayed ? "Updates delayed" : chart ? "Codex" : ""}</span></footer>
  </figure>;
}
