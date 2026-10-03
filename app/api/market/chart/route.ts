import { NextResponse } from "next/server";
import { CODEX_CHART_RANGES, marketAddress, type CodexChartRange } from "@/lib/market/codex";
import { readCodexChart } from "@/lib/server/codex-market";
import { readEthereumExploreCatalog } from "@/lib/server/ethereum-explore";
import { readRobinhoodToken } from "@/lib/server/robinhood-index/read";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const address = query.get("token")?.toLowerCase() ?? "";
  const chainId = Number(query.get("chain") ?? "4663");
  const range = query.get("range") ?? "1D";
  if (!marketAddress.test(address) || ![1, 4663].includes(chainId) || !Object.hasOwn(CODEX_CHART_RANGES, range)
    || [...query.keys()].some(key => !["token", "chain", "range"].includes(key) || query.getAll(key).length !== 1)) return NextResponse.json({ error: "Invalid chart request" }, { status: 400 });
  try {
    if (chainId === 4663) {
      const record = await readRobinhoodToken(address);
      if (!record.token) return NextResponse.json({ error: "Launch not found" }, { status: 404 });
    }
    if (chainId === 1 && !(await readEthereumExploreCatalog()).entries.some(token => token.tokenAddress.toLowerCase() === address)) return NextResponse.json({ error: "Launch not found" }, { status: 404 });
    const chart = await readCodexChart(address, chainId, range as CodexChartRange);
    return NextResponse.json(chart, { headers: { "Cache-Control": `public, max-age=15, s-maxage=${CODEX_CHART_RANGES[range as CodexChartRange].refreshMs / 1_000}, stale-while-revalidate=30` } });
  } catch { return NextResponse.json({ error: "Price history is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
