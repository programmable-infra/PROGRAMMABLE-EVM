import { describe, expect, it } from "vitest";
import { RECENT_LAUNCH_TTL, selectRecentFoundationLaunches, type RecentFoundationLaunch } from "@/lib/module-foundation/recent-launches";
const token = `0x${"12".repeat(20)}`;
const row = (chainId: 1 | 4663, observedAt = 100): RecentFoundationLaunch => ({
  chainId, observedAt, row: { tokenAddress: token } as RecentFoundationLaunch["row"],
  presentation: { tokenAddress: token, imageUrl: null, description: null, links: [], market: null },
});
describe("receipt-backed Explore display", () => {
  it("shows both chains independently and replaces a temporary row as soon as its canonical index catches up", () => {
    expect(selectRecentFoundationLaunches([row(1), row(4663)], new Set(), 101)).toHaveLength(2);
    expect(selectRecentFoundationLaunches([row(1), row(4663)], new Set([`1:${token}`]), 101).map(x => x.chainId)).toEqual([4663]);
  });
  it("deduplicates retries, expires old rows, rejects future timestamps and honours hidden launches", () => {
    expect(selectRecentFoundationLaunches([row(1, 100), row(1, 101)], new Set(), 102).map(x => x.observedAt)).toEqual([101]);
    expect(selectRecentFoundationLaunches([row(1)], new Set(), 100 + RECENT_LAUNCH_TTL)).toEqual([]);
    expect(selectRecentFoundationLaunches([row(1)], new Set(), 99)).toEqual([]);
    const hidden = row(4663); hidden.row = { ...hidden.row, tokenAddress: "0x2cce608219d32ea1eb6c7ea4d04a0eacd1f08da9" };
    expect(selectRecentFoundationLaunches([hidden], new Set(), 101)).toEqual([]);
  });
});
