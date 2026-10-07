# Public data sources

Codex (`graph.codex.io`) supplies token prices, charts, volume, market
capitalization and exact-pool liquidity for Ethereum and Robinhood. A missing
observation is shown as unknown; the website does not substitute DexScreener
or an independently computed price.

Ethereum Classic launch discovery uses Codex `filterPairs` with the released
Uniswap v4 hook addresses. Every page uses a fixed creation-time boundary.
`count` is the number of results in one page, so discovery continues until a
short page. Token creation transaction hashes also come from Codex.

The website verifies each discovered launch receipt against the pinned
launcher, hook and full launch event bundle. This establishes creator and
reward-vault authority. These are individual contract checks, not a second
history-scanning index. A verified market observation cannot grant permission
to claim another wallet's rewards.

Explore, creator articles and Classic reward actions share this Codex-backed
catalog. Source evidence identifies Codex and the release digest. Its block
number identifies the contract-verification boundary; it is not a claim about
Codex's internal indexing watermark. New observations are cached for 15 seconds;
a failed refresh may use the last verified catalog, marked `last-known-good`,
for at most five minutes.

Custom and Module launch records retain the platform's transaction and finality
evidence, including launches that have not created a market yet. Their market
observations come from Codex. Claims continue to read contract balances and
beneficiaries. Envio is no longer a live website catalog dependency. Historical
release artifacts remain evidence of previous deployments.
