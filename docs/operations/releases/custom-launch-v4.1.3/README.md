# CLI 4.1.3 Ethereum capabilities client release

CLI `4.1.3` supports explicit Ethereum `3.5.0` and `3.6.0` in the V3 pack, validation, submit and status flow.
Fresh CLI packs with no explicit version select the exact authorized server capabilities profile; the offline
library default stays `3.3.0` and stored requests reproduce their exact version. The Robinhood API identity
remains `4.1.0`, revision `2`. Ethereum `3.5.0` remains inactive. Publishing the client does not activate a profile.
Direct HTTP clients use the same V3 request and do not require this CLI.

This procedure prepares the separate immutable GitHub Release `programmable-launch-v4.1.3`.
Source checks do not establish publication or production readiness. The package is not published to npm.

## Source binding

`cli-release-binding.json` binds the package identity and lockfile, existing response and coverage readers,
the executable entry point, the Ethereum pack and validation paths, capabilities selection, both explicit
3.5/3.6 schemas, the complete 3.6 trade policy and all four packaged V2 settlement-vault release files.
The 3.6 policy hash is `sha256:5956cdeee628ba84dfa5214efd532011e59c202e4e1c1830b1eca279d58d79d3`.
This record does not claim active Ethereum capabilities or executed trade collection. It references the unchanged API `4.1.0` release
binding by exact path, schema and digest. The record has no `releaseReady` field or production approval.

After freezing the client source, regenerate only the 4.1.3 record and review its diff:

```sh
node scripts/programmable-launch-v413-release-binding.mjs create-client-binding --repository-root . \
  > docs/operations/releases/custom-launch-v4.1.3/cli-release-binding.json
node scripts/programmable-launch-v413-release-binding.mjs audit-source --repository-root .
```

`audit-source` reports `productionEvidenceVerified: false`. `audit` also checks the unchanged API binding;
`verify-release-ready` requires its original authenticated production proof and backend authorization.
The API profile, policy, deployment, finality and source gates remain mandatory for this client patch.

Run the focused release checks with Node `24.14.0` and npm `11.16.0`:

```sh
node --test scripts/test/programmable-launch-v413-release-binding.test.mjs \
  scripts/test/programmable-launch-v412-release-binding.test.mjs \
  scripts/test/programmable-launch-v411-release-binding.test.mjs \
  scripts/test/programmable-launch-release-assets.test.mjs \
  scripts/test/programmable-launch-release-workflow.test.mjs
```

The 4.1.2 tests now read 18 exact Git blobs from commit
`54ce42d8d5f6e3b68b27cde6f87d3f01195b4184` as bounded, offline JSON test data. The compressed snapshot
SHA-256 is `72d1bc6578749bedf1be716e0e6c760415f81ead72dddb3f1f0748a1355906b3`; input is limited to
256 KiB and decompressed JSON to 1 MiB. Every source digest is checked against the historical binding,
and the old binding, schema, helper and runbook retain their exact bytes. The existing 4.1.1 snapshot
is unchanged. Neither test suite executes snapshot code or requires historical Git objects at runtime.

## Protected publication

Deploy the website's 3.6 reader and capability-driven guidance before selecting backend profile 3.6.
Independently activate and verify the complete backend 3.6 capabilities, then publish this CLI release.
The pre-activation website must direct clients to current capabilities and must not assert that 3.6 is active.
Profile 3.6 uses the static 3.3 baseline, three through sixteen targets and no mandatory canonical fee vault,
settlement-dataflow closure or 3.4/3.5 behavior inputs. A native30 waiver still requires server runtime and
per-trade accrual proof; launch admission is not collection evidence. Profile 3.5 remains inactive.

1. Merge the reviewed release-plumbing candidate into `production` and obtain a fresh, authenticated
   production `Verify` proof for that exact commit and tree. The release workflow requires the current
   protected production tip and matching workflow revision.
2. Complete the existing [owner preflight procedure](../../programmable-launch-cli-release.md#one-time-repository-controls)
   from that clean checkout. Keep the existing owner trust root, signature namespace, actor checks,
   tag protections and ten-minute observation window. Copy only the public signed record and signature
   into the existing protected environment variables; owner keys remain local.
3. After publication authorization, dispatch a fresh first attempt with the exact version:

```sh
gh workflow run release-programmable-launch.yml \
  --repo programmablehq/PROGRAMMABLE --ref production -f version=4.1.3
```

The 4.1.3 branch selects its own client binding and retains all existing v41 clean-room, profile and
backend evidence gates. Before creating the tag or release, the workflow repeats the owner preflight
and the original v41 finalizer's provider, Sourcify and backend readback. It must establish the same
public authorization, readiness and Phase B digest required for earlier client patches.
No tag, asset, signed evidence or historical release identity is replaced.

## Downloaded-asset verification

After publication, record the exact tag target, immutable state and release URL. Download and verify
the four new assets from the exact protected production checkout, with its authenticated proof and
unchanged API backend authorization available:

```sh
client_release_dir="$(mktemp -d)"
gh release verify programmable-launch-v4.1.3 --repo programmablehq/PROGRAMMABLE
gh release download programmable-launch-v4.1.3 --repo programmablehq/PROGRAMMABLE --dir "$client_release_dir"
for client_asset in "$client_release_dir"/*; do
  gh release verify-asset programmable-launch-v4.1.3 "$client_asset" --repo programmablehq/PROGRAMMABLE
done
node scripts/programmable-launch-release-assets.mjs verify \
  --repository-root . --output-dir "$client_release_dir" \
  --source-ref refs/heads/production --expected-version 4.1.3
```

The expected assets are `programmable-launch-4.1.3.tgz`, its `.tgz.sha256` checksum,
`programmable-launch-4.1.3.cdx.json` and `programmable-launch-4.1.3.release.json`.
The manifest binds the exact source commit/tree, toolchain and 4.1.3 client record; verification also
requires the original API release gates. Install the independently verified tarball into a temporary
prefix and require `programmable-launch --version` to print `4.1.3`. Check capability-selected fresh packs,
explicit 3.6 configuration and historical exact-byte reproduction. Record publication, API
activation and wallet lifecycle verification as separate results.
