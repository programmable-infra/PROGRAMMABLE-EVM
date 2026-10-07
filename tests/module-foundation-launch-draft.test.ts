import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationLaunchDraftSnapshot } from "@/lib/module-foundation/launch-draft";

const snapshot = (): FoundationLaunchDraftSnapshot => ({
  draft: { name: "My coin", symbol: "COIN", description: "Keep my draft", image: null,
    socialLinks: { website: "https://example.com" }, creatorFeeBps: 300, initialBuy: "0", additionalLiquidity: "0",
    quoteAsset: "0x1111111111111111111111111111111111111111", quoteValuation: "42",
    modules: [{ id: "module", version: "1", digest: `0x${"11".repeat(32)}`, configuration: { amount: "12.5" } }] },
  buyEdited: true, customQuote: true, localImage: null,
});
beforeEach(() => { vi.resetModules(); vi.stubGlobal("window", {}); });
afterEach(() => vi.unstubAllGlobals());

describe("tab-local launch drafts", () => {
  it("keeps independent chain drafts and seeds only portable coin settings", async () => {
    const store = await import("@/lib/module-foundation/launch-draft");
    const rh = snapshot(); store.rememberFoundationLaunchDraft(4663, rh);
    const eth = store.readFoundationLaunchDraft(1)!;
    expect(eth.draft).toMatchObject({ name: "My coin", symbol: "COIN", creatorFeeBps: 300, initialBuy: "0", modules: [], quoteAsset: "" });
    expect(eth.draft).not.toHaveProperty("quoteValuation"); expect(eth.customQuote).toBe(false);
    eth.draft.name = "Ethereum coin"; store.rememberFoundationLaunchDraft(1, eth);
    expect(store.readFoundationLaunchDraft(4663)).toEqual(rh);
    expect(store.readFoundationLaunchDraft(1)?.draft.name).toBe("Ethereum coin");
    rh.draft.modules[0].configuration.amount = "999";
    expect(store.readFoundationLaunchDraft(4663)?.draft.modules[0].configuration.amount).toBe("12.5");
  });
  it("retains image bytes for reupload but never carries the old upload approval", async () => {
    const store = await import("@/lib/module-foundation/launch-draft");
    const value = snapshot(), sha256 = `0x${"22".repeat(32)}` as const;
    value.draft.image = { url: "https://example.com/old.webp", sha256 };
    value.localImage = { blob: new Blob(["image"], { type: "image/webp" }), sha256 };
    store.rememberFoundationLaunchDraft(4663, value);
    const restored = store.readFoundationLaunchDraft(4663)!;
    expect(restored.draft.image).toBeNull(); expect(restored.localImage?.blob).toBe(value.localImage.blob);
    expect(Object.keys(restored).sort()).toEqual(["buyEdited", "customQuote", "draft", "localImage"]);
  });
  it("clears submitted drafts without resurrecting them from another chain", async () => {
    const store = await import("@/lib/module-foundation/launch-draft");
    store.rememberFoundationLaunchDraft(4663, snapshot());
    store.rememberFoundationLaunchDraft(1, snapshot());
    store.clearFoundationLaunchDraft(4663);
    expect(store.readFoundationLaunchDraft(4663)).toBeNull();
    expect(store.readFoundationLaunchDraft(1)).not.toBeNull();
    store.clearFoundationLaunchDraft(1); expect(store.readFoundationLaunchDraft(1)).toBeNull();
  });
  it("does not read or retain a visitor's draft on the server", async () => {
    const store = await import("@/lib/module-foundation/launch-draft");
    vi.stubGlobal("window", undefined); store.rememberFoundationLaunchDraft(4663, snapshot());
    expect(store.readFoundationLaunchDraft(4663)).toBeNull();
    vi.stubGlobal("window", {}); expect(store.readFoundationLaunchDraft(4663)).toBeNull();
  });
});
