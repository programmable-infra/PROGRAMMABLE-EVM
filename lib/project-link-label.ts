/** Recognize untyped publication links with the same names used by coin socials. */
export function projectLinkLabel(href: string): string {
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (["x.com", "twitter.com"].includes(host)) return "X";
    if (["t.me", "telegram.me", "telegram.org"].includes(host)) return "Telegram";
    if (["discord.com", "discord.gg"].includes(host)) return "Discord";
    if (host === "github.com") return "GitHub";
    if (host === "gitbook.io" || host.endsWith(".gitbook.io")) return "GitBook";
    return "Website";
  } catch { return "Project link"; }
}
