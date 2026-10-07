import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress } from "viem";
import { ETHEREUM_MODULE_BINDING } from "@/lib/module-foundation/ethereum-release";
import { foundationChainProfile } from "@/lib/module-foundation/chains";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/components/module-foundation-session", () => ({ useFoundationSession: session }));
vi.mock("@/components/use-live-data-refresh", () => ({ useLiveDataRefresh: () => 0 }));
import { FoundationProfileClaim } from "@/components/foundation-profile-claim";

const account = getAddress("0x1000000000000000000000000000000000000000");
const token = getAddress("0x2000000000000000000000000000000000000000");
const launch = { creator: account, tokenAddress: token, hookAddress: token,
  poolId: `0x${"1".repeat(64)}`, quoteAsset: foundationChainProfile(1).wrappedEth.address,
  sourceReleaseDigest: ETHEREUM_MODULE_BINDING.releaseDigest };

beforeEach(() => { session.mockReset(); session.mockReturnValue({ account, contextKey: "test", availability: { status: "checking" } }); });

it.each([1, 4663] as const)("keeps Claim Rewards visible and binds the wallet session to chain %s", chainId => {
  const html = renderToStaticMarkup(<FoundationProfileClaim account={account} launch={launch} chainId={chainId} />);
  expect(html).toContain("Claim Rewards");
  expect(html).toContain("Checking rewards");
  expect(session).toHaveBeenCalledWith(token, chainId);
  session.mockReturnValue({ account, contextKey: "switch", availability: { status: "checking" },
    walletAction: { label: "Switch network", busy: false, onClick: () => {} } });
  const switching = renderToStaticMarkup(<FoundationProfileClaim account={account} launch={launch} chainId={chainId} />);
  expect(switching).toContain("Claim Rewards");
  expect(switching).toContain("Switch network");
  session.mockReturnValue({ account: token, contextKey: "other", availability: { status: "checking" } });
  expect(renderToStaticMarkup(<FoundationProfileClaim account={account} launch={launch} chainId={chainId} />)).toBe("");
});
