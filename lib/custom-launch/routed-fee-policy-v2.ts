export const ROUTED_FEE_POLICY_V2 = "programmable.routed-swap-fee.v2" as const;
export const ROUTED_FEE_BPS_V2 = 30 as const;

export const CUSTOM_LAUNCH_ROUTED_FEE_DISCOVERY_V2 = Object.freeze({
  policyVersion: ROUTED_FEE_POLICY_V2,
  rateBps: ROUTED_FEE_BPS_V2,
  ratePercent: "0.30%",
  appliesTo: "programmable-routed-open-provenance-trades",
  basis: "gross-output-credit",
  currency: "swap-output-asset",
  rounding: "floor-once-per-swap",
  recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
  collection: "atomic-output-transfer-in-swap",
  historicalSignedFeeObligations: "preserved",
  verifiedExistingPoolFee: "no-additional-route-fee",
  externalTradeFeeGuaranteed: false,
});
