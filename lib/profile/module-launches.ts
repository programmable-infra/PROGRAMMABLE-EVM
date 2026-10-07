import type { RobinhoodFoundationLaunch } from "@/lib/robinhood-launches";

/** Discovery identifies the pool; the claim path independently verifies its live ledger. */
export type FoundationProfileLaunch = Pick<RobinhoodFoundationLaunch,
  "tokenAddress" | "creator" | "hookAddress" | "poolId" | "quoteAsset" | "sourceReleaseDigest"
> & { feeLedgerAddress?: string };

export type EthereumProfileModuleLaunch = FoundationProfileLaunch & {
  name: string | null; symbol: string | null; imageUrl: string | null;
  launchedAt: string | null; blockNumber: string; logIndex: number;
};
export const MODULE_PROFILE_PAGE_SIZE = 5;
export type EthereumModuleProfile = {
  chainId: 1; account: string; status: "ready" | "stale" | "unavailable";
  updatedAt: string | null; items: EthereumProfileModuleLaunch[];
  page: { number: number; size: 5; totalItems: number; totalPages: number; hasMore: boolean };
};

const address = (v: unknown): v is string => typeof v === "string" && /^0x[\da-f]{40}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^0x[\da-f]{64}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => v === null || (typeof v === "string" && v.length <= 2048);

export function readEthereumModuleProfile(value: unknown, account: string): EthereumModuleProfile {
  if (!record(value) || value.chainId !== 1 || !address(account) || value.account !== account.toLowerCase()
    || !["ready", "stale", "unavailable"].includes(String(value.status))
    || !(value.updatedAt === null || (typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))))
    || !Array.isArray(value.items) || value.items.length > MODULE_PROFILE_PAGE_SIZE || !record(value.page)) {
    throw new Error("Invalid module profile");
  }
  const tokens = new Set<string>();
  for (const row of value.items) {
    if (!record(row) || !address(row.tokenAddress) || !address(row.creator) || row.creator.toLowerCase() !== account.toLowerCase()
      || !address(row.hookAddress) || !address(row.quoteAsset) || !hash(row.poolId) || !hash(row.sourceReleaseDigest)
      || (row.feeLedgerAddress !== undefined && !address(row.feeLedgerAddress))
      || !text(row.name) || !text(row.symbol) || !text(row.imageUrl)
      || !(row.launchedAt === null || (typeof row.launchedAt === "string" && Number.isFinite(Date.parse(row.launchedAt))))
      || typeof row.blockNumber !== "string" || !/^\d+$/.test(row.blockNumber)
      || !Number.isSafeInteger(row.logIndex) || Number(row.logIndex) < 0 || tokens.has(row.tokenAddress.toLowerCase())) {
      throw new Error("Invalid profile launch");
    }
    tokens.add(row.tokenAddress.toLowerCase());
  }
  const p = value.page;
  if (p.size !== MODULE_PROFILE_PAGE_SIZE || !Number.isSafeInteger(p.number) || Number(p.number) < 1
    || !Number.isSafeInteger(p.totalItems) || Number(p.totalItems) < 0
    || p.totalPages !== Math.ceil(Number(p.totalItems) / MODULE_PROFILE_PAGE_SIZE)
    || Number(p.number) > Math.max(1, Number(p.totalPages)) || p.hasMore !== (Number(p.number) < Number(p.totalPages))
    || value.items.length !== Math.min(MODULE_PROFILE_PAGE_SIZE, Number(p.totalItems) - (Number(p.number) - 1) * MODULE_PROFILE_PAGE_SIZE)) {
    throw new Error("Invalid profile page");
  }
  return value as EthereumModuleProfile;
}
