import "server-only";
import { unstable_cache } from "next/cache";
import { CODEX_CHART_RANGES, marketAddress, marketPool, marketNumber, marketObject, parseCodexBars, type CodexChart, type CodexChartRange } from "@/lib/market/codex";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { readBoundedUtf8BodyV1 } from "./custom-launch/bounded-utf8-body-v1";

const endpoint = "https://graph.codex.io/graphql";
const marketQuery = `query Markets($tokens:[String],$pairs:[String]) {
 filterTokens(tokens:$tokens,limit:100,useAggregatedStats:true) { results { token { address networkId } priceUSD marketCap circulatingMarketCap volume24 change24 } }
 filterPairs(pairs:$pairs,limit:100) { results { liquidity pair { address networkId token0 token1 token0Data { address networkId symbol } token1Data { address networkId symbol } } } }
}`;
// Fixed windows are already below the provider's point limit. countback overrides from.
const barsQuery = `query Chart($symbol:String!,$from:Int!,$to:Int!,$resolution:String!) { getTokenBars(symbol:$symbol,from:$from,to:$to,resolution:$resolution,currencyCode:USD,removeEmptyBars:false,removeLeadingNullValues:true) { t c s token {address networkId} } }`;

export async function codexQuery(query: string, variables: Record<string, unknown>) {
  const key = process.env.CODEX_API_KEY?.trim();
  if (!key) throw new Error("Market data unavailable");
  const signal = AbortSignal.timeout(8_000);
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: key, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), cache: "no-store", redirect: "error", signal });
  if (!response.ok) { void response.body?.cancel(); throw new Error("Market data unavailable"); }
  const body: unknown = JSON.parse(await readBoundedUtf8BodyV1(response, 512_000, { signal }));
  // Provider errors may contain request context. Never forward them to the browser or logs.
  if (!marketObject(body) || body.errors || !marketObject(body.data)) throw new Error("Market data unavailable");
  return body.data;
}

type Identity = { tokenAddress: string; poolId: string };
const pending = new Map<string, Promise<unknown>>();
const failedUntil = new Map<string, number>();
// Coalesce cold reads and briefly back off failures, without automatic provider retries.
async function sharedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const active = pending.get(key);
  if (active) return active as Promise<T>;
  if ((failedUntil.get(key) ?? 0) > Date.now()) throw new Error("Market data unavailable");
  const request = read();
  pending.set(key, request);
  try { return await request; }
  catch {
    failedUntil.delete(key); failedUntil.set(key, Date.now() + 15_000);
    if (failedUntil.size > 200) failedUntil.delete(failedUntil.keys().next().value!);
    throw new Error("Market data unavailable");
  } finally { pending.delete(key); }
}

const cachedMarkets = unstable_cache(async (identities: readonly Identity[], chainId: number) => {
  const addresses = identities.map(token => token.tokenAddress);
  const pools = [...new Set(identities.map(token => token.poolId))];
  const data = await codexQuery(marketQuery, { tokens: addresses.map(address => `${address}:${chainId}`), pairs: pools.map(pool => `${pool}:${chainId}`) });
  if (!marketObject(data.filterTokens) || !Array.isArray(data.filterTokens.results) || data.filterTokens.results.length > 100) throw new Error("Market data unavailable");
  const liquidity = new Map<string, { tokens: string[]; symbols: (string | null)[]; usd: number | null }>();
  if (marketObject(data.filterPairs) && Array.isArray(data.filterPairs.results) && data.filterPairs.results.length <= 100) {
    for (const row of data.filterPairs.results) {
      if (!marketObject(row) || !marketObject(row.pair)) continue;
      const pair = row.pair;
      if (typeof pair.address !== "string" || !marketPool.test(pair.address) || pair.networkId !== chainId
        || typeof pair.token0 !== "string" || !marketAddress.test(pair.token0) || typeof pair.token1 !== "string" || !marketAddress.test(pair.token1)) continue;
      const pool = pair.address.toLowerCase();
      if (!pools.includes(pool) || liquidity.has(pool)) throw new Error("Invalid pool identity");
      const tokens = [pair.token0.toLowerCase(), pair.token1.toLowerCase()];
      const symbols = [pair.token0Data, pair.token1Data].map((token, index) => {
        if (!marketObject(token) || typeof token.address !== "string" || token.address.toLowerCase() !== tokens[index]
          || token.networkId !== chainId || typeof token.symbol !== "string") return null;
        const symbol = token.symbol.trim();
        return symbol.length > 0 && symbol.length <= 32 && !/[\p{Cc}\p{Cf}]/u.test(symbol) ? symbol : null;
      });
      liquidity.set(pool, { tokens, symbols, usd: marketNumber(row.liquidity) });
    }
  }
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
    // A positive token price with unknown/zero provider supply is not a measured zero-dollar valuation.
    const circulating = marketNumber(row.circulatingMarketCap), total = marketNumber(row.marketCap);
    const marketCapUsd = circulating !== null && circulating > 0 ? circulating : null;
    const fdvUsd = total !== null && total > 0 ? total : null;
    const change = marketNumber(row.change24, true);
    const pool = liquidity.get(identities.find(token => token.tokenAddress === address)!.poolId);
    const quoteAddress = pool?.tokens.includes(address) ? pool.tokens.find(token => token !== address) : undefined;
    entries.push([address, { source: "codex", priceUsd, marketCapUsd, fdvUsd,
      ...(quoteAddress ? { quoteAsset: { address: quoteAddress, symbol: pool!.symbols[pool!.tokens.indexOf(quoteAddress)] } } : {}),
      valuationKind: marketCapUsd !== null ? "market-cap" : "fdv", liquidityUsd: pool?.tokens.includes(address) ? pool.usd : null,
      volume24hUsd: marketNumber(row.volume24), change24hPercent: change === null ? null : change * 100,
      observedAt, sourceUrl: "https://www.codex.io/" }]);
  }
  return entries;
}, ["codex-token-markets-v5"], { revalidate: 30 });

/** Only enrich identities supplied by the verified launch catalog. No provider token becomes a launch. */
export async function readCodexMarkets(tokens: readonly Identity[], chainId = 4663): Promise<Map<string, RobinhoodCoinMarket>> {
  if (![1, 4663].includes(chainId) || tokens.some(token => !marketAddress.test(token.tokenAddress) || !marketPool.test(token.poolId))) throw new Error("Invalid market request");
  if (!process.env.CODEX_API_KEY?.trim()) return new Map();
  const poolsByToken = new Map<string, string>();
  for (const token of tokens) {
    const address = token.tokenAddress.toLowerCase(), pool = token.poolId.toLowerCase();
    if (poolsByToken.has(address) && poolsByToken.get(address) !== pool) throw new Error("Ambiguous market identity");
    poolsByToken.set(address, pool);
  }
  const identities = [...new Map(tokens.map(token => [token.tokenAddress.toLowerCase(), { tokenAddress: token.tokenAddress.toLowerCase(), poolId: token.poolId.toLowerCase() }])).values()].sort((a,b) => a.tokenAddress.localeCompare(b.tokenAddress));
  const result = new Map<string, RobinhoodCoinMarket>();
  // One HTTP request for token stats and exact-pool liquidity per 100 verified identities.
  const deadline = Date.now() + 8_000;
  for (let offset = 0; offset < identities.length && Date.now() < deadline; offset += 400) {
    const settled = await Promise.allSettled(Array.from({ length: Math.ceil(Math.min(400, identities.length - offset) / 100) }, (_, index) => {
      const batch = identities.slice(offset + index * 100, offset + (index + 1) * 100);
      // A stable cache key lets Next serve the last observation while refreshing.
      // A time bucket here creates a cold blocking request every 30 seconds.
      return sharedRead(`markets:${chainId}:${JSON.stringify(batch)}`, () => cachedMarkets(batch, chainId));
    }));
    for (const batch of settled) if (batch.status === "fulfilled") for (const [address, market] of batch.value) {
      const token = identities.find(token => token.tokenAddress === address)!;
      const age = Date.now() - Date.parse(market.observedAt);
      if (age >= 0 && age <= 180_000) result.set(address, { ...market, poolId: token.poolId });
    }
  }
  return result;
}

const cachedChart = unstable_cache(async (address: string, chainId: number, range: CodexChartRange, bucket: number): Promise<CodexChart> => {
  const config = CODEX_CHART_RANGES[range];
  const to = Math.floor(bucket * config.refreshMs / 1_000), from = to - config.seconds;
  const data = await codexQuery(barsQuery, { symbol: `${address.toLowerCase()}:${chainId}`, from, to, resolution: config.resolution });
  // The first candle can start just before the requested window at its resolution boundary.
  const earliest = from - config.candleSeconds;
  const points = parseCodexBars(data.getTokenBars, address.toLowerCase(), chainId, earliest, to);
  return { tokenAddress: address.toLowerCase(), chainId, range, points, source: "codex", observedAt: new Date().toISOString() };
}, ["codex-token-bars-v3"], { revalidate: 60 });

export async function readCodexChart(address: string, chainId: number, range: CodexChartRange): Promise<CodexChart> {
  if (!marketAddress.test(address) || ![1, 4663].includes(chainId) || !Object.hasOwn(CODEX_CHART_RANGES, range)) throw new Error("Invalid chart request");
  const normalized = address.toLowerCase(), bucket = Math.floor(Date.now() / CODEX_CHART_RANGES[range].refreshMs);
  return sharedRead(`chart:${chainId}:${normalized}:${range}:${bucket}`, () => cachedChart(normalized, chainId, range, bucket));
}
