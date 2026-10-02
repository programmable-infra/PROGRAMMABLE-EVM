import "server-only";
import { unstable_cache } from "next/cache";
import { CODEX_CHART_RANGES, marketAddress, marketNumber, marketObject, parseCodexBars, type CodexChart, type CodexChartRange } from "@/lib/market/codex";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { readBoundedUtf8BodyV1 } from "./custom-launch/bounded-utf8-body-v1";

const endpoint = "https://graph.codex.io/graphql";
const marketQuery = `query Markets($tokens:[String]) { filterTokens(tokens:$tokens,limit:25,useAggregatedStats:true) { results { token { address networkId } priceUSD marketCap circulatingMarketCap totalLiquidityUsd liquidity volume24 change24 } } }`;
const barsQuery = `query Chart($symbol:String!,$from:Int!,$to:Int!,$resolution:String!) { getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,currencyCode:USD,removeEmptyBars:true,removeLeadingNullValues:true) { t c s token {address networkId} } }`;

export async function codexQuery(query: string, variables: Record<string, unknown>) {
  const key = process.env.CODEX_API_KEY?.trim();
  if (!key) throw new Error("Market data unavailable");
  const signal = AbortSignal.timeout(2_500);
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: key, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), cache: "no-store", redirect: "error", signal });
  if (!response.ok) { void response.body?.cancel(); throw new Error("Market data unavailable"); }
  const body: unknown = JSON.parse(await readBoundedUtf8BodyV1(response, 512_000, { signal }));
  // Provider errors may contain request context. Never forward them to the browser or logs.
  if (!marketObject(body) || body.errors || !marketObject(body.data)) throw new Error("Market data unavailable");
  return body.data;
}

type Identity = { tokenAddress: string; poolId: string };
const cachedMarkets = unstable_cache(async (addresses: readonly string[], chainId: number) => {
  const data = await codexQuery(marketQuery, { tokens: addresses.map(address => `${address}:${chainId}`) });
  if (!marketObject(data.filterTokens) || !Array.isArray(data.filterTokens.results) || data.filterTokens.results.length > 25) throw new Error("Market data unavailable");
  const observedAt = new Date().toISOString();
  const entries: [string, Omit<RobinhoodCoinMarket, "poolId">][] = [];
  const seen = new Set<string>();
  for (const row of data.filterTokens.results) {
    if (!marketObject(row) || !marketObject(row.token) || typeof row.token.address !== "string" || row.token.networkId !== chainId) throw new Error("Invalid market identity");
    const address = row.token.address.toLowerCase();
    if (!addresses.includes(address) || seen.has(address)) throw new Error("Invalid market identity");
    seen.add(address);
    const priceUsd = marketNumber(row.priceUSD);
    if (priceUsd === null || priceUsd <= 0) continue;
    const marketCapUsd = marketNumber(row.circulatingMarketCap);
    const fdvUsd = marketNumber(row.marketCap);
    const change = marketNumber(row.change24, true);
    entries.push([address, { source: "codex", priceUsd, marketCapUsd, fdvUsd,
      valuationKind: marketCapUsd !== null ? "market-cap" : "fdv", liquidityUsd: marketNumber(row.totalLiquidityUsd) ?? marketNumber(row.liquidity), volume24hUsd: marketNumber(row.volume24), change24hPercent: change === null ? null : change * 100,
      observedAt, sourceUrl: "https://www.codex.io/" }]);
  }
  return entries;
}, ["codex-token-markets-v1"], { revalidate: 15 });

/** Only enrich identities supplied by the verified launch catalog. No provider token becomes a launch. */
export async function readCodexMarkets(tokens: readonly Identity[], chainId = 4663): Promise<Map<string, RobinhoodCoinMarket>> {
  if (![1, 4663].includes(chainId) || tokens.some(token => !marketAddress.test(token.tokenAddress))) throw new Error("Invalid market request");
  if (!process.env.CODEX_API_KEY?.trim()) return new Map();
  const addresses = [...new Set(tokens.map(token => token.tokenAddress.toLowerCase()))].sort();
  const result = new Map<string, RobinhoodCoinMarket>();
  // Batch once for the catalog, and bound concurrent requests even when many launches exist.
  const deadline = Date.now() + 3_000;
  for (let offset = 0; offset < addresses.length && Date.now() < deadline; offset += 100) {
    const settled = await Promise.allSettled(Array.from({ length: Math.ceil(Math.min(100, addresses.length - offset) / 25) }, (_, index) => cachedMarkets(addresses.slice(offset + index * 25, offset + (index + 1) * 25), chainId)));
    for (const batch of settled) if (batch.status === "fulfilled") for (const [address, market] of batch.value) {
      const token = tokens.find(token => token.tokenAddress.toLowerCase() === address)!;
      const age = Date.now() - Date.parse(market.observedAt);
      if (age >= 0 && age <= 180_000) result.set(address, { ...market, poolId: token.poolId });
    }
  }
  return result;
}

export const readCodexChart = unstable_cache(async (address: string, chainId: number, range: CodexChartRange): Promise<CodexChart> => {
  if (!marketAddress.test(address) || ![1, 4663].includes(chainId) || !Object.hasOwn(CODEX_CHART_RANGES, range)) throw new Error("Invalid chart request");
  const config = CODEX_CHART_RANGES[range];
  const to = Math.floor(Date.now() / 1_000), from = to - config.seconds;
  const data = await codexQuery(barsQuery, { symbol: `${address.toLowerCase()}:${chainId}`, from, to, resolution: config.resolution });
  // The first candle can start just before the requested window at its resolution boundary.
  const earliest = from - Number(config.resolution) * 60;
  const points = parseCodexBars(data.getTokenBars, address.toLowerCase(), chainId, earliest, to);
  return { tokenAddress: address.toLowerCase(), chainId, range, points, source: "codex", observedAt: new Date().toISOString() };
}, ["codex-token-bars-v1"], { revalidate: 15 });
