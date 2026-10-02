import type { ModuleSocialKind, ModuleSocialLinks } from "@/lib/module-mode/token-metadata";

/** Normalize convenient input before validating public metadata URLs. */
export function normalizeFoundationSocialInput(kind: ModuleSocialKind, value: string): string {
  const input = value.trim();
  if (!input) return input;
  const username = input.replace(/^@\s*/, "");
  if (kind === "twitter" && /^[A-Za-z0-9_]{1,15}$/.test(username)) return `https://x.com/${username}`;
  if (kind === "telegram" && /^[A-Za-z0-9_]{1,32}$/.test(username)) return `https://t.me/${username}`;
  let url = input;
  if (/^https?:\/\//i.test(input)) url = input.replace(/^http:/i, "https:");
  else if (input.startsWith("//")) url = `https:${input}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) url = `https://${input}`;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (kind === "twitter" && ["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
      if (host === "mobile.twitter.com") parsed.hostname = "x.com";
      parsed.pathname = parsed.pathname.replace(/^\/@/, "/");
      return parsed.href;
    }
    if (kind === "telegram" && ["t.me", "telegram.me"].includes(host)) {
      parsed.hostname = "t.me";
      parsed.pathname = parsed.pathname.replace(/^\/@/, "/");
      return parsed.href;
    }
  } catch { /* Leave malformed input for the field validator. */ }
  return url;
}

export function normalizeFoundationSocialInputs(links: ModuleSocialLinks): ModuleSocialLinks {
  return Object.fromEntries(Object.entries(links).map(([kind, value]) => [kind,
    kind === "other" && Array.isArray(value) ? value.map(item => normalizeFoundationSocialInput("website", item))
      : typeof value === "string" ? normalizeFoundationSocialInput(kind as ModuleSocialKind, value) : value]));
}
