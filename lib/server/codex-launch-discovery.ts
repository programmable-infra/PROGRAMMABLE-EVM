import "server-only";
import { codexQuery } from "./codex-market";
import { marketAddress, marketObject, marketPool } from "@/lib/market/codex";

export type CodexLaunchCandidate = {
  poolId: string; hookAddress: string; token0: string; token1: string;
  createdAt: number;
  tokens: readonly { address: string; creationTransaction: string | null; creationBlock: number | null }[];
};
export type CodexDiscoveryQuery = typeof codexQuery;
const hash = /^0x[\da-f]{64}$/i;
const query = `query LaunchDiscovery($filters:PairFilters,$offset:Int) {
 filterPairs(filters:$filters,limit:100,offset:$offset,rankings:[{attribute:createdAt,direction:ASC}]) {
  count offset results { pair { address networkId token0 token1 createdAt
   protocolData { ... on UniswapV4Data { uniswapV4HookAddress } }
   token0Data { createBlockNumber createTransactionHash }
   token1Data { createBlockNumber createTransactionHash }
  } }
 }
}`;
const fail = () => new Error("Codex launch discovery unavailable");

/** Discover pools through Codex. Launch/claim authority is verified separately. */
export async function discoverCodexLaunches(
  chainId: 1 | 4663, hooks: readonly string[], throughTimestamp: number,
  read: CodexDiscoveryQuery = codexQuery,
): Promise<readonly CodexLaunchCandidate[]> {
  if (![1, 4663].includes(chainId) || !hooks.length || hooks.length > 100
    || hooks.some(hook => !marketAddress.test(hook))
    || !Number.isSafeInteger(throughTimestamp) || throughTimestamp <= 0) throw fail();
  const allowed = new Set(hooks.map(hook => hook.toLowerCase()));
  const results: CodexLaunchCandidate[] = [], seen = new Set<string>();
  let previousTime = 0;
  for (let offset = 0; offset < 10_000; offset += 100) {
    const data = await read(query, { filters: { network: [chainId], hookAddress: [...allowed],
      createdAt: { lte: throughTimestamp } }, offset });
    const page = data.filterPairs;
    if (!marketObject(page) || !Array.isArray(page.results) || page.results.length > 100
      || page.offset !== offset || page.count !== page.results.length) throw fail();
    for (const row of page.results) {
      if (!marketObject(row) || !marketObject(row.pair)) throw fail();
      const p = row.pair, protocol = p.protocolData;
      if (p.networkId !== chainId || typeof p.address !== "string" || !marketPool.test(p.address)
        || typeof p.token0 !== "string" || !marketAddress.test(p.token0)
        || typeof p.token1 !== "string" || !marketAddress.test(p.token1)
        || p.token0.toLowerCase() === p.token1.toLowerCase()
        || !marketObject(protocol) || typeof protocol.uniswapV4HookAddress !== "string"
        || !allowed.has(protocol.uniswapV4HookAddress.toLowerCase())
        || typeof p.createdAt !== "number" || !Number.isSafeInteger(p.createdAt)
        || p.createdAt < previousTime || p.createdAt > throughTimestamp) throw fail();
      const poolId = p.address.toLowerCase();
      if (seen.has(poolId)) throw fail();
      seen.add(poolId); previousTime = p.createdAt;
      const tokens = [p.token0Data, p.token1Data].map((token, index) => {
        if (token !== null && !marketObject(token)) throw fail();
        const tx = token?.createTransactionHash, block = token?.createBlockNumber;
        if (tx != null && (typeof tx !== "string" || !hash.test(tx))
          || block != null && (typeof block !== "number" || !Number.isSafeInteger(block) || block < 0)) throw fail();
        return { address: (index === 0 ? p.token0 as string : p.token1 as string).toLowerCase(),
          creationTransaction: typeof tx === "string" ? tx.toLowerCase() : null,
          creationBlock: typeof block === "number" ? block : null };
      });
      results.push({ poolId, hookAddress: protocol.uniswapV4HookAddress.toLowerCase(),
        token0: p.token0.toLowerCase(), token1: p.token1.toLowerCase(), createdAt: p.createdAt, tokens });
    }
    // count is the page size, NOT the total number of matching pools.
    if (page.results.length < 100) return results;
  }
  throw fail();
}
