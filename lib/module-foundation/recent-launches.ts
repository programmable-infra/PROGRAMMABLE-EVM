import type { RobinhoodFoundationLaunch } from "@/lib/robinhood-launches";
import type { RobinhoodCoinPresentation } from "@/lib/robinhood-presentation";
import { exploreIdentityKey } from "@/lib/unified-explore";
import { isDiscoverableRobinhoodToken } from "@/lib/robinhood-explore-policy";
import { isPublicExploreIdentityV1 } from "@/lib/explore-public-visibility";
import type { FoundationChainId } from "./chains";

/** Presentation only. These receipt-backed rows never authorize a launch, trade or module action. */
export type RecentFoundationLaunch = {
  chainId: FoundationChainId;
  row: RobinhoodFoundationLaunch & { quoteSymbol: string };
  presentation: RobinhoodCoinPresentation;
  observedAt: number;
};
export const RECENT_LAUNCH_TTL = 60 * 60_000;
export const RECENT_LAUNCH_LIMIT = 64;

export function selectRecentFoundationLaunches(rows: readonly RecentFoundationLaunch[], indexed: ReadonlySet<string>, now = Date.now()) {
  const selected = new Map<string, RecentFoundationLaunch>();
  for (const item of rows) {
    const key = exploreIdentityKey({ chainId: item.chainId, tokenAddress: item.row.tokenAddress });
    if (indexed.has(key) || item.observedAt > now || now - item.observedAt >= RECENT_LAUNCH_TTL
      || !isPublicExploreIdentityV1(item.row, item.chainId)
      || (item.chainId === 4663 && !isDiscoverableRobinhoodToken(item.row.tokenAddress))) continue;
    const old = selected.get(key);
    if (!old || old.observedAt < item.observedAt) selected.set(key, item);
  }
  return [...selected.values()].sort((a, b) => b.observedAt - a.observedAt).slice(0, RECENT_LAUNCH_LIMIT);
}
