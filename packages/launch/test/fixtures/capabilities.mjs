import {
  API_ORIGIN,
  CAPABILITIES_PATH_V3,
  CREATE_PATH_V3,
  DIRECT_NATIVE_PROFILE_ID,
  DIRECT_NATIVE_PROFILE_REVISION,
  DIRECT_NATIVE_PROFILE_VERSION,
  PERMIT_REISSUE_CAPABILITY_SCHEMA_V1,
  PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
  PERMIT_REISSUE_PATH_TEMPLATE_V3,
  PERMIT_REISSUE_REQUEST_SCHEMA_V1,
  PREFLIGHT_PATH_V3,
  WALLET_HANDOFF_BASE_URL,
} from "../../src/constants.mjs";
import { DIRECT_NATIVE_PROGRAMMABLE_TRADE_FEE_POLICY_V36 as POLICY } from "../../src/profile-v36.mjs";

export function validCapabilities(overrides = {}) {
  return {
    schemaVersion: "programmable.custom-launch-capabilities.v1",
    apiVersion: "v3",
    serverTime: "2026-08-26T18:00:00.000Z",
    readinessUrl: `${API_ORIGIN}/readyz`,
    chain: { id: "1", name: "Ethereum Mainnet" },
    profile: {
      profileId: DIRECT_NATIVE_PROFILE_ID,
      profileRevision: DIRECT_NATIVE_PROFILE_REVISION,
      profileVersion: DIRECT_NATIVE_PROFILE_VERSION,
      productionLaunchAuthorized: true,
    },
    routes: {
      create: CREATE_PATH_V3,
      preflight: PREFLIGHT_PATH_V3,
      status: `${CREATE_PATH_V3}/{launchId}`,
      list: CREATE_PATH_V3,
      finalizedMetadata: "/v3/finalized-custom-launches",
      capabilities: CAPABILITIES_PATH_V3,
      permitReissue: PERMIT_REISSUE_PATH_TEMPLATE_V3,
    },
    authentication: {
      create: "bearer-api-key",
      preflight: "bearer-api-key",
      status: "bearer-api-key",
      finalizedMetadata: "none",
      capabilities: "none",
      permitReissue: "bearer-api-key",
      requiredScopes: ["custom-launch:create", "custom-launch:read"],
      apiKeyIsWallet: false,
    },
    preflight: {
      quotaConsumed: false,
      nonceAllocated: false,
      persisted: false,
      walletSignatureProduced: false,
      transactionBroadcast: false,
      exactProductionAdmissionEngine: true,
    },
    projectMetadata: validProjectMetadataCapabilities(),
    permitReissue: validPermitReissueCapability(),
    walletHandoffBaseUrl: WALLET_HANDOFF_BASE_URL,
    ...overrides,
  };
}

export function validCapabilities36() {
  const value = validCapabilities();
  value.profile.profileVersion = "3.6.0";
  value.projectMetadata.requiredForProfileVersion = "3.6.0";
  value.projectMetadata.strictNewPackPolicyProfileVersion = "3.6.0";
  value.projectMetadata.requiredForProfileVersions = ["3.2.0", "3.3.0", "3.4.0", "3.5.0", "3.6.0"];
  value.projectMetadata.strictMetadataProfileVersions = ["3.3.0", "3.4.0", "3.5.0", "3.6.0"];
  value.programmableTradeFeePolicy = {
    policy: structuredClone(POLICY),
    policyHash: "sha256:5956cdeee628ba84dfa5214efd532011e59c202e4e1c1830b1eca279d58d79d3",
    collectionStatus: "required-per-trade-evidence",
    launchAdmissionEstablishesFeeCollection: false,
  };
  value.profile36Release = {
    profileVersion: "3.6.0", selected: true, productionLaunchAuthorized: true,
    staticAdmissionBaseline: "3.3.0", customHookAllowlistRequired: false, mandatoryCanonicalFeeVaultTarget: false,
    exactSettlementDataflowClosureRequired: false, selectionIsFeeExecutionProof: false, websiteBoundarySupportMustPrecedeSelection: true,
  };
  value.feePolicy = {
    programmableHundredthsOfBip: "3000", denominator: "1000000", requiredForProfileVersion: "3.6.0", releaseModule: null,
  };
  value.graph = { minimumTargets: 3, maximumTargets: 16 };
  value.requestProfiles = {
    current: "3.6.0", freshSubmissionExactVersions: ["3.6.0"], newProfileVersionsAreImplicitlyAccepted: false,
  };
  return value;
}

export function validProjectMetadataCapabilities() {
  return {
    schemaVersion: "programmable.project-metadata.v1",
    inputSchemaVersion: "programmable.project-metadata-input.v1",
    requiredForProfileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    requiredForProfileVersions: ["3.2.0", "3.3.0", "3.4.0"],
    strictMetadataProfileVersions: ["3.3.0", "3.4.0"],
    strictNewPackPolicyProfileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    enforcement: {
      routes: ["POST /v3/custom-launches/preflight", "POST /v3/custom-launches"],
      serverSide: true,
      clientBypassAccepted: false,
      failureCode: "PROJECT_METADATA_POLICY_INVALID",
      legacyProfilesNotRetrofitted: true,
    },
    profilePolicy: {
      schemaVersion: "programmable.project-metadata-policy.v1",
      descriptionMinimumUtf8Bytes: 20,
      descriptionMaximumUtf8Bytes: 4096,
      descriptionMinimumUnicodeLettersOrNumbers: 8,
      imageRequired: true,
      imageReceiptSourceManifestBindingRequired: true,
      imageMediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      linksMaximumCount: 32,
      requiredLinkKinds: ["website", "x"],
      exactlyOneRequiredLinkPerKind: true,
      websiteUriPolicy: "canonical-public-credential-free-https",
      xUriPattern: "^https://x\\.com/[A-Za-z0-9_]{1,64}$",
    },
    legacyWithoutMetadataProfileVersions: ["2.0.0", "3.0.0", "3.1.0"],
    legacyMetadataProfileVersions: ["3.2.0"],
    requiredFields: [
      "token.name",
      "token.symbol",
      "presentation.description",
      "presentation.image",
      "presentation.links",
    ],
    imageMayBeNull: false,
    legacyImageMayBeNullProfileVersions: ["3.2.0"],
    description: {
      minimumUtf8Bytes: 20,
      maximumUtf8Bytes: 4096,
      minimumUnicodeLettersOrNumbers: 8,
      nfcAndTrimmedRequired: true,
    },
    image: {
      required: true,
      exactContentSha256Required: true,
      exactByteLengthRequired: true,
      sourceManifestFileBindingRequired: true,
      mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    },
    exactlyOneRequiredLinkPerKind: true,
    requiredLinkKinds: ["website", "x"],
    websiteUriPolicy: "canonical-public-credential-free-https",
    xUriPattern: "^https://x\\.com/[A-Za-z0-9_]{1,64}$",
    maximumLinks: 32,
    linkKinds: ["website", "documentation", "x", "telegram", "discord", "github", "other"],
    projectMetadataHashDomain: "programmable.project-metadata.v1",
    graphBundleHashBindingDomain: "programmable.custom-graph-project-metadata.v1",
    postDeploymentTokenReadbackRequired: true,
  };
}

export function validPermitReissueCapability() {
  return {
    schemaVersion: PERMIT_REISSUE_CAPABILITY_SCHEMA_V1,
    endpoint: PERMIT_REISSUE_PATH_TEMPLATE_V3,
    requestSchemaVersion: PERMIT_REISSUE_REQUEST_SCHEMA_V1,
    dispositionSchemaVersion: PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
    disposition: "unsupported",
    httpStatus: 409,
    reasonCode: "ROUTER_V1_PERMIT_NONCE_IS_CREATE2_ROUTE_NONCE",
    authenticationScope: "custom-launch:create",
    idempotencyKeyRequired: true,
    resourceBindingRequired: [
      "launchId",
      "expectedRequestHash",
      "expectedLaunchIntentHash",
    ],
    noReplacementNonceReserved: true,
    noReplacementPermitIssued: true,
    oldPermitStateRequired: "expired-and-unconsumed",
    oldPermitInvalidation: "original-signature-expired-by-signed-deadline",
    currentReleaseRecovery: "repack-and-submit-new-launch-request",
    futureContractRequirements: [
      "separate authorization nonce from CREATE2 route nonce",
      "preserve full fee and security gates",
    ],
  };
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
