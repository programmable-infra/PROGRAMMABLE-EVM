import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { readFoundationSuggestedBuy } from "@/lib/module-foundation/first-buy";

function client(answer: bigint, age = 30n, answeredInRound = 1n, chainId = 4663) {
  const updatedAt = BigInt(Math.floor(Date.now() / 1000)) - age;
  return { chain: { id: chainId }, readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === "decimals"
    ? 8 : [1n, answer, updatedAt, updatedAt, answeredInRound]) } as unknown as PublicClient;
}

describe("first buy suggestion", () => {
  it.each([
    [1, "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"],
    [4663, "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9"],
  ])("reads the price feed on chain %s", async (chainId, address) => {
    const rpc = client(350_000_000_000n, 30n, 1n, chainId as number);
    expect(await readFoundationSuggestedBuy(rpc)).toBe("0.001");
    expect(rpc.readContract).toHaveBeenCalledTimes(2);
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address, functionName: "latestRoundData" }));
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address, functionName: "decimals" }));
  });

  it("uses Ethereum's shorter price freshness window and refuses unknown chains", async () => {
    await expect(readFoundationSuggestedBuy(client(350_000_000_000n, 7_201n, 1n, 1))).rejects.toThrow("current ETH price");
    await expect(readFoundationSuggestedBuy(client(350_000_000_000n, 7_201n, 1n, 4663))).resolves.toBe("0.001");
    const unknown = client(350_000_000_000n, 30n, 1n, 10);
    await expect(readFoundationSuggestedBuy(unknown)).rejects.toThrow("does not support Module Mode");
    expect(unknown.readContract).not.toHaveBeenCalled();
  });
  it.each([[2500n, "0.0014"], [3500n, "0.001"], [4000n, "0.000875"]])("converts $3.50 using the current $%s ETH price", async (usd, eth) => {
    expect(await readFoundationSuggestedBuy(client(usd * 100_000_000n))).toBe(eth);
  });
  it("rejects stale, invalid and incomplete feed rounds", async () => {
    for (const feed of [client(0n), client(-1n), client(350_000_000_000n, 86_401n), client(350_000_000_000n, -10n), client(350_000_000_000n, 30n, 0n)]) {
      await expect(readFoundationSuggestedBuy(feed)).rejects.toThrow("current ETH price");
    }
  });
});
