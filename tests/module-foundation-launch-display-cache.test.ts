import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { unavailableFoundation } from "@/lib/module-foundation/availability";
import { foundationV2Fixture } from "./module-foundation-v2-fixture";

const readQuote = vi.hoisted(() => vi.fn());
vi.mock("@/lib/module-foundation/client", () => ({ readFoundationQuote: readQuote }));
const client = { chain: { id: 4663 } } as PublicClient;
const address = "0x1111111111111111111111111111111111111111";
const quote = { address, name: "Quote", symbol: "Q", decimals: 18, balance: null, codeHash: `0x${"1".repeat(64)}` };

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); readQuote.mockReset().mockResolvedValue(quote); });
afterEach(() => vi.useRealTimers());

describe("Foundation presentation reads", () => {
  it("retains a bounded launch catalog, clears withdrawn authority and ignores retained-token releases", async () => {
    const display = await import("@/lib/module-foundation/launch-display-cache");
    const ready = { ...unavailableFoundation(), available: true, binding: foundationV2Fixture(false, true).binding };
    const changed = vi.fn(), unsubscribe = display.subscribeFoundationLaunchDisplay(changed);
    display.rememberFoundationLaunchDisplay(ready);
    expect(display.readFoundationLaunchDisplay()).toBe(ready);
    display.rememberFoundationLaunchDisplay({ ...ready, token: address });
    expect(changed).toHaveBeenCalledOnce();
    expect(display.readFoundationLaunchDisplay()).toBe(ready);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(display.readFoundationLaunchDisplay()).toBeNull();
    display.rememberFoundationLaunchDisplay(ready);
    display.rememberFoundationLaunchDisplay(unavailableFoundation());
    expect(display.readFoundationLaunchDisplay()).toBeNull();
    unsubscribe();
  });

  it("shares concurrent metadata across wallet views without reading or caching an account balance", async () => {
    const { readFoundationQuoteForDisplay } = await import("@/lib/module-foundation/launch-display-cache");
    const first = readFoundationQuoteForDisplay(client, address);
    const second = readFoundationQuoteForDisplay({ chain: { id: 4663 } } as PublicClient, address);
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ balance: null });
    expect(readQuote).toHaveBeenCalledExactlyOnceWith(client, address);
    await vi.advanceTimersByTimeAsync(29_999);
    await readFoundationQuoteForDisplay(client, address);
    expect(readQuote).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await readFoundationQuoteForDisplay(client, address);
    expect(readQuote).toHaveBeenCalledTimes(2);
  });

  it("never reuses metadata on another chain and allows a failed lookup to recover", async () => {
    const { readFoundationQuoteForDisplay } = await import("@/lib/module-foundation/launch-display-cache");
    readQuote.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(readFoundationQuoteForDisplay(client, address)).rejects.toThrow("Provider unavailable");
    await expect(readFoundationQuoteForDisplay(client, address)).resolves.toMatchObject({ symbol: "Q" });
    await expect(readFoundationQuoteForDisplay({ chain: { id: 1 } } as PublicClient, address)).resolves.toMatchObject({ symbol: "Q" });
    expect(readQuote).toHaveBeenCalledTimes(3);
    await expect(readFoundationQuoteForDisplay({ chain: { id: 10 } } as PublicClient, address)).rejects.toThrow("supported launch network");
    expect(readQuote).toHaveBeenCalledTimes(3);
  });
});
