import { afterEach, describe, expect, it, vi } from "vitest";
import { EthereumRpcBudget, EthereumRpcBudgetBusy, ethereumRpcRateLimited } from "@/lib/server/swap/ethereum-rpc-budget";

afterEach(() => { vi.useRealTimers(); });

describe("Ethereum provider preparation budget", () => {
  it("paces consecutive preparations against the same provider without adding RPC calls", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const budget = new EthereumRpcBudget(() => Date.now());
    const started: number[] = [];
    const reads = Array.from({ length: 48 }, () => budget.acquire().then(() => started.push(Date.now())));
    await Promise.resolve(); expect(started).toHaveLength(16);
    await vi.advanceTimersByTimeAsync(1_049); expect(started).toHaveLength(16);
    await vi.advanceTimersByTimeAsync(1); expect(started).toHaveLength(32);
    await vi.advanceTimersByTimeAsync(1_050); await Promise.all(reads);
    expect(started).toHaveLength(48);
    for (const start of started) expect(started.filter(value => value >= start && value < start + 1_000).length).toBeLessThanOrEqual(16);
  });

  it("shares a bounded cooldown across waiting reads after a provider limit", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const budget = new EthereumRpcBudget(() => Date.now());
    budget.pause(); const started: number[] = [];
    const pending = budget.acquire().then(() => started.push(Date.now()));
    await vi.advanceTimersByTimeAsync(1_099); expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); await pending; expect(started).toEqual([1_100]);
  });

  it("rejects excess queued work before issuing a provider request", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const budget = new EthereumRpcBudget(() => Date.now());
    budget.pause(); const pending = Array.from({ length: 64 }, () => budget.acquire());
    await expect(budget.acquire()).rejects.toBeInstanceOf(EthereumRpcBudgetBusy);
    await vi.runAllTimersAsync(); await Promise.all(pending);
  });

  it("expires queued work when a provider cannot resume within the wait budget", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const budget = new EthereumRpcBudget(() => Date.now()); budget.pause();
    const pending = expect(budget.acquire()).rejects.toBeInstanceOf(EthereumRpcBudgetBusy);
    for (let second = 0; second < 10; second++) { budget.pause(); await vi.advanceTimersByTimeAsync(1_000); }
    await pending;
  });

  it("only recognizes structured rate-limit errors for the single bounded retry", () => {
    expect(ethereumRpcRateLimited({ cause: { status: 429 } })).toBe(true);
    expect(ethereumRpcRateLimited({ cause: { cause: { code: -32007 } } })).toBe(true);
    expect(ethereumRpcRateLimited({ status: 500, message: "rate limit https://private.example/secret" })).toBe(false);
    expect(ethereumRpcRateLimited({ code: -32000 })).toBe(false);
    expect(ethereumRpcRateLimited({ code: 3 })).toBe(false);
  });
});
