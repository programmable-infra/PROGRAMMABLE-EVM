import { coinValuation, type RobinhoodCoinMarket } from "../robinhood-presentation";

/** Historical closes use the current reported supply basis, never guessed token units. */
export function chartMarketCap(price: number | undefined, market?: RobinhoodCoinMarket | null) {
  const currentPrice = market?.priceUsd, cap = coinValuation(market).value;
  if (price === undefined || !Number.isFinite(price) || price <= 0 || currentPrice == null
    || !Number.isFinite(currentPrice) || currentPrice <= 0 || cap === null || cap <= 0) return null;
  const value = price / currentPrice * cap;
  return Number.isFinite(value) ? value : null;
}
