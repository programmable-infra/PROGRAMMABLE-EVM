import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleFoundationBuilder } from "@/components/module-foundation-builder";
import type { FoundationAvailability, FoundationModuleDescriptor } from "@/lib/module-foundation/ui-types";

const actions = { onUploadImage: vi.fn(), onPrepareLaunch: vi.fn(), onConfirmLaunch: vi.fn() };
const quote = { address: "0x1111111111111111111111111111111111111111" as const, chainId: 4663, symbol: "ETH", name: "Ether", decimals: 18, supported: true, supportsNativeEth: true };
const render = (availability: FoundationAvailability, catalog: FoundationModuleDescriptor[] = []) => renderToStaticMarkup(<ModuleFoundationBuilder
  layout="studio" contextKey="studio-test" availability={availability} catalog={catalog} quoteAssets={[quote]} onResolveQuote={vi.fn()} {...actions} />);

describe("Module Studio interface", () => {
  it("distinguishes loading, failed loading and an empty verified catalog", () => {
    const availability = { chainId: 4663, chainName: "Robinhood Chain" };
    expect(render({ ...availability, status: "checking" })).toContain("Loading modules…");
    const unavailable = render({ ...availability, status: "unavailable", reason: "The module service is unavailable." });
    expect(unavailable).toContain("Modules could not load.");
    expect(unavailable).not.toContain("Loading modules…");
    expect(render({ ...availability, status: "ready" })).toContain("No modules available");
  });

  it("keeps base launch fields open and avoids redundant Coin details controls", () => {
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
    expect(actions.onPrepareLaunch).not.toHaveBeenCalled();
    expect(actions.onConfirmLaunch).not.toHaveBeenCalled();
  });
});
