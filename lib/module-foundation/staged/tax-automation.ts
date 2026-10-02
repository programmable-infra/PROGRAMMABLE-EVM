import { FOUNDATION_HOST_ADAPTER_V1, type FoundationHostAdapterV1 } from "../composition";

/** Source preparation only. This adapter is deliberately not registered in the website. */
export const TAX_AUTOMATION_CAPABILITY_V1 = "programmable.module-foundation.auto-budget@1" as const;
export const STAGED_TAX_AUTOMATION_HOST_V1: FoundationHostAdapterV1 = Object.freeze({
  ...FOUNDATION_HOST_ADAPTER_V1,
  capabilities: Object.freeze([...FOUNDATION_HOST_ADAPTER_V1.capabilities, TAX_AUTOMATION_CAPABILITY_V1]),
  maxAfterGas: 800_000,
  maxTotalSwapGas: 2_500_000,
});

// Admission must bind FoundationAutomationHookV1.AUTOMATION_ID() and its exact release code hashes.
// A package declaring this capability cannot enable it on an older deployed host.
