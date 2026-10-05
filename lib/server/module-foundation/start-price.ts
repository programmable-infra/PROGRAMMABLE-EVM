import "server-only";
import type { Address, Hex } from "viem";
import { readAnyQuoteUsdPriceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { FOUNDATION_START_MARKET_CAP_USD, parseFoundationStartPrice } from "@/lib/module-foundation/start-price";
import { type FoundationChainId } from "@/lib/module-foundation/chains";

export async function readFoundationStartPrice(quote: { address: Address; decimals: number; codeHash: Hex }, chainId: FoundationChainId = 4663) {
  try {
    const reference = await readAnyQuoteUsdPriceV1({ quoteAsset: quote.address }, { chainId });
    return parseFoundationStartPrice({ ...reference, quoteCodeHash: quote.codeHash, targetMarketCapUsd: FOUNDATION_START_MARKET_CAP_USD.toString() }, { ...quote, chainId });
  } catch {
    throw new Error("A current price for this quote token is unavailable. Try again or choose another quote token.");
  }
}
