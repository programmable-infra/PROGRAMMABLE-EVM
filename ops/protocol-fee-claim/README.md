# Protocol fee console

The Ethereum action claims only the verified sources listed with an amount.
Unsupported Router claim profiles remain visible and are excluded from both the
displayed claimable total and wallet calldata. They do not block independent,
verified claims. A provenance failure, supported binding mismatch, unreadable
known balance, failed simulation or unresolved prior submission still blocks the
claim. This console is not a claim of complete ecosystem coverage.

Ethereum submissions contain at most ten verified calls, matching MetaMask's
`wallet_sendCalls` limit. Larger inventories stay visible and are claimed in
successive packets. Each packet needs its own wallet confirmation; the existing
confirmation/finality lock is retained before the next packet. Stored older
batches retain their original payload and recovery state.

Robinhood Foundation claims use two independent server-side RPC providers.
`FEE_CLAIM_ROBINHOOD_PRIMARY_URL` and `FEE_CLAIM_ROBINHOOD_SECONDARY_URL` remain
Vercel server secrets. Browser clients call the bounded read/simulation proxy;
wallet signing and broadcast remain in the user's wallet.

Run `npm ci --ignore-scripts`, then `npm run check` in this directory. Deploy this
directory to the existing `claimhazard` Vercel project after reviewing and merging
the exact source. This is separate from the main website deployment.
