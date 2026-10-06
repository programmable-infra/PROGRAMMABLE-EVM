# Buy cooldown V1

After a successful buy, the same wallet must wait the configured number of seconds before buying again in this pool. Sells remain available and do not reset or extend the timer. A reverted buy does not start a timer. The creator's first buy starts the same timer. The setting is permanent and cannot be changed after launch.

Configuration is `abi.encode(uint32 cooldownSeconds)`, from 1 to 86400 seconds. The default is 30 seconds. The module uses elapsed seconds on Ethereum and Robinhood, not block counts.

A wallet means the authenticated initiator reported by the source-pinned Universal Router. It can be a smart-contract wallet. The recipient is not used as identity, and `tx.origin` is not used. Other buy routers are rejected; sells are not restricted by router. Multiple wallets and purchases through other pools are outside this rule. This is not a general anti-bot guarantee.

The module has no fee share, oracle, action, administrator, exemption or custody. It composes with the growing buy limit, initial wallet limit, buy window and price-move guard; a trade must pass every selected rule. Deployment and Ethereum signing-authority admission are required before joint publication. This source package does not publish itself.
