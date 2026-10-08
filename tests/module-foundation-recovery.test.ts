import { afterEach, describe, expect, it, vi } from "vitest";
import { watchFoundationRecovery } from "@/lib/module-foundation/recovery";

afterEach(() => vi.useRealTimers());

describe("saved transaction recovery", () => {
  it("checks immediately and stops after the exact receipt is reconciled", async () => {
    vi.useFakeTimers();
    const reconcile = vi.fn().mockResolvedValue(undefined);
    const stop = watchFoundationRecovery({ reconcile, visible: () => true });
    await vi.runAllTimersAsync();
    expect(reconcile).toHaveBeenCalledTimes(1);
    stop();
  });

  it("backs off and keeps checking slow confirmations without overlapping reads", async () => {
    vi.useFakeTimers();
    const reconcile = vi.fn().mockRejectedValue(new Error("Receipt pending"));
    const stop = watchFoundationRecovery({ reconcile, visible: () => true });
    await vi.advanceTimersByTimeAsync(0);
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100_001);
    expect(reconcile).toHaveBeenCalledTimes(6);
    stop();
    await vi.runAllTimersAsync();
    expect(reconcile).toHaveBeenCalledTimes(6);
  });

  it("does not poll hidden pages and cancels when the account or operation changes", async () => {
    vi.useFakeTimers();
    const reconcile = vi.fn().mockRejectedValue(new Error("Pending"));
    const stop = watchFoundationRecovery({ reconcile, visible: () => false });
    await vi.runAllTimersAsync();
    expect(reconcile).not.toHaveBeenCalled();
    stop();
    const cancel = watchFoundationRecovery({ reconcile, visible: () => true });
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    await vi.runAllTimersAsync();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
