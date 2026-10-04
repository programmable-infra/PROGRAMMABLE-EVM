# CI throughput and unchanged release boundaries

## Routine website edits

Presentation changes use a short route. CSS, images and fonts qualify by their
paths and regular file modes. Existing TSX files qualify only when their parsed
code stays identical: visible JSX copy and the fixed text attributes `title`,
`alt`, `placeholder`, `aria-label` and `aria-description` may change. Imports,
handlers, URLs, conditional logic, amounts and other values remain unchanged.
Copy in scripts, form values and custom component props/children does not qualify.
Missing history or parser, malformed source, executable file modes, unknown
paths and mixed functional changes select normal verification. The classifier
is loaded from the trusted base; changes to the classifier pay the previous gate.

The presentation lane keeps the production build and credential scan. It omits
the global lint/unit batch, wallet and migration browser suites, Chromium install,
and unrelated V4 release/activation audits. Both Interface workers still finish
successfully, and the aggregate validates the exclusive presentation scope. The
existing sixteen-job proof and exact source binding remain unchanged.

After the change merges into `production`, `Publish website UI` publishes it
automatically. The publisher compares the entire diff from the live deployment
to the current production commit, then loads that deployed revision's classifier.
It builds once with the existing production Vercel configuration, waits for the
exact production Verify run, loads three public pages, confirms the branch and
live deployment have not moved, promotes the exact candidate once, and confirms
the production binding. It makes no direct Codex, indexer, wallet or RPC calls.
The existing Vercel build cache is reused; there is no forced rebuild flag.

`npm run ship:ui:plan` performs only release reads. `npm run ship:ui` recovers the
same route from a clean production checkout with the existing GitHub and Vercel
login. Never issue a second deployment while the automatic workflow is running.
An uncertain deploy or promotion response stops without automatic retry.

Functional changes retain their relevant release route. To initialize this
workflow, integrate and deploy its control changes once through that route.

## Interface verification

The stable required `Interface` check aggregates two independent checkouts of the
same source revision:

- `Interface quality and tests`: locked dependency installation, the existing
  conditional dependency audit, workflow/scope regression tests, lint, and the
  complete interface test suite.
- `Interface browser and build`: locked dependencies and Chromium, wallet browser
  tests, late-migration browser tests, production build, complete-history checks,
  V4 clean-room tests, V4 and V4.1 activation audits, and the conditional read-model
  operations gate.

Browser tests and the build remain sequential inside one checkout because they
use local servers and `.next`. Independent jobs provide filesystem and process
isolation. The local `npm run verify:interface:ci` command still runs both complete
lanes sequentially. No test inventory, fuzz budget, compiler setting, or production
bundle validation is reduced for ordinary functional changes. A separate narrow
guide-literal route is described below.

The aggregate rejects failed, cancelled, missing, inconsistent, or unexpectedly
skipped worker results. Unaffected Interface work skips both worker jobs; the
stable aggregate still runs and validates classification. `read_model=true` must
imply `interface=true`.

The production proof resolver expects the exact sixteen-job inventory, including
the two Interface workers and five Contract workers. All protected contexts and
final gates must succeed. Each worker group may only be skipped in full, with
GitHub's unassigned-runner metadata and no executed steps. Source SHA, workflow
hash, tree, run attempt, hosted-runner identity, artifact digest, attestation and
freshness checks remain in force. Earlier job inventories cannot substitute for
the workflow at this source revision. Existing proof document parsing is
unchanged; an old deployed revision continues to use its own workflow and verifier.

## Narrow guide edits and shared Interface work

Only a plain guide-URL replacement in the two fixed existing literals listed in
`scripts/ci/classify-verify-paths.mjs` can replace the global lint, full Interface
Vitest batch, and unrelated browser suites with scoped lint and 15 direct test
files. The trusted-base classifier reads actual before/after Git blobs and proves
that every byte outside the single URL is unchanged, including a UTF-8 BOM.
Missing history, unknown or mixed functional paths, invalid UTF-8, escapes,
renaming, deletion and mode changes select full coverage. The two fixed companion
Markdown files may accompany a literal edit; Markdown alone does not select it.
All existing Interface Node contracts, the complete production build and both
activation audits remain. A base classifier without this output also runs full
coverage. The existing information-architecture test remains a direct consumer
of companion Markdown and is included in this focused inventory.

When full Interface and Custom V2 are both required, the final gates require both
results while running identical global lint, 12 shared Vitest files and the Next
build only once. Custom V2-specific contracts and operations checks remain in its
worker. A standalone Custom V2 release retains its complete original command;
the guide route cannot supply shared functional coverage.

## Contract workers and a single default-profile build

The stable `Contracts` check requires five explicit jobs: one build, two complete
deterministic test partitions, release/fork verification, and static analysis.
Consumers use only the immutable artifact ID from this run. Download digest,
source SHA/tree, workflow bytes, run attempt and pinned Foundry version must all
match. This is not a cross-commit compiler or release-proof cache. The two actual
Forge inventories contain all 93 source suites; local execution passed 804 tests
with the same two existing skips. No fuzz or invariant setting changes.

Default-profile release consumers finish before the late-migration profile
compiles. Slither rebuilds its own complete build-info for both profiles and starts
directly after scope, without waiting for or downloading the default artifact.
Missing, failed, cancelled, partially skipped,
or substituted workers fail the protected aggregate. Detailed command ownership
and artifact boundaries are documented in `scripts/ci/README.md`.

## Run cancellation and installation

Concurrency groups include the source ref and closed verification intent. A
manual Custom V2 release verification cannot cancel a production push; newer
changes still supersede older work of the same intent on the same ref. Locked
dependency installation disables implicit audit/funding requests, while explicit
dependency security gates remain on their existing scopes.

## Exact CLI-coordinate classification

Only
`docs/operations/releases/custom-launch-v4.1/clean-room-release-coordinate.json`
is routed directly to Interface instead of the general release-document fallback.
Its consumers are public CLI discovery and the existing V4.1 activation audit.
That audit binds the complete coordinate bytes to the signed activation record,
producer source, immutable release assets and tag.

Coordinate schemas, verification code, dependency changes, unknown successors and
other release documents retain their existing gates. Mixing the coordinate with
Solidity adds Contracts; mixing it with the short-lived backend-evidence pair
still fails the exact-pair guard. The classifier is loaded from the trusted base,
so this routing change pays the existing full CI once before it can select later
changes.

## Fork RPC order

Mainnet fork tests try the existing Tenderly public endpoint first. In both
observed release runs it completed the entire mainnet suite after five preceding
public endpoints had failed or timed out. All endpoints, configured endpoint
precedence, retry conditions and the 90-second per-process timeout are retained.
This reordering does not create a new trust source or replace any contract test.

A subsequent hosted run exposed a separate timeout problem: its first provider
completed 25 suites with 100 passing tests and no test failures before the single
30-file process hit that timeout. Split this explicit inventory into three
interleaved groups of ten files, distributing the Stock-Paired deployment suites.
The two separate Safe groups and all six Sepolia files remain. Every original
file is still required exactly once; test profiles and budgets are unchanged.
One provider must pass every group for its chain. A provider failure restarts the
complete chain inventory on the next provider; configured endpoints never fall
back. Required runner tests check coverage, grouping, timeout and failure behavior.

Public RPC availability can change. Use the actual per-provider outcomes from a
new run to assess the improvement; do not equate a current connectivity probe with
completed fork-test coverage.

The official-runtime verifier additionally reads its six contracts sequentially
at the same block to avoid a provider burst. Each request has a ten-second
timeout; recognized infrastructure failures can restart the complete snapshot
using the next fixed default provider. An explicit RPC remains the sole provider.
Wrong chain, empty or mismatching code, malformed replies and unknown errors
remain failures. The generated source manifest records the changed fork-wrapper
digest; registry bytecode, ABI and event documents are unchanged.

## Baseline and measuring the result

| Observed run | Baseline |
|---|---|
| [Guide-link PR Verify](https://github.com/programmablehq/PROGRAMMABLE/actions/runs/33980193153) | Interface job 391 seconds: unchanged main command 297 seconds, dependency installation 37 seconds, Chromium installation 28 seconds. |
| [CLI-coordinate PR Verify](https://github.com/programmablehq/PROGRAMMABLE/actions/runs/33975689855) | Contracts job 1,121 seconds; the single changed coordinate file selected every major lane. |
| [Production Verify](https://github.com/programmablehq/PROGRAMMABLE/actions/runs/33976644966) | Contracts job 1,084 seconds; unsuccessful mainnet provider attempts consumed about 263 seconds before the eventual successful provider. |
| [Stage Production Candidate](https://github.com/programmablehq/PROGRAMMABLE/actions/runs/33980910501) | About 277 seconds end to end; the source-build step took 167 seconds. Vercel restored its existing build cache. |

These are measurements before the change, not measured new runtimes. Compare a
complete new affected Interface run, an unaffected Interface run, and the next
legitimate Contracts run. Preserve the complete step and job outcomes as well as
duration and queue time; a shorter cancelled run is not an improvement.

Vercel continues to build exact reviewed source without assigning production
domains during staging. The existing production proof and stage/live evidence
are separate checks. A manual `custom-v2-release` Verify has a different full-tree
verification intent from a path-scoped push, so do not remove it merely because
both runs use the name `Verify`. Branch protection, activation records, environment
configuration, credentials, database access, deployments and wallet actions are
outside this source-only optimization.
