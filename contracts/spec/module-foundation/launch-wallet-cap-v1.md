# Launch wallet cap V1

This optional Foundation module limits all purchases initiated by one wallet during a launch window. Omitting the module leaves the existing unrestricted purchase behavior unchanged.

In the current Module Mode builder, the pair-token option (shown as "Pair another token", also called Any Quote) is independent of this module. New launches support all four selections: the default ETH pair with no cap, another quote token with no cap, the default ETH pair with the cap, and another quote token with the cap. The cap uses token output and launch supply, not quote amounts or quote decimals. Removing or changing the pair option must preserve the chosen cap settings, and removing the cap must preserve the chosen pair token. This does not add callback support to the older Any Quote Engine host.

The launcher chooses a supply percentage (0.01 to 100 percent, with up to two decimal places) and `durationMinutes` (a positive whole number of minutes). Defaults are 2 percent and 3 minutes. The form converts the percentage to `supplyLimitBps` (1 to 10,000 basis points) without floating-point arithmetic. Both values are committed in `abi.encode(uint16 supplyLimitBps, uint32 durationMinutes)` at launch and cannot be edited later.

The limit uses the fixed launch supply of one billion tokens. All successful purchases by an initiator count together. Selling or transferring tokens does not replenish the purchase allowance. The creator's atomic first buy counts toward the creator's allowance. Sells remain permitted. At `block.timestamp >= protectionEndsAt`, buys are unrestricted and the module no longer reads router identity or updates counters.

During the window, buys must use the official, runtime-pinned Robinhood Universal Router. Its locked `msgSender()` identifies the initiating wallet, including smart contract wallets. A different token recipient does not change this identity. An aggregator that initiates transactions itself shares one allowance; unsupported routers are rejected during the window. The module cannot identify a human or prevent using several wallets, transfers, or other pools.

Before-swap checks reject unsupported routes and excess exact-output requests. After-swap checks count the actual positive token delta in either token ordering, for both exact-input and exact-output trades. The descriptor sets `failOpenAfter: false`, so an excess purchase reverts the entire trade. The module receives no fee budget and has no management actions, exemptions, mutable settings or upgrade path.

This package targets new launches. Existing pool hooks are immutable. Source, focused local checks, independent review, deployed factory evidence and catalog availability are separate steps. This document does not announce production availability.
