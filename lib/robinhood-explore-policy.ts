// Explore pins the canonical Programmable token on Robinhood Chain.
export const PINNED_ROBINHOOD_CHAIN_ID = 4663;
export const PINNED_ROBINHOOD_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";

// Requested Explore exclusions do not remove canonical launch records or coin pages.
const EXPLORE_EXCLUDED_TOKENS = new Set([
  "0x15fca474b23cafe775120b1fafbcff0e7a827af2", // release canary
  "0xe8b292783382c93706dc43b54bba03f0f1a9908e", // catch trade
  "0x9fa5619b14d3fb6900247db219a3feb657ca46fc", // Tradable
  "0x859e6b4497f977b8ad88fbde2c6ca70c68cec5f9", // TEST launch
  "0x7488b3efd34398bcfe6b48c6a648d7ef6e4127ad", // PSniper Alpha
  "0x5e864e6eabec0f986c9f9f5d5a62e2f2e02a84e3", // PSniper Beta
  "0x1198a419a28cdac1c86d1f14974169c0527b4fa5", // PSniper Epsilon
  "0xb73b85e680f3024de80e8d06cf0e727542991a97", // PSniper Gamma
  "0x4151524125faa09596477776b31351f77459bc90", // PSniper Seven
  "0x59da50c558cb548e8998b77984533f2e9b50f293", // PSniper Final
  "0xede5a16f2835a401aa41a65137efe2ca837b25f2", // PSniper Eleven
  "0x688ec8730893d3254021d356f4dd6c4cf30d5f01", // PSniper Ten
  "0xbc0d6909b8ea31623662e694f276d146a70afa88", // PSniper Twelve
  "0x3daf6a7bd6c95d0eac7e56ab761dc60a7c836f3c", // PSniper Fourteen
]);

export function isDiscoverableRobinhoodToken(address: string) {
  return !EXPLORE_EXCLUDED_TOKENS.has(address.toLowerCase());
}

// Compatibility for indexed launch readback. Publication visibility is checked
// against the canonical record by the caller; no token address is excluded.
export function isVisibleRobinhoodToken(address: string) {
  return /^0x[\da-f]{40}$/i.test(address);
}

export function isPinnedRobinhoodToken(address: string, chainId: number) {
  return chainId === PINNED_ROBINHOOD_CHAIN_ID && address.toLowerCase() === PINNED_ROBINHOOD_TOKEN;
}
