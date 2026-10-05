# Shared Module Mode publication

## Decision and current status

The owner requested on 2026-10-05 that adding a module on Robinhood also makes the same module version available on Ethereum mainnet. The implementation target is one publication job with both networks as required targets. After Ethereum Module Mode is enabled, new versions become selectable on both chains through one shared activation record.

This is a design decision, not an implemented deployment pipeline. Module Mode currently launches on Robinhood. Ethereum Custom Hook support does not establish Ethereum Module Mode support. The Ethereum implementation has chain profiles, a shared UI, an immutable graph launch account and fork-tested canonical stamping. Production host admission, graph wallet preparation and the shared publication coordinator still need integration and release evidence. See [the Ethereum implementation status](ETHEREUM-MAINNET.md).

## One package, separate deployments

Keep one immutable source package, package identity, module version, configuration schema, description and visual asset. A new version is submitted or owner-published once through the existing publication authority. Its publication job targets chain IDs 4663 and 1.

Each target has its own host release binding, factory address, constructor arguments, deployment transaction, runtime hashes and verification evidence. Runtime hashes may differ when constructor bindings differ. Shared source identity is not proof of a deployed runtime on another network.

Resolve Uniswap contracts, wrapped ETH, quote assets, price routes and checkpoint rules through the selected chain profile. A module that depends on an asset or external contract must have a compatible verified binding on each required chain. Do not substitute an address, silently drop a capability or declare the other deployment available when its dependency is missing.

Use durations in seconds where the user chooses a time interval. Do not transfer Robinhood block-count assumptions to Ethereum. Execution, fee accounting and declared module capabilities need appropriate verification on both networks.

## Publication job and activation

1. Bind the exact source package and version to one publication identity and the required target set. Preserve the existing owner or independent review authority.
2. Prepare the target-specific deployment plans and verify module compatibility with each admitted host release. Use the existing signing and spending authorization rules.
3. Deploy on both networks, retaining evidence separately. Key deployment attempts by publication identity and chain ID. After an interruption, reconcile transaction receipts and runtime identity before resuming unfinished work.
4. Verify deployment finality, runtime bindings, source identity and the exercised lifecycle on each target through the existing release authorities. A successful transaction alone does not make a module ready.
5. Activate the complete target set through one shared catalog record only when both targets are ready. Until then, keep the previous active version selectable on both chains. An initial version remains pending on both until ready.

Catalog readers select addresses and host bindings for the requested chain from the shared active publication. They must validate that chain explicitly. They must not infer support from a module name, duplicate an entry into another catalog or reuse the other chain's trusted runtime snapshot. A deployment completing on one network must not expose a partially published version.

Concurrent readers and publication retries should share bounded work. Use one targeted catalog invalidation after activation rather than per-module client polling. Retain immutable deployment evidence for retry and recovery; refresh runtime evidence when the existing transaction-preparation rules require it.

## Application integration

The existing catalog already separates a `FoundationModuleManifestV1` from a `FoundationReleaseReferenceV1`, whose fields include `chainId`, factory and evidence digests. The owner-publication verifier and runtime reader accept explicit Ethereum and Robinhood identities, including Ethereum deployment finality. The existing publication operator still deploys and publishes one Robinhood target. Introduce a versioned shared publication envelope that groups the per-chain records, keeping existing single-chain publications readable. Porting the verifier does not make publication atomic across chains.

Pass the selected chain and release identity through availability, composition, asset resolution, launch preparation, pending transactions, readback and indexing. Include both in cache and idempotency keys. Network changes must invalidate a prepared wallet request. Do not change a shared global chain constant while another operation is running.

Use the same Module Mode components and configuration forms on both networks. The chain profile supplies execution bindings; the module package supplies the interface. The user should not need a second publication request or a separate implementation for Ethereum.

## Release boundary

Before enabling joint publication, demonstrate that a version with only one verified target remains pending, that retries preserve completed deployments, and that each chain uses only its own host, factory, wallet preparation and discovery identity. Verify a complete module launch and its declared behavior on both chains before activation.

New module versions apply to new launches. Existing coins retain their immutable module instances and pool keys. Publishing the same module on another chain does not move existing coins or synchronize their balances and module state.
