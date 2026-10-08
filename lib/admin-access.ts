/** Website administration. Authentication and backend permissions remain required. */
export const WEBSITE_ADMIN_WALLET = "0x79879fe6f00c0986Ca521eA6F5b276b5E28b1b9C" as const;
export const WEBSITE_ADMIN_WALLETS = Object.freeze([
  WEBSITE_ADMIN_WALLET,
  "0xe1939B7a5a6840f061299de8246071891c4D81e9",
  "0x39544A7023081B56D7405c1af0bFaf72da7e24F6",
] as const);

export function isWebsiteAdminWallet(wallet: string | null | undefined): boolean {
  return typeof wallet === "string"
    && WEBSITE_ADMIN_WALLETS.some((admin) => wallet.toLowerCase() === admin.toLowerCase());
}
