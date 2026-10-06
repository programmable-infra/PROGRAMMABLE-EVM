# Daily buy window V1

Buys are allowed during one recurring daily UTC window. Sells remain available at every hour. Opening is inclusive and closing is exclusive. A window starting at 22 UTC and lasting 4 hours covers 22:00 through 01:59:59 UTC, including the date boundary. UTC does not change for daylight saving time.

Configuration is `abi.encode(uint8 startHourUtc, uint8 openHours)`. The start hour is 0 through 23 and the duration is 1 through 23 hours. Defaults are 08:00 UTC and 12 open hours. Settings are fixed for the life of the pool. No external scheduler, keeper or transaction is needed to open or close the window.

A launch without an initial buy can occur at any time. A creator's initial buy must obey the window, so a launch including that buy reverts while closed. The module uses the block timestamp. It applies to this pool only, and does not prevent transfers or trading through other pools.

The module works with either token ordering and any supported quote token. Other selected rules still apply. Their time-based settings continue to elapse while this window is closed; for example, an initial wallet limit can expire before the next opening. There is no fee share, oracle, action or administrator. Deployment and Ethereum signing-authority admission are required before joint publication.
