# Ethereum Module Mode transaction preparation

This package is generated from the website's Module Mode implementation. The API and website use the same fixed compiler artifacts, CREATE2 domains, funding validation and canonical stamp encoding. It does not contain a signer, credentials, a broadcast method, or permission to launch.

Build from the repository root with `node scripts/module-foundation/build-ethereum-package.mjs`. Use `--check` to verify the checked-in bundle. Compiler artifact regeneration is separate: `node scripts/module-foundation/export-ethereum-bytecode.mjs` verifies source hashes against the installed Foundry artifacts.

An authority must select the host source independently, verify the authenticated wallet, admit every selected module, and enforce request limits before invoking preparation. The read-only simulation funds only the simulated canonical Router. A successful simulation does not activate a release.
