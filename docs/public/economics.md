# Fees and revenue

Programmable earns a platform fee on trades covered by its fee contracts. A creator fee goes to the recipients chosen by the project. Gas pays the network. These are separate charges.

## Module Mode

The current coin builder uses Foundation. Its platform fee is **0.30% on each buy and sell through the launch pool**. You can add a creator fee of **0% to 10% in whole percentage points**. Selected modules may receive part of the creator fee; they do not change the platform's 0.30%.

Both fees are calculated in the asset paired with the coin. For a **1 WETH** trade (wrapped ETH) with a **1% creator fee**:

| Recipient | Amount |
| --- | --- |
| Programmable | 0.003 WETH |
| Creator and any selected module recipients | 0.01 WETH |

The combined Foundation fee is **1.30%**. The initial pool has no additional LP fee. Other pools used along a trade route may charge their own fees.

These percentages apply to trades, not an allocation of the coin's token supply. [Creator earnings](creators/earnings.md) explains how recipients collect their fees.

## Custom launches

The current platform fee for Ethereum Mainnet Custom Hook launches is **0.30% (30 bps)** on each successful buy or sell through the launch's fee-bearing pool. Project fees and liquidity-provider fees are separate. A 1 ETH trade at this rate allocates 0.003 ETH to Programmable.

Your hook defines how that fee is calculated, which asset it uses and how it accrues. Verify the exact deployed fee path. A launch stamp establishes origin; it does not prove fee enforcement or payment. Existing contracts and versioned API profiles retain their recorded rates. The [fee reference](reference/fee-versions.md) lists the rates for Native20, earlier Module Mode contracts and Ethereum launches.

## Platform revenue

Programmable's revenue policy allocates its platform fees as follows:

| Use | Share |
| --- | --- |
| Buy V4 and burn the purchased tokens | 50% |
| Programmable treasury | 50% |

Creator fees and module rewards are excluded. The policy calls for daily buybacks and burns; completed transactions show what has actually been processed.

V4 received as fees from Programmable's own V4/ETH liquidity position is also burned. This is separate from buying V4 with platform revenue. The [V4 token page](v4-token.md) explains the token and its liquidity.

## Check the records

The [Dune dashboard](https://dune.com/programmablehq/analytics) reports the launches, fees and burns covered by its queries. It refreshes every 24 hours and links completed burns to their transactions.

Earned fees can still be unclaimed. Withdrawing them is not new revenue. Gas, liquidity deposits and funds reserved for module behavior are excluded from platform fee revenue.
