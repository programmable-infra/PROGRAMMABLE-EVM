"use client";
import { useEffect, useState } from "react";
import { CODEX_CHART_RANGES, type CodexChart, type CodexChartRange } from "@/lib/market/codex";
import { codexChartCache } from "@/lib/market/codex-chart-cache";
import { coinDollars, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import styles from "./robinhood-live-chart.module.css";

const stamp = (time: number) => new Date(time).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export function CodexPriceChart({ tokenAddress, chainId, name, market }: { tokenAddress: string; chainId: 1 | 4663; name: string; market?: RobinhoodCoinMarket | null }) {
  const [range, setRange] = useState<CodexChartRange>("1D");
  const key = `${chainId}:${tokenAddress.toLowerCase()}:${range}`;
  const [state, setState] = useState<{ key: string; chart?: CodexChart; failed: boolean }>({ key, chart: codexChartCache.peek(tokenAddress, chainId, range), failed: false });
  const [now, setNow] = useState(() => Date.now());
  const [hover, setHover] = useState<number | null>(null);
  const chart = state.key === key ? state.chart : codexChartCache.peek(tokenAddress, chainId, range);
  useEffect(() => {
    let disposed = false, active = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visibleNow = () => document.visibilityState !== "hidden";
    async function load() {
      if (disposed || active || document.visibilityState === "hidden") return;
      active = true;
      try {
        const value = await codexChartCache.load(tokenAddress, chainId, range);
        if (disposed) return;
        setState({ key, chart: value, failed: false });
      } catch { if (!disposed) setState(current => ({ key, chart: current.key === key ? current.chart : codexChartCache.peek(tokenAddress, chainId, range), failed: true })); }
      finally { active = false; if (!disposed) setNow(Date.now()); if (!disposed && visibleNow()) timer = setTimeout(load, Math.max(1_000, codexChartCache.waitMs(tokenAddress, chainId, range))); }
    }
    const visible = () => { clearTimeout(timer); if (visibleNow()) void load(); };
    void load();
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
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
  const gap = CODEX_CHART_RANGES[range].candleSeconds * 1_000 * 1.5;
  const path = coordinates.map((point, index) => `${index === 0 || points[index].time - points[index - 1].time > gap ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const selected = hover !== null ? coordinates[hover] : undefined;
  const failed = state.key === key && state.failed;
  const delayed = chart && now - Date.parse(chart.observedAt) > 180_000;
  return <figure className={styles.figure} aria-label={`${name} price chart`}>
    <header className={styles.header}><div><p className={styles.price} aria-label="Price in USD">{price != null ? coinDollars(price, true) : "—"}</p>
      {chart && (failed || delayed) ? <p className={styles.status} role="status">Price updates delayed</p> : null}</div>
      <nav className={styles.ranges} aria-label="Chart period">{(Object.keys(CODEX_CHART_RANGES) as CodexChartRange[]).map(value => <button key={value} type="button" title={CODEX_CHART_RANGES[value].label} aria-pressed={range === value} onClick={() => { setHover(null); setRange(value); }}>{value}</button>)}</nav>
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
        {selected ? <circle className={styles.point} cx={selected.x} cy={selected.y} r="4" /> : null}
        {coordinates.map((point, index) => (points.length === 1 || (index === 0 || points[index].time - points[index - 1].time > gap) && (index === points.length - 1 || points[index + 1].time - points[index].time > gap)) ? <circle key={points[index].time} className={styles.point} cx={point.x} cy={point.y} r="3" /> : null)}
      </svg> : <div className={styles.empty} role="status">{!chart && !failed ? <span className={styles.skeleton} aria-label="Loading price history" /> : failed ? "Chart is temporarily unavailable." : "No trades in this period."}</div>}
    </div>
  </figure>;
}
