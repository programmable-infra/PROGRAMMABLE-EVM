# Shared fee and game modules

This source package targets the existing Foundation module ABI on Ethereum (1) and Robinhood (4663). Pegs/UPEG and Leverage/Lend Boost are excluded from this release. No existing token, host, platform recipient or protocol fee is changed.

## Behaviour

| Module | Behaviour |
| --- | --- |
| Buyback and burn | Spends its assigned creator-fee quote budget on its own pool through the pinned Universal Router, then calls the token's burn function. Total supply decreases. |
| Dip buyback | The same purchase and burn, but only when the quote-per-token spot price is below its time-weighted reference by the selected percentage. |
| LP rewards | Donates its assigned quote budget to the pool's currently active liquidity. It does not mint a new liquidity position. |
| Full-range liquidity | Buys tokens with half of each batch and adds both assets across the pool's full usable tick range. The module owns the position permanently and has no withdrawal method. Accounted leftovers are reused. |
| Buyer rewards | Qualifying authenticated buyers receive quote-denominated credits capped by available assigned fees. |
| Nth-buy pot | Every Nth qualifying authenticated buy wins the accumulated assigned fees. Only one buy qualifies per block. This is a public deterministic counter, not random selection. |
| King of the Hill | The largest qualifying buy above a decaying threshold takes the crown. The previous king receives fees accrued before that challenge. A sale through the authenticated router relinquishes the crown. |
| Hot potato | The most recent qualifying buyer cannot sell through this pool until a different qualifying buyer arrives or the chosen timeout expires. Timeout is mandatory and at most one hour. |
| Plague | Buyers must already hold the chosen minimum token balance. The creator can seed holders; selling stays available. |
| Reactive pair | A same-quote reference pool's price relative to its launch-time baseline changes the maximum tokens per buy within fixed minimum and maximum caps. |
| Entangled | Buying opens permanently when a same-quote reference pool reaches the chosen price rise. Sells are not gated. The target must be observed by a successful buy; a historical unobserved touch does not count. |

## Accounting and execution

All financial modules use only the creator-fee share assigned to their own immutable instance. The 0.3% platform fee and other module budgets are unavailable. The sum of shares cannot exceed 100%. A zero creator fee or zero assigned share produces no automatic fee income.

The swap callback records credits and state. Withdrawals, router trades, donations and liquidity additions execute afterward through `FoundationHookV2.executeModuleAction`. They cannot claim inside the swap callback. Anyone can submit a ready action. A running keeper is required for a hands-free product; deploying a contract does not create a timer or pay execution gas. Before joint activation, register both networks with the execution service and fund its gas budget. Rewards have an independent permissionless payment path to the recorded beneficiary and cannot be redirected by an executor.

Fee strategies expose `execute()` as four selector bytes to the host action. Reward modules accept `pay(address[])` followed by the ABI-encoded beneficiary list, capped at sixteen entries. Large debts are paid in int128-sized chunks. A failed transfer reverts the claim and preserves the debt. Retry is safe. Duplicate recipients do not pay twice.

Fee strategies require a configured minimum budget, maximum batch and interval. The price history records every swap, stores at most one checkpoint per minute, and uses a 5–10 minute reference. An idle interval can make the averaging horizon longer than the requested minimum. There is no historical reference until the pool has existed long enough with an observed price. Contract-enforced minimum output includes the actual creator buy fee, the platform fee and selected slippage. Full-range deposits additionally check spot deviation in both directions. Time weighting mitigates same-transaction price manipulation; it cannot make a small pool economically manipulation-proof.

Only internally accounted residual assets are reused by the full-range strategy. Unsolicited token transfers cannot enlarge its position calculation or next trade. LP positions cannot be removed and there is no generic sweep, arbitrary call or recipient setting.

## Composition boundaries

The host permits at most eight modules and bounds their total swap gas. These are selectable alternatives and combinations, not a claim that all modules fit in a single launch. Every family has its own exclusive group; one revision of a family is allowed per pool.

Buyback transactions pay normal host fees and obey existing buy caps, cooldowns and trading windows. Too-small caps or closed hours can postpone execution. Fee-funded module buys do not win buyer rewards, advance the pot or take the crown. These actors are identified by their positive immutable share in the pool ledger, without scanning every installed module during a swap. A strategy with no share has no executable fee budget. The creator's first buy counts as the creator's activity.

Authenticated wallet rules refer to the pinned Universal Router initiator. They do not infer ownership from `tx.origin` or caller-provided hook data. Rewards ignore unsupported routers. Hot potato rejects unknown sell routers during its active pause; Plague requires the authenticated router for buys. King-of-the-Hill crown relinquishment observes supported-router sales only. Direct transfers and activity in other pools are not tracked by these ERC20 pool modules. They are not global holding restrictions or proof of uninterrupted ownership.

Reference pools must exist on the selected chain, use the same quote token and the pinned manager. Reference price movement is a game input, not a collateral oracle. Reactive pair is a directed dependency on an existing pool; this version does not atomically create two mutually dependent launches. An Entangled launch normally omits its first buy until the reference threshold is reached.

All asset amounts in the contract ABI are raw token units. The UI converts amounts using verified quote decimals; the platform token uses 18 decimals. Fee-on-transfer, rebasing and other non-standard settlement assets are not silently accepted as standard ERC20s.

## Execution service

`ops/economic-modules/run.mjs` runs one bounded pass on one chain. The deployment service invokes it at most once per minute per journal. It checks at most eight targets per pass, rotates fairly, submits at most one transaction and keeps only one unconfirmed transaction per chain/account. A larger installation needs separately assigned worker shards with separate signing accounts and non-overlapping target ownership.

The configuration contains `chainId` (1 or 4663), `rpcEnv`, `keyEnv`, `simulationAccount`, `confirmations` (at least 12 on Ethereum, 64 on Robinhood), `maxFeePerGasWei` as a decimal string, and `targets`. Each target contains its reviewed `family`, deployed `host`, `module`, zero-based `index`, `runtimeHash`, `configurationHash` and decimal-string `deployedBlock`. Populate these from admitted deployment evidence. Never put a private key or credential-bearing RPC URL in the configuration. The corresponding environment variables belong to the execution service's secret store.

Run `node ops/economic-modules/run.mjs CONFIG.json JOURNAL.json` to simulate. Add `--broadcast` only on the funded, admitted service. Dry runs do not consume persistent event cursors. Use the same `simulationAccount` as the broadcast signer when sharing a journal. The parent journal directory must exist, and separate chains need separate journals. A local exclusive lock prevents concurrent writers; deployment must also ensure a single host owns each journal. After an interrupted process, inspect the retained pending transaction before removing a stale `.lock` directory.

Before signing, the worker checks chain ID, the host's installed module, runtime hash, configuration hash and module family, then simulates the exact action. Strategy contracts enforce readiness and price limits. Reward discovery reads confirmed events in windows of at most 1,000 blocks and limits the payment batch to sixteen recorded beneficiaries. It retains a cursor hash for reorg replay. Queue rotation allows later payments to proceed when one recipient cannot currently receive the token. The worker rechecks actual debts so replayed events and payments by third parties do not pay twice.

The signed raw transaction and hash are atomically saved before the first broadcast. On a connection failure, retries use those same bytes and nonce until a confirmed receipt is found. A reverted receipt backs off for an hour. Unready actions use bounded backoff. The gas ceiling prevents signing at an unexpectedly high fee; the service still needs monitoring for low balance, stalled pending transactions, growing event lag and repeated failures. It must not advertise hands-free availability until that service is actually deployed and monitored for both chains.

## Release evidence

Source packages and tests are preparation, not activation. Each chain needs a deployed factory, matching runtime evidence, an exercised lifecycle and authority admission. The shared publication coordinator must activate both targets together. Existing coins retain their original immutable modules. The Ethereum signing authority's admitted runtime set must include these factories before activation.
