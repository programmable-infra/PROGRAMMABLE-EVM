---
description: Verify Ethereum Custom Launch stamps across current and historical Router generations
---

# Index Custom Launches on Ethereum

Use chain ID `1` (`eip155:1`) and the token address. The launch may create a new token or attach a hook and pool to an existing token. Its verified stamp determines the token identity.

## Discover launches

| Resource | Use |
| --- | --- |
| [Developer manifest](https://developers.programmable.family/api/v2/manifest) | Router deployments, ABIs, runtime hashes, start blocks and finality policy |
| [Developer status](https://developers.programmable.family/api/v2/status) | Coverage, checkpoints and freshness |
| [Launch feed](https://developers.programmable.family/api/v2/launches) | Normalized launch records; use the [OpenAPI contract](https://developers.programmable.family/openapi/programmable-v2.yaml) for pagination and fields |
| `GET https://developers.programmable.family/api/v2/launches/1/{tokenAddress}` | Point lookup by Ethereum token address |
| [Router identity snapshot](https://programmable.market/api/indexers/v1/router-custom-identities) | Canonical Router Custom identities and source evidence |
| [Finalized V3 feed](https://api.programmable.market/v3/finalized-custom-launches) | Records finalized through the V3 launch service |

These public reads need no launch API key. No single service-specific feed should be assumed to cover every launch source. Check reported coverage and preserve original evidence alongside normalized records.

## Include every Router generation

Build the Router set from both manifest locations:

```text
launchStampRouter
extensions["programmable/launch-stamp-router-generations-v1"].routers[]
```

Deduplicate by chain ID and Router address. Preserve each deployment's `startBlock`, optional `endBlock`, `runtimeCodeHash`, `abiUrl`, `abiSha256`, bindings and finality policy. Resolve `verificationInterfacePointer` where supplied: a successor can share the primary Router's event/getter interface while having its own runtime and address.

Do not scan only the primary Router or replace all historical Routers with the newest one. This would omit valid launches. A Router address is part of the launch identity:

```text
coin:   (chainId, tokenAddress)
launch: (chainId, routerAddress, launchId)
pool:   (chainId, poolManager, poolId)
event:  (chainId, blockHash, transactionHash, logIndex)
```

If an interface or deployment cannot yet be verified, preserve it as unsupported or pending evidence. Do not silently accept it or report its history as empty. Historical Registry and Classic deployments retain their own manifest adapters; do not require a newer Router stamp for those records.

## Verify one launch

1. Download the exact ABI bytes and check their SHA-256 against the deployment descriptor. Check the Router's runtime hash and infrastructure bindings on Ethereum.
2. Scan the descriptor's published event range. Correlate `ProgrammableLaunchStampedV1`, `ProgrammableLaunchRouteStampedV1` and component events by Router and launch ID within the successful receipt.
3. Apply that deployment's finality policy. At the same canonical block, compare `launchIdByToken`, `launchIdByPool`, `launchStamp` and `stampProof` with the receipt and discovery record. Check the recorded component runtime hashes and roles. Shared infrastructure is not a unique launch locator.
4. Preserve the token, hook, PoolManager, full PoolKey, pool ID, launch ID, stamp hash, transaction and canonical block evidence. Keep source verification results separately.
5. Upsert the coin by chain and token address. Attach the verified launch and pool references without substituting the graph account, controller or hook for the token.

A Custom Launch with an existing ERC-20 does not need a token deployment event in the launch receipt. Read the token bound by the stamp. Likewise, token name, symbol or an explorer's label alone cannot establish Programmable origin.

## Distinguish Module Mode

Ethereum Module Mode also uses the canonical Router's `custom-graph` path. A normalized `custom` category is therefore insufficient to distinguish a user-written hook from a Module Mode coin.

After verifying the stamp, follow [Ethereum Foundation verification](foundation-indexing.md#ethereum-module-launches) to bind the module implementation, initializer, graph account, token, hook and pool. Store the module classification alongside the original Router classification.

The manifest's `programmable/module-discovery-v1` extension supplies the module guide, discovery feed, availability endpoint and source snapshot. Its `normalizedDeveloperFeedCoversAllModuleSources` field explicitly describes coverage. Use the module source adapter when coverage is incomplete.

## Backfill and follow

Backfill every selected deployment from its start block in bounded ranges. Traverse all feed pages using their documented cursor or page contract. Persist records and checkpoints atomically, resume with an overlap, and deduplicate by the keys above. A `last-known-good`, partial or stale response is not a complete fresh scan.

If a block hash changes, return to a common canonical checkpoint and replay affected records. Keep an already verified launch visible while optional image or price enrichment retries. Follow the [shared pair, metadata and trading rules](indexing.md#show-the-pair-image-and-links).

A review approval or wallet signature is not launch evidence. Once the finalized receipt and stamp are valid, missing display attribution is an indexing issue; it does not require another launch transaction.
