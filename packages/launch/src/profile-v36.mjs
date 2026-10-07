import { canonicalizeJson } from "./canonical-json.mjs";
import { sha256Digest } from "./io.mjs";

// Collection policy only. Mode selection requires server runtime and trade proof.
export const DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36 = deepFreeze({
  "schemaVersion": "programmable.ethereum-programmable-trade-fee-policy.v1",
  "policyVersion": "programmable.ethereum-routed-native-fee.v1",
  "scope": "programmable-routed-ethereum-trades",
  "ratePpm": "3000",
  "rateDenominator": "1000000",
  "rateBps": 30,
  "modeSelection": "server-exact-runtime-and-trade-proof",
  "defaultCollection": {
    "mode": "programmable_routed",
    "routedRateBps": 30,
    "basis": "gross-native-by-side",
    "buyBasis": "funded-native-input",
    "sellBasis": "gross-native-output-credit",
    "currency": "native-ETH",
    "rounding": "floor-once-per-swap",
    "recipient": "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    "collection": "atomic-native-transfer-in-swap"
  },
  "native30Waiver": {
    "mode": "pool_enforced_native30",
    "routedRateBps": 0,
    "basis": "authenticated-gross-native",
    "currency": "native-ETH",
    "rounding": "ceil-per-trade",
    "recipient": "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    "hook": "EthereumNative30HookV2",
    "vault": "EthereumNativeFeeVaultV2",
    "proof": "exact-runtime-and-trade-accrual",
    "applicantAssertionsAccepted": false
  },
  "launchAdmissionEstablishesFeeCollection": false,
  "externalTradeFeeGuaranteed": false,
  "historicalSignedFeeObligations": "preserved"
});

export function assertDirectNativeProgrammableTradeFeePolicyV36(value) {
  if (canonicalizeJson(value) !== canonicalizeJson(DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36)) {
    throw new TypeError("PROFILE_36_PROGRAMMABLE_TRADE_FEE_POLICY_MISMATCH");
  }
  return DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36;
}

export function directNativeProgrammableTradeFeePolicyHashV36() {
  return sha256Digest(Buffer.concat([
    Buffer.from(DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36), "utf8"),
  ]));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
