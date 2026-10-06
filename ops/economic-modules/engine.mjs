/** One bounded pass. The caller supplies a locked durable journal and a verified-chain adapter. */
export async function runEconomicPass({ targets, state, adapter, persist, now, broadcast = false, maxChecks = 8 }) {
  state.targets ??= {};
  state.cursor ??= 0;
  const report = { checked: 0, ready: 0, submitted: 0, deferred: 0 };
  if (state.pending) {
    // A signed transaction is journalled before its first submission. Retry the exact same bytes,
    // including nonce, until a confirmed receipt exists. Never replace it with a fresh transaction.
    const result = await adapter.receipt(state.pending.hash);
    if (!result) {
      if (broadcast) await adapter.submit(state.pending.raw);
      return { ...report, pending: true };
    }
    const entry = state.targets[state.pending.target] ??= {};
    entry.nextAt = now + (result.success ? 60 : 3600);
    entry.failures = result.success ? 0 : (entry.failures ?? 0) + 1;
    state.lastReceipt = { hash: state.pending.hash, success: result.success };
    delete state.pending;
    await persist(state);
  }
  for (let count = 0; count < Math.min(maxChecks, targets.length); count++) {
    const target = targets[state.cursor % targets.length];
    state.cursor = (state.cursor + 1) % targets.length;
    const entry = state.targets[target.id] ??= {};
    if ((entry.nextAt ?? 0) > now) continue;
    report.checked++;
    let transaction;
    try {
      transaction = await adapter.prepare(target, entry);
      entry.failures = 0;
      entry.nextAt = now + 60;
    } catch {
      entry.failures = (entry.failures ?? 0) + 1;
      entry.nextAt = now + Math.min(3600, 60 * 2 ** Math.min(entry.failures, 6));
      report.deferred++;
    }
    await persist(state);
    if (!transaction) continue;
    report.ready++;
    if (!broadcast) continue;
    // Signing/preparation failures are safe to retry: no transaction has been submitted here.
    const signed = await adapter.sign(transaction);
    state.pending = { ...signed, target: target.id };
    await persist(state);
    await adapter.submit(signed.raw);
    report.submitted++;
    break; // Single in-flight transaction per chain, even when more targets are ready.
  }
  return report;
}
