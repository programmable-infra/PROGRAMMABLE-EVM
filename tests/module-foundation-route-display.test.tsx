import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";
const readers = vi.hoisted(() => ({ indexed: vi.fn(), recent: vi.fn(), presentation: vi.fn() }));
vi.mock("@/lib/server/token-page", () => ({ resolveTokenPage: readers.indexed }));
vi.mock("@/lib/server/module-foundation/recent-launch-store", () => ({ findRecentFoundationLaunch: readers.recent }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumTokenPresentation: readers.presentation }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodTokenPresentation: readers.presentation }));
vi.mock("@/lib/module-foundation/ethereum-release", () => ({ isEthereumModuleLaunchCandidate: () => true }));
vi.mock("@/components/module-foundation-market-host", () => ({ ModuleFoundationMarketHost: () => null }));
vi.mock("@/components/ethereum-token-view", () => ({ EthereumTokenView: () => null }));
vi.mock("@/components/robinhood-token-view", () => ({ RobinhoodTokenView: () => null }));
vi.mock("@/components/token-route-chain-sync", () => ({ TokenRouteChainSync: () => null }));
import FoundationCoinPage from "@/app/modules/[token]/page";
import TokenPage from "@/app/token/[address]/page";

const token = { ...customGraphExploreEntry, symbol: "V4", quoteAssetSymbol: "CLAUS",
  quoteAssetAddress: `0x${"33".repeat(20)}` as const };
beforeEach(() => {
  vi.clearAllMocks(); readers.recent.mockResolvedValue(null);
  readers.indexed.mockResolvedValue({ chainId: 1, token, status: "ready" });
  readers.presentation.mockReturnValue(new Promise(() => {}));
});

it("keeps the indexed ticker and pair on a direct module URL without a price request", async () => {
  const page = await FoundationCoinPage({ params: Promise.resolve({ token: token.tokenAddress }), searchParams: Promise.resolve({ chainId: "1" }) });
  expect(page.props.initialLaunch).toMatchObject({ symbol: "V4", quoteSymbol: "CLAUS", quoteAsset: token.quoteAssetAddress, poolId: token.poolId });
  expect(readers.presentation).not.toHaveBeenCalled();
});

it("passes the Ethereum module identity while the optional presentation is still loading", async () => {
  const page = await TokenPage({ params: Promise.resolve({ address: token.tokenAddress }), searchParams: Promise.resolve({ chain: "1" }) });
  const host = page.props.children as ReactElement<{ initialLaunch: unknown }>;
  expect(host.props.initialLaunch).toMatchObject({ symbol: "V4", quoteSymbol: "CLAUS", quoteAsset: token.quoteAssetAddress });
});
