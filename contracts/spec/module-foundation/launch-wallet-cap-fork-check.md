# Signed local-fork wallet-cap check

`contracts/scripts/test-launch-wallet-cap-fork.mjs` signs transactions with a separate test wallet against a local Anvil fork of Robinhood Chain 4663. It refuses a public RPC, requires a wallet-secret file with mode `0600`, checks Anvil's upstream fork configuration, and checks the deployed Foundation factory, hook deployer, Universal Router and Permit2 runtimes before signing. Keep the secret outside every Git checkout in a directory with mode `0700`.

Start a fresh Anvil fork at an explicitly recorded Robinhood block, bound to `127.0.0.1`, with no default accounts. Build only the `launch-wallet-cap` compiler profile. Then run:

```sh
node contracts/scripts/test-launch-wallet-cap-fork.mjs \
  http://127.0.0.1:18767 \
  /absolute/private/test-wallet.private.json \
  /absolute/public/evidence-directory
```

The private file contains a `privateKey` field. The runner reads it locally and does not print or copy it into evidence. The runner assigns virtual ETH only through Anvil; it neither funds the wallet on mainnet nor broadcasts to the upstream RPC.

The check uses the existing Foundation V2 native factory and canonical Uniswap contracts from the fork. It deploys only the candidate module factory and a test-only six-decimal quote token. Four launches cover ETH and another quote asset with and without the optional cap. Protected launches cover the creator's initial buy, cumulative split buys, sells without allowance reset, excess exact-input and exact-output reverts, unchanged balances and fee accounting on rejection, and unrestricted buying after expiry. Different percentage and minute settings are exercised. Unprotected launches immediately buy more than two percent of supply.

The routes use the official Uniswap V4 and Universal Router SDKs. The deployed router is unchanged. During protected swaps, wallet identity comes from the pinned Universal Router's locked [`msgSender()`](https://github.com/Uniswap/universal-router/blob/999d561c3ad58fb5cab91b602911f3c75591a9c7/contracts/base/Dispatcher.sol). The module does not use `tx.origin`, accept a wallet identity from `hookData`, or introduce a replacement router. The optional cap remains Programmable module logic, rather than a built-in Uniswap feature.

`fork-test.json` records the public wallet address, fork block, runtime pins, transaction receipts and checked scenarios. These are signed local-fork transactions, not mainnet deployment, mainnet lifecycle evidence, independent review or catalog admission. Keep production availability false until the existing release requirements are satisfied.
