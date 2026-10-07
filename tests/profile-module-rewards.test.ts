import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, toHex, type PublicClient } from "viem";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";
import { ETHEREUM_MODULE_BINDING, ETHEREUM_MODULE_SOURCE } from "@/lib/module-foundation/ethereum-release";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { readEthereumModuleProfile } from "@/lib/profile/module-launches";
import { readFoundationProfileRewards } from "@/lib/profile/foundation-rewards";

const readers = vi.hoisted(() => ({ catalog: vi.fn(), recent: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/alchemy/router-custom-public.server", () => ({ readWebsiteRouterCustomIdentitySnapshotV1: readers.catalog }));
vi.mock("@/lib/server/module-foundation/recent-launch-store", () => ({ readRecentFoundationLaunches: readers.recent }));
import { readEthereumProfileModules } from "@/lib/server/module-foundation/profile";
import { GET } from "@/app/api/profile/ethereum/modules/route";

const address = (n: number) => getAddress(toHex(n, { size: 20 }));
const hash = (n: number) => toHex(n, { size: 32 });
const account = address(100), other = address(101), hook = address(102), ledger = address(103);
const date = "2026-10-07T00:00:00.000Z";
function entry(n: number, creator = account) {
  return { tokenAddress: address(200 + n), name: `Coin ${n}`, symbol: `C${n}`, launchedAt: date,
    launchStampProvenance: { chainId: 1, kind: "custom-graph", launchWallet: creator,
      routerAddress: ethereum.canonicalStamp.router.address, routeLauncherAddress: ethereum.canonicalStamp.graphFactory.address,
      blockNumber: String(ETHEREUM_MODULE_SOURCE.startBlock + BigInt(n)), launchLogIndex: n, poolId: hash(n + 1),
      poolKey: { currency0: address(200 + n), currency1: foundationChainProfile(1).wrappedEth.address, hooks: hook },
      components: [{ kind: "token" }, { kind: "hook" }, { kind: "other", scope: "exclusive", runtimeCodeHash: ETHEREUM_MODULE_SOURCE.proxyRuntimeCodeHash }] } };
}
beforeEach(() => { vi.clearAllMocks(); readers.recent.mockResolvedValue([]); });

describe("Module Mode profile rewards", () => {
  it("lists every owned canonical module launch, independently of module name, with stable pagination", async () => {
    readers.catalog.mockResolvedValue({ status: "current", generatedAt: date,
      entries: [...Array.from({ length: 7 }, (_, n) => entry(n)), entry(8, other), { ...entry(9), launchStampProvenance: null }] });
    const first = readEthereumModuleProfile(await readEthereumProfileModules(account, 1), account);
    expect(first.items.map(row => row.name)).toEqual(["Coin 6", "Coin 5", "Coin 4", "Coin 3", "Coin 2"]);
    expect(first.page).toMatchObject({ totalItems: 7, totalPages: 2, hasMore: true });
    const last = readEthereumModuleProfile(await readEthereumProfileModules(account, 99), account);
    expect(last.items.map(row => row.name)).toEqual(["Coin 1", "Coin 0"]);
    expect(last.page.number).toBe(2);
    expect(() => readEthereumModuleProfile(first, other)).toThrow();
    expect(() => readEthereumModuleProfile({ ...first, chainId: 4663 }, account)).toThrow();
    expect(() => readEthereumModuleProfile({ ...first, items: [{ ...first.items[0], creator: other }, ...first.items.slice(1)] }, account)).toThrow();
  });

  it("merges a new verified receipt once and lets the canonical index supersede it", async () => {
    readers.catalog.mockResolvedValue({ status: "current", generatedAt: date, entries: [entry(0)] });
    const original = (await readEthereumProfileModules(account)).items[0];
    readers.recent.mockResolvedValue([
      { chainId: 1, row: { ...original, name: "Old receipt name" }, presentation: { imageUrl: null } },
      { chainId: 1, row: { ...original, tokenAddress: address(250), name: "New launch", blockNumber: String(ETHEREUM_MODULE_SOURCE.startBlock + 10n) }, presentation: { imageUrl: null } },
      { chainId: 4663, row: { ...original, tokenAddress: address(251) }, presentation: { imageUrl: null } },
    ]);
    const result = readEthereumModuleProfile(await readEthereumProfileModules(account), account);
    expect(result.items.map(row => row.name)).toEqual(["New launch", "Coin 0"]);
    expect(result.page.totalItems).toBe(2);
  });

  it("rejects ambiguous profile queries and reports index failure instead of an empty history", async () => {
    expect((await GET(new Request(`https://app.invalid/api/profile/ethereum/modules?account=${account}&account=${other}`))).status).toBe(400);
    expect(readers.catalog).not.toHaveBeenCalled();
    readers.catalog.mockRejectedValue(new Error("unavailable"));
    expect((await GET(new Request(`https://app.invalid/api/profile/ethereum/modules?account=${account}`))).status).toBe(503);
  });

  it.each([1, 4663] as const)("reads the registered creator's actual WETH balance on chain %s", async chainId => {
    const binding = { ...ETHEREUM_MODULE_BINDING, chainId, ethereumGraph: chainId === 1 ? ETHEREUM_MODULE_BINDING.ethereumGraph : undefined };
    const launch = { tokenAddress: address(200), creator: account, hookAddress: hook, poolId: hash(1),
      quoteAsset: foundationChainProfile(chainId).wrappedEth.address, sourceReleaseDigest: binding.releaseDigest };
    const values: Record<string, unknown> = { launchOf: { token: address(200), hook, ledger, poolId: hash(1) },
      creator: account, quote: launch.quoteAsset, creatorCredited: 250_000_000_000_000_000n, creatorClaimed: 50_000_000_000_000_000n };
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]);
    const client = { getChainId: async () => chainId, getBlockNumber: async () => 100n, readContract } as unknown as PublicClient;
    expect(await readFoundationProfileRewards(client, binding, launch)).toEqual({ amount: 200_000_000_000_000_000n, decimals: 18, symbol: "WETH", wrappedEth: true });
    expect(readContract.mock.calls.every(([request]) => (request as { blockNumber?: bigint }).blockNumber === 100n)).toBe(true);
    values.creator = other;
    await expect(readFoundationProfileRewards(client, binding, launch)).rejects.toThrow("recipient or asset");
    values.creator = account; values.creatorClaimed = 300_000_000_000_000_000n;
    await expect(readFoundationProfileRewards(client, binding, launch)).rejects.toThrow("recipient or asset");
    await expect(readFoundationProfileRewards(client, { ...binding, chainId: chainId === 1 ? 4663 : 1 }, launch)).rejects.toThrow("different network");
  });
});
