import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import type { LaunchStampProvenanceV1 } from "@/lib/tokens";

export const ETHEREUM_ROUTING_FEE_POLICY_V1 = {
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
} as const;
export const ETHEREUM_ROUTING_FEE_POLICY_HASH_V1 = canonicalBrowserSha256V2(ETHEREUM_ROUTING_FEE_POLICY_V1.schemaVersion, ETHEREUM_ROUTING_FEE_POLICY_V1);
export const ETHEREUM_ROUTING_FEE_BOUNDARY_V1 = { chainId: "1", blockNumber: "26142122", blockHash: "0x823e99cec0bb5b6011afc44891a1fd897b7efcbd83658cb9bc176dc35f5f86a3" } as const;

export type EthereumRoutingFeePolicyBindingV1 = Readonly<{
  schemaVersion: "programmable.ethereum-launch-routing-fee-policy-binding.v1";
  launchProfileVersion: "3.6.0";
  launchProfileHash: `sha256:${string}`;
  policyHash: `sha256:${string}`;
  policy: typeof ETHEREUM_ROUTING_FEE_POLICY_V1;
  enforcementBoundary: typeof ETHEREUM_ROUTING_FEE_BOUNDARY_V1;
  stampBinding: Readonly<{ launchId: `0x${string}`; stampHash: `0x${string}`;
    permitDigest: `0x${string}`; routePayloadHash: `0x${string}` }>;
  bindingHash: `sha256:${string}`;
}>;
export type EthereumFeeClassificationV1 = Readonly<{
  launchId: string;
  stampHash: string;
  profileVersion: string;
  routingFeePolicy: EthereumRoutingFeePolicyBindingV1 | null;
}>;
const historicalProfiles = new Set(["2.0.0", "3.0.0", "3.1.0", "3.2.0", "3.3.0", "3.4.0", "3.5.0"]);
const hash = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const hex = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const invalid = (): never => { throw new TypeError("The Ethereum launch fee policy could not be verified."); };

export function parseEthereumRoutingFeePolicyV1(value: unknown): EthereumRoutingFeePolicyBindingV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const binding = value as EthereumRoutingFeePolicyBindingV1;
  if (Object.keys(binding).sort().join() !== ["schemaVersion", "launchProfileVersion", "launchProfileHash", "policyHash", "policy", "enforcementBoundary", "stampBinding", "bindingHash"].sort().join()
    || binding.schemaVersion !== "programmable.ethereum-launch-routing-fee-policy-binding.v1"
    || binding.launchProfileVersion !== "3.6.0" || !hash(binding.launchProfileHash)
    || binding.policyHash !== ETHEREUM_ROUTING_FEE_POLICY_HASH_V1
    || canonicalBrowserJsonV2(binding.policy) !== canonicalBrowserJsonV2(ETHEREUM_ROUTING_FEE_POLICY_V1)
    || canonicalBrowserJsonV2(binding.enforcementBoundary) !== canonicalBrowserJsonV2(ETHEREUM_ROUTING_FEE_BOUNDARY_V1)
    || !binding.stampBinding || Object.keys(binding.stampBinding).sort().join() !== "launchId,permitDigest,routePayloadHash,stampHash"
    || !Object.values(binding.stampBinding).every(hex)) return invalid();
  const { bindingHash, ...body } = binding;
  if (!hash(bindingHash) || bindingHash !== canonicalBrowserSha256V2(binding.schemaVersion, body)) return invalid();
  return binding;
}

/** Only the server's canonical finalized feed supplies this classification.
 * Client validation binds it to the independently verified launch stamp. */
export function validateEthereumFeeClassificationV1(value: EthereumFeeClassificationV1, stamp: LaunchStampProvenanceV1) {
  if (!value || !same(value.launchId, stamp.launchId) || !same(value.stampHash, stamp.stampHash)) return invalid();
  if (historicalProfiles.has(value.profileVersion)) {
    if (value.routingFeePolicy !== null) return invalid();
    return value;
  }
  if (value.profileVersion !== "3.6.0") return invalid();
  const binding = parseEthereumRoutingFeePolicyV1(value.routingFeePolicy);
  for (const key of ["launchId", "stampHash", "permitDigest", "routePayloadHash"] as const) {
    if (!same(binding.stampBinding[key], stamp[key])) return invalid();
  }
  if (BigInt(stamp.blockNumber) <= BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber)) return invalid();
  return value;
}
