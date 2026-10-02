import { describe, expect, it } from "vitest";
import { normalizeFoundationSocialInput, normalizeFoundationSocialInputs } from "@/lib/module-foundation/social-input";
import { validateModuleSocialLinks } from "@/lib/module-mode/token-metadata";

describe("Foundation social input", () => {
  it.each([
    ["programmable.market", "https://programmable.market"],
    [" programmable.market/about ", "https://programmable.market/about"],
    ["https://programmable.market/about", "https://programmable.market/about"],
    ["http://programmable.market", "https://programmable.market"],
  ])("accepts website input %s", (input, expected) => {
    expect(normalizeFoundationSocialInput("website", input)).toBe(expected);
    const result = validateModuleSocialLinks(normalizeFoundationSocialInputs({ website: input }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.links.website).toBe(new URL(expected).href);
  });

  it.each([
    ["programmable", "https://x.com/programmable"],
    ["@programmable", "https://x.com/programmable"],
    [" @programmable ", "https://x.com/programmable"],
    ["x.com/programmable", "https://x.com/programmable"],
    ["https://x.com/programmable", "https://x.com/programmable"],
    ["https://twitter.com/programmable", "https://twitter.com/programmable"],
  ])("accepts Twitter input %s", (input, expected) => {
    expect(normalizeFoundationSocialInput("twitter", input)).toBe(expected);
    expect(validateModuleSocialLinks(normalizeFoundationSocialInputs({ twitter: input })).ok).toBe(true);
  });

  it.each(["example_user", "@example_user", " @ example_user ", "t.me/example_user", "telegram.me/example_user", "http://t.me/example_user", "https://t.me/example_user"])("accepts Telegram input %s", input => {
    const links = normalizeFoundationSocialInputs({ telegram: input });
    expect(links.telegram).toBe("https://t.me/example_user");
    expect(validateModuleSocialLinks(links).ok).toBe(true);
  });
  it("normalizes added project links and spaced X handles", () => {
    expect(normalizeFoundationSocialInputs({ twitter: "@ example", other: ["docs.example.com", "http://example.com/community"] })).toEqual({ twitter: "https://x.com/example", other: ["https://docs.example.com", "https://example.com/community"] });
  });

  it.each([
    { website: "javascript:alert(1)" },
    { website: "http://user:password@programmable.market" },
    { website: "http://127.0.0.1" },
    { twitter: "https://example.com/programmable" },
    { twitter: "@invalid username" },
  ])("keeps unsafe or invalid input rejected: %j", input => {
    expect(validateModuleSocialLinks(normalizeFoundationSocialInputs(input)).ok).toBe(false);
  });
});
