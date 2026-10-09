import test from "node:test";
import assert from "node:assert/strict";
import { routerClaimCoverage, customClaimDefinitionClassification, nextWalletClaimBatch,
  WALLET_CLAIM_BATCH_LIMIT, buildWalletSendCalls, TREASURY, CLAIMS } from "./logic.mjs";

test("MetaMask packets keep all claims available without exceeding ten calls", () => {
  const inventory = CLAIMS.slice(0, 14);
  assert.equal(inventory.length, 14);
  const first = nextWalletClaimBatch(inventory);
  const remaining = inventory.filter(claim => !first.includes(claim));
  const second = nextWalletClaimBatch(remaining);
  assert.equal(WALLET_CLAIM_BATCH_LIMIT, 10);
  assert.equal(buildWalletSendCalls(TREASURY, first).calls.length, 10);
  assert.equal(buildWalletSendCalls(TREASURY, second).calls.length, 4);
  assert.deepEqual([...first, ...second], [...inventory].sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(nextWalletClaimBatch([]), []);
});

test("new fees in an earlier packet cannot starve the remaining claims", () => {
  const inventory = CLAIMS.slice(0, 14);
  const first = nextWalletClaimBatch(inventory);
  const remaining = inventory.filter(claim => !first.includes(claim))
    .sort((a, b) => a.id.localeCompare(b.id));
  const next = nextWalletClaimBatch(inventory, first.at(-1).id);
  assert.deepEqual(next.slice(0, remaining.length), remaining);
  assert.equal(next.length, 10);
  assert.equal(new Set(next.map(claim => claim.id)).size, 10);
});

test("unsupported Router sources do not contaminate independent verified claims", () => {
  const unsupported = { launchKind: 1, origin: "launch-stamp-router", claimMode: "unsupported",
    provenanceVerified: true, runtimeVerified: true, claimBindingVerified: false, amount: 0n };
  const ready = { ...unsupported, claimMode: "manual", claimBindingVerified: true, amount: 10n };
  const coverage = routerClaimCoverage([ready, ...Array.from({ length: 340 }, () => ({ ...unsupported }))]);
  assert.equal(coverage.unsupported.length, 340);
  assert.equal(coverage.blocked.length, 0);
  assert.equal(customClaimDefinitionClassification(unsupported, unsupported), "blocked");
  assert.equal(customClaimDefinitionClassification(ready, ready), "ready");
});

test("supported binding and provenance failures still block a scoped claim", () => {
  const source = { launchKind: 1, origin: "launch-stamp-router", claimMode: "manual",
    provenanceVerified: true, runtimeVerified: true, claimBindingVerified: false, amount: 10n };
  for (const invalid of [source, { ...source, claimMode: "unsupported", provenanceVerified: false },
    { ...source, claimMode: "unsupported", runtimeVerified: false }]) {
    assert.equal(routerClaimCoverage([invalid]).blocked.length, 1);
    assert.equal(routerClaimCoverage([invalid]).unsupported.length, 0);
  }
});
