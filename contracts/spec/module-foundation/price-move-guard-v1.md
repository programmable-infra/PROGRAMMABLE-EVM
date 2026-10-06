# Price move guard V1

Each swap must keep the pool's ending quote-per-token spot price within the configured percentage of its price immediately before that swap. The rule applies to both buys and sells, including the creator's first buy. An excessive move reverts the entire swap, including fees and changes made by other modules.

Configuration is `abi.encode(uint16 maxMoveBps)`, from 1 through 5000 basis points (0.01 through 50 percent). The default is 1000 basis points (10 percent). With a 10 percent limit, an initial price of 1 must end between 0.9 and 1.1. Settings cannot change after launch.

This compares the pool's own spot prices, not the execution price against an external market. It is not wallet slippage protection, an oracle, an anti-MEV guarantee or a cumulative price floor. Several smaller swaps can move the price farther in total. Large exits may need to be split into smaller swaps. A very small configured limit can make normal trades impractical.

The module reads Uniswap V4 slot zero from the exact source-pinned manager on each chain, using the same slot layout as `StateLibrary.getSlot0`. It compares square-root price ratios at 18 decimal places, rounding increases upward and decreases downward. Rounding is conservative: a swap extremely close to a boundary can be rejected, but a larger real move cannot be admitted. The ratio calculation supports the full uint160 price range without squaring a uint160 in uint256 arithmetic.

Token ordering is accounted for; quote decimals do not affect percentage changes. Every selected module must also permit the trade. The module has no funds, fee share, action, timer or administrator. Deployment and Ethereum signing-authority admission are required before joint publication.
