# Economic module execution

The contracts enforce fee ownership, payout backing and execution conditions. Automatic execution additionally requires a funded, monitored service. A deployment or catalog entry alone does not provide that service.

`service.mjs CONFIG STATE_DIRECTORY` performs a read-only preview. Add `--broadcast` only for the released, funded service. Use a separate state directory and signing account for each chain. The included systemd service and timer run one pass per minute, waiting for the previous pass to finish. They are templates and are not installed or enabled by the source package.

The configuration has two fields:

- `execution`: `chainId` (1 or 4663), `rpcEnv`, `secondaryRpcEnv`, `keyEnv`, `simulationAccount`, `confirmations` (at least 64), `maxFeePerGasWei`, and `maxGasSpendPerDayWei`. RPC and key fields name environment variables; they do not contain credentials. The two RPC providers must have different hosts. The gas budget reserves each transaction's maximum fee once per UTC day and does not recycle unused gas. A pending exact-transaction retry does not consume a second reservation.
- `discovery`: the complete admitted `binding`, decimal `startBlock`, and `admissions`. Each admitted automatic module contains `family`, `factory`, `factoryCodeHash`, `moduleCodeHash` and `descriptorHash`, taken from verified owner publications. The start block must include the first supported module launch. Keep the entire discovery configuration fixed while its registry is active. A configuration change requires a deliberate registry migration retaining previously supported instances.

Discovery scans up to 1,000 blocks and processes at most eight launches per pass. It reads the canonical Robinhood factory or Ethereum stamp Router, restores the exact original launch using the existing verifier on both providers, and registers only matching module instances. The Ethereum path requires the pinned engine component stamp. It does not read Explore or trust an arbitrary `ModuleBound` event. Intermediate cursors include their canonical block hash. A changed cursor stops discovery for reconciliation rather than silently accepting a different history.

The execution pass checks at most eight targets and submits at most one transaction. Reward scans are bounded and resume from their last checkpoint. Transactions are written and synced before submission; restart retries identical bytes. A stale process lock requires inspection before removal. Never run another transaction sender with the same account while this service owns its nonce.

For systemd, install the reviewed repository and Node 24 under `/opt/programmable`, use a dedicated `programmable` OS account, and pre-create `contracts/out/economic-modules` writable only by that account. Store root-owned environment files under `/etc/programmable` with mode 0600; systemd reads these before switching users. Give the public configuration files group `programmable` and mode 0640 so the service can read them. Install the service and timer templates and enable separate instances for `1` and `4663` only after both chain lifecycles pass. Connect `node ops/economic-modules/health.mjs STATE_DIRECTORY` to the host's monitoring. It flags stale execution, deferred work and an exhausted budget. Check persistent deferrals against the configured dip/interval conditions before increasing any budget.

Release requires both contract deployments, source/runtime readback, real launch and execution evidence, the installed Ethereum authority, running timers, monitored state directories and sufficient account funds. The repository tests and timer templates do not establish those production conditions.

## Replaying a release without wallet signatures

Set `FOUNDATION_ETHEREUM_RPC_URL`, `FOUNDATION_ETHEREUM_SECONDARY_RPC_URL`, `FOUNDATION_RPC_URL` and `FOUNDATION_SECONDARY_RPC_URL` to two independent providers per chain. Run:

```sh
node ops/economic-modules/verify-release-forks.mjs RELEASE_DIRECTORY NEW_RESULT_DIRECTORY
```

The release directory supplies the owner publications and `host-binding-1.json` / `host-binding-4663.json`. The runner pins a finalized block agreed by both providers and verifies factory runtime hashes before running the economic, zero-funding and Ethereum stamp suites. Robinhood uses the actual V2 launch factory from the binding. Local balances, trades and time advances remain inside Forge; the runner never broadcasts transactions or needs a signing key. A missing or skipped suite is not a successful result.

Use `--candidate` as the last argument when verifying a local fee-strategy correction before replacement deployment. That mode builds the four fee factories locally and records their new runtime hashes; the other economic factories still come from the published release. Candidate success does not change the old deployed bytecode. The generated report explicitly distinguishes candidate code from published code and records that Ethereum authorization is stubbed on the fork.

## Checking the real Ethereum authorization on a local fork

With Node 24, Anvil, the installed dependencies and two independent Ethereum RPCs, run:

```sh
node ops/economic-modules/verify-authorized-fork.mjs RELEASE_DIRECTORY NEW_RESULT_DIRECTORY SESSION_JSON REFERENCE_TOKEN
```

The RPC variables are `FOUNDATION_ETHEREUM_RPC_URL` and `FOUNDATION_ETHEREUM_SECONDARY_RPC_URL`. `SESSION_JSON` is a private, current website session containing `walletAddress`, `token` and optionally `identityToken`. It is not a signing key. Renew an expired website session before running; the probe stops on authentication errors instead of repeating requests. `REFERENCE_TOKEN` is an existing stamped Ethereum module token with a WETH pair, used to configure the linked-pool modules. An optional final argument selects comma-separated family names.

This probe asks the production website for a real zero-funding launch authorization once per case. It verifies the returned bytes against the installed graph builder, matches the authorization block and deployed runtime hashes on both RPC providers, then executes the exact request on its own local Anvil process. It does not stub the permit signature or replace the published engine. It checks the canonical stamp, attached module, zero initial funding and rejection of a repeated permit. The independent modules also exercise buys and sells; buyback, liquidity donation and full-range LP exercise a fee action. Linked-pool admission is checked here, while their reference-price behavior and the other detailed module conditions remain covered by the separate contract suite.

All transactions and balance/time changes stay inside the disposable fork. A read-only RPC bridge prevents Anvil from forwarding transactions to mainnet, counts upstream reads and stops at its request budget. The probe does not read a private signing key, publish a token, update Explore, activate a module or enable a worker. Output records timings and the exact verified cases without session tokens or reusable permit payloads. Keep the result directory private. These results supplement the contract suite; they do not establish real mainnet mining or financial execution.

The local fork is checked before requesting authorization. An HTTP 429 records `Retry-After` and the remaining families, then stops without retries. After that time, use a new result directory and select only those remaining families. Do not rotate wallets or API credentials to obtain more capacity.

## Human-signed module scenarios

`node ops/economic-modules/serve-metamask.mjs CONFIG` serves a loopback-only MetaMask console. Its server prepares unsigned transactions and accepts exact transaction hashes; it has no signing key or broadcast RPC method. Only the human-started browser flow requests MetaMask confirmations. The private config supplies `output`, `sessionFile`, `port`, verified module publication targets, and two independent RPC files plus the host binding for each chain. Authentication is tied to the funded test account; session credentials stay on the local server.

The console runs eleven single-account scenarios on each chain. It uses finite allowances, a total initial WETH preparation of 0.00025 ETH per chain, 0.00001 WETH buys, 3% swap slippage, a 2 gwei gas-price ceiling and a 0.005 ETH maximum estimated gas debit per request. It verifies deployed runtimes, uses the actual router to simulate modular swaps, and matches mined envelopes and block hashes on two providers. Price-history waits overlap other cases. The journal and browser recovery hash prevent a refresh from silently submitting the same request twice.

Swap quotes use an agreed block behind the lower RPC head, never before the last confirmed test transaction. A temporarily missing block receives at most six short retries with backoff; contract reverts still stop the flow. The local access token survives a server restart so an existing tab can recover its pending transaction hash.

The Nth-buy test reads the EVM block number from the pinned Multicall3 contract. On Robinhood, separate RPC receipt block numbers can still share that EVM block; only one buy in that block qualifies. Each new buy waits until this counter advances and its mined result must increase the qualifying-buy counter. An existing two-trade run counted as one can request one additional human-confirmed 0.00001 WETH buy. It then remains at the payout step until actual accrual and payment are verified.

EIP-1559 fee headroom is capped by both the 2 gwei price limit and the 0.005 ETH maximum gas debit, including the buffered gas limit. If the current base fee plus priority fee exceeds that budget, the console waits 15 seconds before checking again. A valid unsigned launch authorization and its gas estimate are retained during that wait; the console does not request a new permit on every poll. Ethereum also uses the shared per-transaction gas-limit check.

A completed scenario list is not release approval. In particular, distinct-participant crown transfers, non-holder Plague participation, all negative cases, finality and the separately operated execution service still require their own evidence. The console does not publish the module catalog or enable that service. `simulationOnly` configuration and optional `testOnlyFamilies` are only for disposable local-fork verification and do not establish mainnet evidence.
