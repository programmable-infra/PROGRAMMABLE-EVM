# Tax automation modules, staged source

Status: built and locally tested; not deployed, not published in the website catalog.

Three optional modules share one implementation:

| Module | Effect of its assigned creator-fee share |
| --- | --- |
| Tax to liquidity | Buys coin tokens and adds both assets to permanently locked full-range liquidity in the same pool. |
| Buyback and burn | Buys coin tokens and burns them, reducing total supply. |
| Liquidity and burn | Splits the budget between those two operations using a percentage fixed at launch. |

The creator chooses the buy/sell tax in the existing launch configuration and assigns each module a share of those creator fees. Shares across modules must total at most 100%. The platform's 0.3% fee remains separately credited to its fixed recipient. Any unassigned creator share remains claimable by the creator. Liquidity modules also retain fees realized by their own locked position when adding liquidity; those assets join later bounded batches. They have no access to other people's LP positions or creator/platform credits.

Processing runs after ordinary swaps once enough fees have accumulated. There is no timer, platform-funded keeper or mandatory user claim. The first observation must mature before processing, and the pool price must stay within the launch-time TWAP limit. Otherwise the fees wait for a later eligible swap. A permissionless retry uses the same limits. Failed processing rolls back only that processing call and leaves the user's swap intact.

Configuration uses five static ABI words: `uint128 minimumQuote`, `uint128 maximumQuote`, `uint16 maximumTickDeviation`, `uint32 oracleSeconds`, `uint16 liquidityBps`. Quote amounts are raw units of the selected ERC20, so preparation must scale the minimum and maximum to that token's decimals. LP mode fixes `liquidityBps` at 10000, burn mode at 0, and mixed mode permits 1 through 9999. The minimum oracle window is 30 through 300 seconds. The default is 60 seconds. The exact stored observation can be older when the market is quiet, so the measured window can be longer. There is no promise to process every swap or instantly spend every fee.

Positions belong to the module instance. There is no removal, transfer, sweep or LP fee withdrawal function. Small residual quote and coin balances remain in the instance for the next eligible batch. Buyback uses the same Uniswap pool with a full-fill price guard; actual `FoundationTokenV1.burn` is used. Internal swaps still pay the normal platform and creator fees and do not recursively dispatch modules.

## Host compatibility

The currently deployed Foundation host does not let an after-swap module spend its budget or execute an internal swap. Use the new staged `FoundationAutomationHookV1`, `FoundationAutomationLedgerV1` and `FoundationAutomationHookDeployerV1` for new launches. Existing launches and their host stay unchanged.

The deployer preserves the existing `FoundationFactoryV3` ABI. The isolated adapter in `lib/module-foundation/staged/tax-automation.ts` is not imported by production. Packages require `programmable.module-foundation.auto-budget@1`, which the current website adapter does not grant. Future admission must verify the new host's `AUTOMATION_ID`, exact runtime code hashes and deployment evidence before registering this capability. Source package files are not release attestations.

## Validation completed

The focused Foundry suite uses the exact Robinhood PoolManager, PositionManager, Universal Router and Permit2 runtime bytes captured at block 78605232. These run with fresh local storage on chain ID 4663; this is not a state fork or a mainnet broadcast. The fixture records the block hash and runtime hashes. The factory test initializes the PositionManager constructor counter in its isolated storage.

The focused suite covers 256 randomized batch sizes, an atomic FactoryV3 launch, buy and sell with exact input and output, quote asset ordering, six-decimal quotes, the existing cumulative wallet limit, real burned supply, actual Core LP positions, fixed fee recipients, price-shock deferral, unauthorized calls and complete flash-accounting settlement. A separate regression covers accrued LP quote fees exceeding a batch's debit: processing continues and leaves the surplus for a later batch. Principal-spend accounting excludes that earned credit. Observed test-path gas for all three modules plus the wallet limit was about 0.94M for a cold buy and 1.77M for an eligible automatic buy; these include test-path assertions and are not wallet estimates.

Before website activation: deploy and verify the new host/deployer and the three factories, bind actual immutable addresses and runtime hashes in release evidence, then register the host capability and publish the catalog entries. Do not activate these source manifests alone. No activation or onchain deployment is performed by the preparation script.

To reproduce with the repository's pinned contract dependencies initialized:

```sh
FOUNDRY_PROFILE=tax-automation forge test --root contracts -vv
FOUNDRY_PROFILE=tax-automation forge build --root contracts --sizes
node scripts/modules/prepare-tax-automation.mjs /tmp/programmable-tax-packages 18
```

The last argument is the actual quote decimals. Use 6 for a six-decimal quote. The preparation script validates each package with the existing SDK, checks exact configuration ABI bytes and the retry selector, and confirms the current host adapter does not have the new capability. Its output is local source identity, not a fake deployment or catalog record. The existing presentation adapter exposes the module's share of creator fees independently of the five onchain configuration words.
