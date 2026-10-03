import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleFoundationBuilder } from "@/components/module-foundation-builder";
import type { FoundationAvailability, FoundationModuleDescriptor } from "@/lib/module-foundation/ui-types";

const actions = { onUploadImage: vi.fn(), onPrepareLaunch: vi.fn(), onConfirmLaunch: vi.fn() };
const quote = { address: "0x1111111111111111111111111111111111111111" as const, chainId: 4663, symbol: "ETH", name: "Ether", decimals: 18, supported: true, supportsNativeEth: true };
const descriptor: FoundationModuleDescriptor = { id: "wallet-cap-fixture", version: "1.0.0", digest: `0x${"11".repeat(32)}`, name: "Initial wallet buy limit", description: "Limits purchases during the selected time.", capabilities: ["beforeSwap"], fields: [], available: true };
const render = (availability: FoundationAvailability, catalog: FoundationModuleDescriptor[] = []) => renderToStaticMarkup(<ModuleFoundationBuilder
  layout="studio" contextKey="studio-test" availability={availability} catalog={catalog} quoteAssets={[quote]} onResolveQuote={vi.fn()} {...actions} />);

describe("Module Studio interface", () => {
  it("distinguishes loading, failed loading and an empty verified catalog", () => {
    const availability = { chainId: 4663, chainName: "Robinhood Chain" };
    expect(render({ ...availability, status: "checking" })).toContain("Loading modules…");
    const checking = render({ ...availability, status: "checking" }, [descriptor]);
    expect(checking).toContain('aria-label="Any Quote Pool"');
    expect(checking).toContain('aria-label="Initial wallet buy limit"');
    // A recent catalog may be shown while fresh authority is loading, but it cannot launch.
    expect(checking).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(render({ ...availability, status: "checking" })).toContain('aria-label="Any Quote Pool"');
    const ready = render({ ...availability, status: "ready" }, [descriptor]);
    expect(ready).toContain('aria-label="Any Quote Pool"');
    expect(ready).toContain('aria-label="Initial wallet buy limit"');
    const unavailable = render({ ...availability, status: "unavailable", reason: "The module service is unavailable." });
    expect(unavailable).toContain("Modules could not load.");
    expect(unavailable).not.toContain("Loading modules…");
    expect(render({ ...availability, status: "ready" })).toContain("No modules available");
  });

  it("keeps base launch fields open, makes links optional to expand and avoids redundant Coin details controls", () => {
    const html = render({ status: "ready", chainId: 4663, chainName: "Robinhood Chain" });
    for (const id of ["foundation-name", "foundation-symbol", "foundation-initial-buy", "foundation-creator-fee-inline", "foundation-description", "foundation-social-twitter", "foundation-social-telegram"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/<h2>Coin details<\/h2>/);
    expect(html).not.toMatch(/<button[^>]*>Coin details<\/button>/);
    expect(html).not.toContain('aria-label="Selected settings"');
    expect(html).toContain('aria-label="Edit coin details"');
    expect(html).toContain('draggable="false"');
    expect(html).not.toContain('id="foundation-social-github"');
    expect(html).not.toContain('id="foundation-social-discord"');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Links/);
    expect(actions.onPrepareLaunch).not.toHaveBeenCalled();
    expect(actions.onConfirmLaunch).not.toHaveBeenCalled();
  });

  it("adds the quote module to the map only when the creator selects a custom pairing", () => {
    const availability = { status: "ready" as const, chainId: 4663, chainName: "Robinhood Chain" };
    const native = render(availability);
    expect(native).not.toContain('data-node-id="quote"');
    expect(native).not.toContain('aria-label="Edit Any Quote Pool"');
    expect(native).toContain("$COIN / ETH");
    const custom = renderToStaticMarkup(<ModuleFoundationBuilder layout="studio" contextKey="studio-test" availability={availability}
      catalog={[]} quoteAssets={[quote]} onResolveQuote={vi.fn()} {...actions}
      initialDraft={{ quoteAsset: "0x2222222222222222222222222222222222222222" }} />);
    expect(custom).toContain('data-node-id="quote"');
    expect(custom).toContain('aria-label="Edit Any Quote Pool"');
    expect(custom).toContain("$COIN / TOKEN");
  });
});
