import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleVisibleQuoteRefresh } from "@/components/quote-refresh";

describe("visible trade quote refresh", () => {
  let page: EventTarget & { visibilityState: string };
  function visibility(value: string) {
    page.visibilityState = value;
    page.dispatchEvent(new Event("visibilitychange"));
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", page);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("pauses a hidden tab and refreshes an expired quote only once on return", () => {
    const refresh = vi.fn();
    const cleanup = scheduleVisibleQuoteRefresh(Date.now() + 30_000, refresh);
    vi.advanceTimersByTime(10_000);
    visibility("hidden");
    vi.advanceTimersByTime(600_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    visibility("visible");
    visibility("visible");
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("keeps the original expiry when a tab returns before the quote expires", () => {
    const refresh = vi.fn();
    const cleanup = scheduleVisibleQuoteRefresh(Date.now() + 30_000, refresh);
    visibility("hidden");
    vi.advanceTimersByTime(10_000);
    visibility("visible");
    vi.advanceTimersByTime(19_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("does not revive an old token or wallet quote after cleanup", () => {
    const oldQuote = vi.fn(), currentQuote = vi.fn();
    visibility("hidden");
    const cleanup = scheduleVisibleQuoteRefresh(Date.now() - 1, oldQuote);
    cleanup();
    const currentCleanup = scheduleVisibleQuoteRefresh(Date.now() + 5_000, currentQuote);
    visibility("visible");
    vi.advanceTimersByTime(5_000);
    expect(oldQuote).not.toHaveBeenCalled();
    expect(currentQuote).toHaveBeenCalledTimes(1);
    currentCleanup();
  });
});
