# Ethereum Module Mode implementation status

Status on 2026-10-05: implemented and tested in a feature worktree; not deployed, admitted or available in production.

## Existing identity and indexing

The Ethereum adapter uses the existing canonical Stamp Router at `0x8622DD5bAb44185f2A458ac90384Ac99248f8d56` and Graph Factory at `0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887`. Their observed runtime hashes, together with the Ethereum Uniswap infrastructure, are pinned in `contracts/spec/module-foundation/chain-1.v1.json` at block 26125239. That file is an infrastructure observation, not a host deployment or release approval.

Launch identity remains `(chainId, router, launchId)` and token identity remains `(chainId, token)`. The canonical `ProgrammableLaunchStampedV1`, `ProgrammableLaunchRouteStampedV1`, `ProgrammableComponentStampedV1`, `launchStamp`, `launchIdByToken`, `launchIdByPool`, `launchIdByComponent`, `componentRuntimeCodeHash` and `stampProof` interfaces retain their existing meaning.

The new execution route is `CustomGraph` in the canonical ABI. It creates a Module Mode coin, but it does not emit a counterfeit Classic launch or claim Classic vault custody. Integrators following the canonical stamp can observe it with the existing ABI. An integrator restricted to the Classic launcher or its events must add this launch source. External indexing is not established by an internal fork test.

## Contracts and UI

`FoundationEthereumGraphLaunchV1` contains the shared settlement implementation. Each launch creates a fresh `FoundationEthereumGraphProxyV1`, the unchanged Foundation token and the Foundation V2 hook through the Graph Factory. The proxy binds an immutable implementation address and runtime hash. It has no upgrade entrypoint. Its constructor initializes the launch wallet, and the Graph Factory initializes the token and pool once. The implementation cannot be used as a launch account itself.

The launch wallet receives the initial buy and any native refund. Base liquidity and rounding inventory retain the existing irreversible DEAD custody. Platform fees remain 30 basis points. Directional creator fees and module callbacks retain their existing semantics. The Ethereum wallet-cap factory binds the Ethereum Universal Router; the module's implementation and configuration remain shared.

The Studio uses one UI on both networks. Chain profiles select infrastructure, WETH, quote discovery, RPC clients and finality. Prepared actions, pending transactions, results and caches include chain identity. Changing networks remounts the launch session. Ethereum Any Quote discovery uses Ethereum V4 pools and the Ethereum price feed; it does not borrow Robinhood routes or stock feeds.

The Ethereum graph readback adapter reuses the canonical stamp reader and verifies the launch account's implementation, wallet, initialization, parameter hash, launch result and position custody. Its public fixture contains call bytes from the fork test and an explicit note that the permit signature was stubbed. The adapter is not yet connected to the production source inventory or indexing job.

## Validation completed

- Twenty Ethereum fork tests cover native funding, directional fees, canonical stamping, initialization boundaries, missing permit authorization and the real wallet-cap module's initial buy, later purchases, rejection and expiry.
- The canonical graph test uses the existing Ethereum Router, Graph Factory and Uniswap contracts. Only its exact EIP-1271 permit authorization is stubbed locally. No live permit was obtained and no transaction was broadcast.
- A two-module fixture consumes approximately 9.79 million gas including intrinsic calldata. An eight-module heavy fixture exceeds Ethereum's transaction gas cap. Wallet preparation rejects an excessive estimate; it does not assume every eight-module composition is deployable.
- The relevant existing web suites passed: 838 tests in 52 files. The additional Ethereum owner-finality case passed in the five-test owner suite. Six graph readback tests passed using the exported fork call.
- The website production build passed. After adding graph readback, the full TypeScript check and focused lint both passed. The graph adapter is not yet imported by a production route.

## Work required before activation

1. Deploy and source-verify the shared implementation and Ethereum wallet-cap factory. Reconcile receipts, code and deployment finality. The prepared unsigned deployment plan is outside Git; its nonce, gas estimate and predicted addresses must be refreshed before sending.
2. Add the host's graph source binding and permit preparation to the production authority. The existing Foundation authority describes direct factory launches on Robinhood. The general Ethereum API's current 3.3 profile is not a drop-in Module Mode profile: its metadata requirements and 0.1% fee policy differ. Do not reuse its approval or claim 0.3% conformance without the correct versioned integration.
3. Connect Studio composition to graph prediction, the real canonical permit and exact wallet calldata. The current composition path still calls direct-factory prediction and cannot launch this graph account. Preserve immediate wallet interaction where possible and invalidate changed chain, wallet, source, fee or module inputs.
4. Connect the graph readback adapter and admitted host inventory to recovery, market projection and background indexing. Do not classify a launch as a module merely from its name or optional metadata.
5. Exercise a real funded mainnet launch, initial buy, later buy and sell, fee accounting, module behavior and recovery. Verify the exact production build and responsive Studio before enabling the network.
6. Complete the shared publication coordinator described in `MULTICHAIN-PUBLICATION.md`. Until then, accepting Ethereum owner records must not be described as publishing new module versions to both chains automatically.

At the last balance check, the existing automation wallet had zero ETH on Ethereum. No external signing, broadcast, spending, source submission, catalog mutation or production publication occurred during this implementation.
