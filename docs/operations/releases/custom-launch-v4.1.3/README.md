# CLI 4.1.3 Ethereum candidate client release

CLI `4.1.3` adds explicit Ethereum `profileVersion: "3.5.0"` support to the existing V3 pack, validation,
submit and status flow. The default Ethereum profile remains `3.3.0`; the Robinhood API identity remains
`4.1.0`, revision `2`. Ethereum `3.5.0` is inactive and requires authenticated server capabilities and
release evidence before a wallet handoff. Publishing the client does not activate that profile.
Direct HTTP clients use the same V3 request and do not require this CLI.

This procedure prepares the separate immutable GitHub Release `programmable-launch-v4.1.3`.
Source checks do not establish publication or production readiness. The package is not published to npm.

## Source binding

`cli-release-binding.json` binds the package identity and lockfile, existing response and coverage readers,
the executable entry point, the Ethereum pack and validation paths, the explicit 3.5 configuration schema,
and all four packaged V2 settlement-vault release files. The Ethereum schema is a packaged candidate;
this record does not claim a published 3.5 API contract. It references the unchanged API `4.1.0` release
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
prefix and require `programmable-launch --version` to print `4.1.3`. Check the unchanged default and
the explicit candidate behavior against current server capabilities. Record publication, API
activation and wallet lifecycle verification as separate results.
