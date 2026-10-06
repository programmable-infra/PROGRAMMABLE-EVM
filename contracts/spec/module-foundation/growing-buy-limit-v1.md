# Growing buy limit V1

Each purchase starts with a small maximum token amount. That maximum grows steadily over the chosen number of seconds, then stays at the final limit. Sells are not limited by this module. The creator's first buy follows the same limit.

The initial and final limits are percentages of the fixed one-billion-token launch supply. Configuration is `abi.encode(uint16 initialLimitBps, uint16 finalLimitBps, uint32 durationSeconds)`. Each percentage is between 0.01 and 100 percent. The final percentage must be at least the initial percentage, and the duration must be positive. Settings cannot change after launch. Defaults are 0.5 percent initially, 5 percent finally and 600 seconds.

The limit is per swap, not per wallet. Several smaller purchases can buy more in total. This module does not prevent someone from using multiple wallets or other pools. It can be combined with Initial wallet buy limit when a cumulative wallet limit is also wanted. Both limits then apply independently.

The limit is computed from elapsed seconds, not block numbers. Exact-output requests are checked before the swap, and actual positive token output is checked after every buy. A failure reverts the entire swap. Token ordering and the quote token's decimals do not change the calculation. There is no price oracle, external router dependency, fee budget, keeper, action, administrative exemption or upgrade mechanism.

The same module and factory source targets Ethereum and Robinhood. Availability requires deployment and lifecycle verification on both chains and admission by both live hosts. This source package does not by itself publish a module or alter existing coins.
