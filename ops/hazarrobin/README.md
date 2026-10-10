# Hazarrobin fee dashboard

Three claim areas on https://hazarrobin.vercel.app:

1. Programmable V4: immutable Robinhood LP locker, position 1708785.
2. Robinhood ecosystem: Foundation releases, historical Module Mode ledgers, verified native custom fee vaults.
3. Ethereum ecosystem: Foundation graph launches, classic/stock hooks, supported custom fee profiles and native fee vaults.

The app has no signing key. Users sign with their wallets. Fixed-recipient claims are grouped through the pinned Multicall3; sender-restricted legacy claims require the recipient wallet. Claims never withdraw LP principal, redirect fees, swap assets, or impose a minimum amount. Incomplete sources remain explicitly visible and are never reported as zero balances.

## Local verification

`npm ci`, `npm test`, `npm run build`. Vercel serves `api/scan.mjs` and the read-only `api/rpc.mjs`. Required server environment: RH_PRIMARY, RH_SECONDARY, ETH_PRIMARY, ETH_SECONDARY; ETH_TERTIARY is optional. Use independent providers with archive access. Values must never be exposed to the browser or committed.

## Source provenance

The fee readers and source recipes are adapted from ops/protocol-fee-claim and the immutable native-fee source proofs in lib/custom-launch at production 77e15371fc9125ed607d30fae7f264a07fa18dba. Pinned release history is in vendor/deployments.json. Future launches through these sources are discovered automatically, including unlisted launches. A new contract source requires a reviewed adapter/release binding. Arbitrary custom code is not assumed to share a fee interface.

## Release

This standalone Vercel project is `hazarrobin`, separate from the main product website and claimhazard. Preview from a feature branch. Merge to production, then publish from a clean integration checkout of that exact commit. Do not invoke the main website publisher for this dashboard.
