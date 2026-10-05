import "server-only";
import { getAddress, type Address } from "viem";
import { assessAnyQuoteAssetV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { assertFoundationFundingPath, type FoundationEthFunding } from "@/lib/module-foundation/atomic-launch";
import { requireAnyQuoteNativeUnlockRouteV1 } from "@/lib/module-engine/any-quote/route";
import { foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";

/** The ETH input is a spending ceiling. A 1% output margin leaves any unspent ETH refundable. */
export async function readFoundationEthFunding(quote: Address, maximumEth: bigint, chainId: FoundationChainId = 4663): Promise<FoundationEthFunding> {
  const FOUNDATION_WETH = foundationChainProfile(chainId).wrappedEth.address;
  if (getAddress(quote) === FOUNDATION_WETH) return { maximumEth, quoteAmount: maximumEth, path: [] };
  const result = await assessAnyQuoteAssetV1({ quoteAsset: quote, probeEthAmount: maximumEth }, { chainId });
  if (result.status !== "compatible") throw new Error("No ETH route is available for this token at this amount. Increase the first buy or choose Classic.");
  const hops = requireAnyQuoteNativeUnlockRouteV1(result.routes.buy, "buy", chainId);
  if (getAddress(hops.at(-1)!.tokenOut) !== getAddress(quote)) throw new Error("The ETH route ends in another quote token.");
  const path = hops.map(hop => ({ intermediateCurrency: hop.tokenIn, fee: hop.key.fee,
    tickSpacing: hop.key.tickSpacing, hooks: hop.key.hooks, hookData: hop.hookData }));
  assertFoundationFundingPath(quote, path, chainId);
  const quoteAmount = BigInt(result.routes.buy.amountOut) * 99n / 100n;
  if (quoteAmount <= 0n) throw new Error("The first buy is too small for this token. Increase the ETH amount.");
  return { maximumEth, quoteAmount, path };
}
