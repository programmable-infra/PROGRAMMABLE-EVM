import "server-only";

import { readRobinhoodExploreCatalog } from "./robinhood-index/read";
import { readEthereumCustomExploreCatalog } from "./ethereum-explore";
import { readRobinhoodMarkets, readRobinhoodPresentations } from "./robinhood-presentation";
import { readCodexMarkets } from "./codex-market";
import { isRobinhoodModuleSourceKind } from "@/lib/robinhood-launches";
import { coinValuation, type RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { exploreIdentityKey, selectUnifiedExplorePage } from "@/lib/unified-explore";
import type { RobinhoodExploreFilters } from "@/lib/robinhood-explore-filters";

const readers = {
  robinhood: readRobinhoodExploreCatalog,
  ethereum: readEthereumCustomExploreCatalog,
  robinhoodMarkets: readRobinhoodMarkets,
  ethereumMarkets: readCodexMarkets,
  robinhoodPresentations: readRobinhoodPresentations,
};

/** Two independently verified catalogs, one global ranking, and at most one market batch per chain per cache window. */
export async function readUnifiedLaunches(page = 1, query = "", filters: RobinhoodExploreFilters = { sort: "highest", mode: "all" },
  size: 6 | 8 | 10 | 50 = 10, dependencies: typeof readers = readers) {
  const [rh, eth] = await Promise.all([dependencies.robinhood(), dependencies.ethereum()]);
  const sources = { robinhood: rh.status, ethereum: eth.status };
  const available = [rh, eth].filter(source => source.status !== "unavailable");
  const status = !available.length ? "unavailable" as const : available.length < 2 ? "partial" as const
    : available.some(source => source.status === "stale") ? "stale" as const
      : available.some(source => source.status === "syncing") ? "syncing" as const : "ready" as const;
  const updatedAt = available.flatMap(source => source.updatedAt ? [source.updatedAt] : [])
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const [rhMarkets, ethMarkets] = await Promise.all([
    dependencies.robinhoodMarkets(rh.items).catch(() => new Map<string, RobinhoodCoinMarket>()),
    dependencies.ethereumMarkets(eth.entries, 1).catch(() => new Map<string, RobinhoodCoinMarket>()),
  ]);
  const rhRows = rh.items.map(row => ({ ...row, chainId: 4663 as const,
    mode: isRobinhoodModuleSourceKind(row.sourceKind) ? "module" as const : "custom" as const }));
  const ethRows = eth.entries.map(entry => ({
    chainId: 1 as const, mode: "custom" as const, category: "custom" as const,
    launchId: entry.launchStampProvenance?.launchId ?? entry.id, tokenAddress: entry.tokenAddress,
    hookAddress: entry.hookAddress, creator: entry.creatorAddress, transactionHash: entry.launchTransactionHash,
    blockNumber: entry.launchBlockNumber, launchedAt: entry.launchedAt, name: entry.name, symbol: entry.symbol,
    decimals: entry.tokenDecimals ?? null, provenance: entry.launchCategoryProvenance,
  }));
  const markets = new Map<string, RobinhoodCoinMarket>([
    ...[...rhMarkets].map(([address, market]) => [`4663:${address}`, market] as const),
    ...[...ethMarkets].map(([address, market]) => [`1:${address}`, market] as const),
  ]);
  const values = new Map<string, number>();
  for (const [identity, market] of markets) {
    const value = filters.sort === "activity" ? market.volume24hUsd : coinValuation(market).value;
    if (value !== null && Number.isFinite(value) && value >= 0) values.set(identity, value);
  }
  const selection = selectUnifiedExplorePage<(typeof rhRows)[number] | (typeof ethRows)[number]>(
    [...rhRows, ...ethRows], page, query, filters, values, size);
  const selectedRh = selection.items.filter(row => row.chainId === 4663);
  const rhPresentations = await dependencies.robinhoodPresentations(selectedRh, rhMarkets)
    .catch(() => selectedRh.map(row => ({ tokenAddress: row.tokenAddress, imageUrl: null, description: null,
      links: [], market: rhMarkets.get(row.tokenAddress.toLowerCase()) ?? null })));
  const metadata = new Map(eth.entries.map(entry => [exploreIdentityKey({ chainId: 1, tokenAddress: entry.tokenAddress }), entry]));
  const presentations = [
    ...rhPresentations.map(presentation => ({ ...presentation, chainId: 4663 as const })),
    ...selection.items.filter(row => row.chainId === 1).map(row => {
      const entry = metadata.get(exploreIdentityKey(row))!;
      return { chainId: 1 as const, tokenAddress: row.tokenAddress, imageUrl: entry.imageUrl ?? null,
        description: entry.description ?? null, links: (entry.links ?? []).map(link => ({ label: link.kind, url: link.url })),
        market: markets.get(exploreIdentityKey(row)) ?? null };
    }),
  ];
  return { scope: "all" as const, status, sources, sourceEvidence: { robinhood: rh.sourceEvidence, ethereum: eth.sourceEvidence },
    updatedAt, ...selection, presentations };
}
