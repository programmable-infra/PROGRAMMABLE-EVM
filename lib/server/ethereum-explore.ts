import "server-only";

import { readWebsiteRouterCustomIdentitySnapshotV1 } from "@/lib/alchemy/router-custom-public.server";
import { readEnvioClassicV3CatalogV1 } from "@/lib/market-data/envio-classic-v3-catalog.server";
import { publicExploreCatalogEntriesV1, publicExplorePresentationEntryV1 } from "@/lib/public-explore-catalog-v1";
import { isPublicExploreIdentityV1 } from "@/lib/explore-public-visibility";
import { readCodexMarkets } from "./codex-market";
import { ETHEREUM_EXPLORE_FILTERS } from "@/lib/ethereum-explore";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import { readEthereumPublicTokenMetadata } from "./ethereum-public-token-metadata";

type SourceStatus = "current" | "last-known-good" | "unavailable";
type SourceEvidence = {
  source: "envio-classic-v3" | "canonical-launch-stamp-router";
  asOfBlock: string;
  asOfBlockHash: string;
  commitment: string;
  generatedAt: string;
  deployment?: string;
  sourceCommit?: string;
};
type CatalogSource = { entries: readonly CanonicalTokenExploreEntry[]; status: Exclude<SourceStatus, "unavailable">; generatedAt: string; evidence?: SourceEvidence };
type Dependencies = {
  classic: () => Promise<CatalogSource>;
  custom: () => Promise<CatalogSource>;
  metadata?: typeof readEthereumPublicTokenMetadata;
};
const readers: Dependencies = {
  metadata: readEthereumPublicTokenMetadata,
  classic: async () => {
    const catalog = await readEnvioClassicV3CatalogV1();
    return { ...catalog, entries: catalog.entries.filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token"),
      evidence: { source: catalog.source, asOfBlock: catalog.asOfBlock, asOfBlockHash: catalog.asOfBlockHash,
        commitment: catalog.evidence.commitment, generatedAt: catalog.generatedAt, deployment: catalog.evidence.deployment, sourceCommit: catalog.evidence.sourceCommit } };
  },
  custom: async () => {
    const catalog = await readWebsiteRouterCustomIdentitySnapshotV1();
    return { ...catalog, evidence: { source: catalog.source, asOfBlock: catalog.asOfBlock,
      asOfBlockHash: catalog.asOfBlockHash, commitment: catalog.identityCommitment, generatedAt: catalog.generatedAt } };
  },
};

/** Unified discovery admits only the canonical Ethereum Custom Hook lane. */
export async function readEthereumCustomExploreCatalog(dependencies: Pick<Dependencies, "custom" | "metadata"> = readers) {
  try {
    const catalog = await dependencies.custom();
    let entries = publicExploreCatalogEntriesV1(catalog.entries.map(publicExplorePresentationEntryV1))
      .filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token"
        && entry.launchCategoryProvenance.category === "custom" && isPublicExploreIdentityV1(entry));
    const identities = new Set<string>();
    for (const entry of entries) {
      const identity = entry.tokenAddress.toLowerCase();
      if (identities.has(identity)) throw new Error("Conflicting Ethereum launch identities");
      identities.add(identity);
    }
    if (dependencies.metadata && catalog.evidence?.source === "canonical-launch-stamp-router") {
      entries = [...await dependencies.metadata(entries, catalog.evidence).catch(() => entries)];
    }
    return { status: catalog.status === "current" ? "ready" as const : "stale" as const,
      updatedAt: catalog.generatedAt, entries, sourceEvidence: catalog.evidence ?? null };
  } catch {
    return { status: "unavailable" as const, updatedAt: null, entries: [], sourceEvidence: null };
  }
}

/** Each source retains its existing release, provenance and finality checks. */
export async function readEthereumExploreCatalog(dependencies: Dependencies = readers) {
  const [classic, custom] = await Promise.allSettled([dependencies.classic(), dependencies.custom()]);
  const sources: { classic: SourceStatus; custom: SourceStatus } = {
    classic: classic.status === "fulfilled" ? classic.value.status : "unavailable",
    custom: custom.status === "fulfilled" ? custom.value.status : "unavailable",
  };
  const accepted = [classic, custom].flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  let entries = accepted.flatMap(source => source.entries).map(publicExplorePresentationEntryV1);
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = entry.tokenAddress.toLowerCase();
    if (identities.has(identity)) throw new Error("Conflicting Ethereum launch identities");
    identities.add(identity);
  }
  if (dependencies.metadata && custom.status === "fulfilled" && custom.value.evidence?.source === "canonical-launch-stamp-router") {
    entries = [...await dependencies.metadata(entries, custom.value.evidence).catch(() => entries)];
  }
  const status = accepted.length === 0 ? "unavailable" as const
    : accepted.length !== 2 ? "partial" as const
      : accepted.some(source => source.status !== "current") ? "stale" as const : "ready" as const;
  const updatedAt = accepted.map(source => source.generatedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const sourceEvidence = { classic: classic.status === "fulfilled" ? classic.value.evidence ?? null : null,
    custom: custom.status === "fulfilled" ? custom.value.evidence ?? null : null };
  return { chainId: 1 as const, status, sources, sourceEvidence, updatedAt, entries };
}

export async function readEthereumLaunches(page = 1, query = "", filters = ETHEREUM_EXPLORE_FILTERS, pageSize: 6 | 8 | 10 | 50 = 10, dependencies?: Dependencies) {
  const catalog = await readEthereumExploreCatalog(dependencies);
  const q = query.normalize("NFC").trim().replace(/^\$/, "").toLowerCase();
  const visible = publicExploreCatalogEntriesV1(catalog.entries).filter((entry): entry is CanonicalTokenExploreEntry => entry.exploreKind === "token" && isPublicExploreIdentityV1(entry));
  const filtered = visible.filter(entry => (filters.mode === undefined || filters.mode === "all" || entry.launchCategoryProvenance.category === filters.mode)
    && (!q || [entry.name, entry.symbol, entry.tokenAddress].some(value => value?.normalize("NFC").toLowerCase().includes(q))));
  filtered.sort((a, b) => {
    const left = BigInt(a.launchBlockNumber ?? "0");
    const right = BigInt(b.launchBlockNumber ?? "0");
    const difference = left === right ? (a.launchLogIndex ?? 0) - (b.launchLogIndex ?? 0) : left > right ? 1 : -1;
    return (filters.sort === "oldest" ? difference : -difference) || a.tokenAddress.localeCompare(b.tokenAddress);
  });
  const totalPages = Math.ceil(filtered.length / pageSize);
  const number = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const selected = filtered.slice((number - 1) * pageSize, number * pageSize);
  const markets = await readCodexMarkets(selected, 1);
  return {
    chainId: catalog.chainId, status: catalog.status, sources: catalog.sources, sourceEvidence: catalog.sourceEvidence, updatedAt: catalog.updatedAt,
    items: selected.map(entry => ({
      launchId: entry.launchStampProvenance?.launchId ?? entry.id,
      tokenAddress: entry.tokenAddress, hookAddress: entry.hookAddress, creator: entry.creatorAddress,
      transactionHash: entry.launchTransactionHash, blockNumber: entry.launchBlockNumber,
      launchedAt: entry.launchedAt, name: entry.name, symbol: entry.symbol, decimals: entry.tokenDecimals ?? null,
      category: entry.launchCategoryProvenance.category,
      provenance: entry.launchCategoryProvenance,
    })),
    presentations: selected.map(entry => ({ tokenAddress: entry.tokenAddress, imageUrl: entry.imageUrl ?? null,
      description: entry.description ?? null, links: (entry.links ?? []).map(link => ({ label: link.kind, url: link.url })), market: markets.get(entry.tokenAddress.toLowerCase()) ?? null })),
    page: { number, size: pageSize, totalItems: filtered.length, totalPages, hasMore: number < totalPages },
  };
}

export async function readEthereumToken(address: string, dependencies?: Dependencies, options: { publicPresentation?: boolean } = {}) {
  try {
    const tokenReaders = options.publicPresentation === false ? { ...(dependencies ?? readers), metadata: undefined } : dependencies;
    let catalog = await readEthereumExploreCatalog(tokenReaders);
    const findToken = () => catalog.entries.find(entry => entry.tokenAddress.toLowerCase() === address.toLowerCase()) ?? null;
    let token = findToken();
    // A cold page has its own reader cache. Give a temporarily missing source
    // one bounded recovery read before treating its verified token as unavailable.
    if (!token && (catalog.status === "partial" || catalog.status === "unavailable")) {
      catalog = await readEthereumExploreCatalog(tokenReaders);
      token = findToken();
    }
    const metadata = (tokenReaders ?? readers).metadata;
    const boundary = catalog.sourceEvidence.custom;
    if (token && metadata && boundary?.source === "canonical-launch-stamp-router") {
      token = (await metadata([token], boundary).catch(() => [token!]))[0] ?? token;
    }
    return { chainId: catalog.chainId, status: catalog.status, sources: catalog.sources, updatedAt: catalog.updatedAt,
      // The verified snapshot uses null-prototype proof records. React requires
      // plain objects at the client boundary; preserve every proof field in a copy.
      token: token ? structuredClone(token) : null };
  } catch {
    return { chainId: 1 as const, status: "unavailable" as const, updatedAt: null, token: null };
  }
}

export async function readEthereumTokenPresentation(address: string) {
  const record = await readEthereumToken(address);
  if (!record.token) return { ...record, presentation: null };
  const entry = record.token;
  const markets = await readCodexMarkets([entry], 1).catch(() => new Map<string, RobinhoodCoinMarket>());
  return { ...record, presentation: { chainId: 1 as const, tokenAddress: entry.tokenAddress,
    name: entry.name, symbol: entry.symbol,
    imageUrl: entry.imageUrl ?? null, description: entry.description ?? null,
    links: (entry.links ?? []).map(link => ({ label: link.kind, url: link.url })),
    market: markets.get(entry.tokenAddress.toLowerCase()) ?? null } };
}
