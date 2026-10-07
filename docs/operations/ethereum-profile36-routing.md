# Ethereum profile 3.6 trading

Profile 3.6 charges 30 basis points on Programmable's Ethereum routes. A buy transfers `floor(funded ETH input * 30 / 10000)` to the fixed Treasury before swapping the remaining input. A sell uses Uniswap V4 `TAKE_PORTION` on native output credit, then delivers the net output. These charges do not establish a fee on external routes.

An exact `EthereumNative30HookV2` and its child `EthereumNativeFeeVaultV2` can waive the additional routing fee. The server checks the reviewed runtime templates, immutable pool binding and current module code, then proves the actual callback, fee ledger increment and native ERC-6909 backing. A getter or applicant declaration cannot waive the fee.

The classification boundary is Ethereum block `26142122`, hash `0x823e99cec0bb5b6011afc44891a1fd897b7efcbd83658cb9bc176dc35f5f86a3`. This block was finalized before any profile 3.6 authorization. Its hash was independently read through dRPC and QuickNode. Stamps at or before the boundary retain their existing route. Later stamps require a canonical finalized API record that matches the full stamp coordinates. Missing or inconsistent records keep preparation pending; they never select a free route.

The website must publish this reader and fee implementation before the API selects profile 3.6. A version selection or successful launch alone is not fee-execution evidence. Actual mainnet deployment, trading and claim receipts remain separate release evidence. Historical signed fee obligations remain unchanged.

Focused checks cover exact buy/sell encoding, policy substitution, missing classifications and runtime drift. Read-only Ethereum traces through both providers additionally exercised the actual router for buy/sell, Treasury as trader and pre-existing native router dust. Those traces use state overrides and are not broadcast transaction receipts.
