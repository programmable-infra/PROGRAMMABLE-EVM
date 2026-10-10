import { formatUnits, parseAbi, parseEther, type PublicClient } from "viem";
import { foundationClientProfile } from "./chains";

export const FOUNDATION_MINIMUM_FIRST_BUY_USD = 2;
export interface FoundationFirstBuyPolicy { minimumEth: string; suggestedEth: string }

export function foundationInitialBuyError(value: string, minimumEth?: string): string | null {
  try {
    if (typeof value !== "string" || value.length > 100 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) throw new Error("Invalid amount");
    const amount = parseEther(value);
    if (amount > (1n << 127n) - 1n) throw new Error("Amount out of range");
    if (amount === 0n || (minimumEth !== undefined && amount < parseEther(minimumEth))) {
      return `Minimum first buy is about $${FOUNDATION_MINIMUM_FIRST_BUY_USD}${minimumEth ? ` (${minimumEth} ETH)` : ""}, plus gas.`;
    }
    return null;
  } catch { return "Enter an ETH amount greater than 0, with up to 18 decimal places."; }
}

// Match each chain's ETH/USD feed and freshness window in the launch price service.
const ETH_USD_FEEDS = {
  1: { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", maxAge: 7_200n },
  4663: { address: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", maxAge: 86_400n },
} as const;
const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);

/** Fresh gross ETH minimum and a buffered default. Neither authorizes a wallet spend. */
export async function readFoundationFirstBuyPolicy(client: PublicClient): Promise<FoundationFirstBuyPolicy> {
  const feed = ETH_USD_FEEDS[foundationClientProfile(client).chainId];
  const [[roundId, answer, , updatedAt, answeredInRound], decimals] = await Promise.all([
    client.readContract({ address: feed.address, abi: feedAbi, functionName: "latestRoundData" }),
    client.readContract({ address: feed.address, abi: feedAbi, functionName: "decimals" }),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (roundId <= 0n || answer <= 0n || answeredInRound < roundId || updatedAt <= 0n || updatedAt > now
    || now - updatedAt > feed.maxAge || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("A current ETH price is unavailable.");
  const scale = 10n ** BigInt(decimals);
  const minimumWei = (BigInt(FOUNDATION_MINIMUM_FIRST_BUY_USD) * 10n ** 18n * scale + answer - 1n) / answer;
  const microEth = (3_500_000n * scale + answer - 1n) / answer;
  if (microEth <= 0n) throw new Error("A current ETH amount is unavailable.");
  return { minimumEth: formatUnits(minimumWei, 18), suggestedEth: formatUnits(microEth, 6) };
}

/** An editable suggestion worth at least $3.50 at this price reference. */
export async function readFoundationSuggestedBuy(client: PublicClient): Promise<string> {
  return (await readFoundationFirstBuyPolicy(client)).suggestedEth;
}
