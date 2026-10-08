import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from
  "../lib/custom-launch/registry-public-manifest-v1";
import { programmableWellKnownDocumentV1 } from
  "../lib/server/custom-launch/well-known-v1";

const root = process.cwd();

describe("public Custom Launch CLI surface", () => {
  it("advertises public V3 general-hook creation and retained earlier reads", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    expect(document.routerCustomIdentitySnapshotUrl).toBe(
      "https://programmable.market/api/indexers/v1/router-custom-identities",
    );
    expect(document.customLaunchApi).toMatchObject({
      status: "live",
      readStatus: "live",
      apiVersion: "3",
      readyzUrl: "https://api.programmable.market/readyz",
      capabilitiesUrl: "https://api.programmable.market/v3/capabilities",
      preflightUrl: "https://api.programmable.market/v3/custom-launches/preflight",
      openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
      legacyIntake: { registry: "closed", github: "closed" },
      cli: {
        packageName: "@programmable/launch",
        binary: "programmable-launch",
        releaseVersion: "3.3.9",
        tarballUrl:
          "https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz",
        checksumUrl:
          "https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz.sha256",
        tarballSha256:
          "sha256:44b71185355bea8db6820b61f12351db7cc1237aa7ecf9b0db3cfbb09bebee01",
      },
      compatibility: {
        v1: {
          openApiUrl: "https://programmable.market/openapi/custom-launch-v1.json",
          cliReleaseVersion: "1.0.1",
        },
        v2: {
          openApiUrl: "https://programmable.market/openapi/custom-launch-v2.json",
          reads: "live",
          create: "read-only",
          createHttpStatus: 409,
          createErrorCode: "CUSTOM_LAUNCH_V2_READ_ONLY",
          retryable: false,
          preparedAndSimulatingReads: "observation-only",
          readMayAuthorize: false,
        },
      },
      publicRelease: {
        status: "live",
        apiVersion: "3",
        guideUrl: "https://programmable.market/docs/developers/custom-launch",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
        authentication: "bearer-api-key",
        walletBoundary: "separate-wallet-signature",
        cli: {
          packageName: "@programmable/launch",
          binary: "programmable-launch",
          releaseVersion: "3.3.9",
          tarballUrl:
            "https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz",
          checksumUrl:
            "https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz.sha256",
          tarballSha256:
            "sha256:44b71185355bea8db6820b61f12351db7cc1237aa7ecf9b0db3cfbb09bebee01",
        },
      },
      generalHookProfile: {
        status: "selected-by-server-capabilities",
        apiVersion: "3",
        profileId: "programmable.direct-native-hook-graph.v1",
        profileRevision: 3,
        profileVersion: null,
        compatibleProfileVersions: ["3.2.0", "3.1.0", "3.0.0", "2.0.0"],
        legacyProfileSemantics: "readable-and-byte-identical-retryable-only",
        productionLaunchAuthorized: null,
        createPath: "/v3/custom-launches",
        capabilitiesPath: "/v3/capabilities",
        preflightPath: "/v3/custom-launches/preflight",
        finalizedMetadataPath: "/v3/finalized-custom-launches",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
        cliReleaseVersion: null,
        admissionPolicy: {
          manualProjectAllowlist: false,
          hardBlockFindingRules: [
            { code: "RUNTIME_CALLCODE", targetRoles: ["any"] },
            { code: "RUNTIME_SELFDESTRUCT", targetRoles: ["any"] },
            { code: "SOURCE_SELFDESTRUCT_SURFACE", targetRoles: ["any"] },
            { code: "V4_CALLBACK_AUTHENTICATION_MISSING", targetRoles: ["hook"] },
            { code: "V4_CALLBACK_AUTHENTICATION_INVALID", targetRoles: ["hook"] },
            { code: "V4_CALLBACK_POOL_MANAGER_MISMATCH", targetRoles: ["hook"] },
            { code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING", targetRoles: ["hook"] },
          ],
          returnDeltaRequiresBehaviorEvidence: true,
        },
      },
      integrationPreview: {
        status: "selected-by-server-capabilities",
        apiVersion: "3",
        publicAuthorization: null,
        createPath: "/v3/custom-launches",
        capabilitiesPath: "/v3/capabilities",
        preflightPath: "/v3/custom-launches/preflight",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
        profileId: "programmable.direct-native-hook-graph.v1",
        profileRevision: 3,
        profileVersion: null,
        compatibleProfileVersions: ["3.2.0", "3.1.0", "3.0.0", "2.0.0"],
        requestSchemaVersion: "programmable.custom-launch-create-request.v3",
        minimumTargets: 3,
        maximumTargets: 16,
        projectOwnedToken: true,
        projectOwnedHook: true,
        hookPermissionMaskRange: { minimum: 0, maximum: 16_383 },
        allFourteenHookPermissionsStructurallySupported: true,
        manualProjectAllowlist: false,
        quoteCurrencies: ["native", "erc20"],
        liquidityModels: [
          "external-concentrated-liquidity",
          "launch-seeded-concentrated-liquidity",
          "hook-inventory-custom-accounting",
        ],
        productTruthAxes: [
          "deployment",
          "trading",
          "platform_fee_evidence",
          "source_verification",
          "indexing",
          "featured",
        ],
        platformAdmissionReceiptRequired: true,
        routerSimulationRequiredBeforeAuthorization: true,
        serverVerifiedEvidenceRequiredForPositiveClaims: true,
        safetyClaim: false,
        feeBehaviorClaim: false,
        fundingAuthorization: {
          modes: [
            "none",
            "wallet-transaction-value",
            "eip-3009-receive-with-authorization",
          ],
          createRequestSignatureIncluded: false,
          fundingIntentStage: "pre-signature",
        },
        activationBlockers: [],
        errorCode: null,
      },
      releaseCandidate: {
        status: "promoted-to-public",
        publicAuthorization: true,
        artifactPublished: true,
        packageName: "@programmable/launch",
        binary: "programmable-launch",
        releaseVersion: "3.3.9",
        releaseTag: "programmable-launch-v3.3.9",
        releaseUrl:
          "https://github.com/programmablehq/PROGRAMMABLE/releases/tag/programmable-launch-v3.3.9",
        tarballUrl:
          "https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz",
        checksumUrl:
          "https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz.sha256",
        tarballSha256:
          "sha256:44b71185355bea8db6820b61f12351db7cc1237aa7ecf9b0db3cfbb09bebee01",
        openApiUrl:
          "https://programmable.market/openapi/custom-launch-v3.json",
        feePolicy: {
          profileId: "programmable.direct-native-hook-graph.v1",
          profileRevision: 3,
          productionLaunchAuthorized: true,
          chainId: "1",
          network: "Ethereum Mainnet",
          chargeTrigger: "successful-swap",
          basis: "per-launch-declared-conformance-basis",
          ratePpm: 1_000,
          denominatorPpm: 1_000_000,
          ratePercent: "0.10%",
          rateBps: 10,
          recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          applicantSelectedMaximumHundredthsOfBip: "100000",
          maximumAdditiveEffectiveTotalHundredthsOfBip: "101000",
          lpPoolFeeMaximumUnchanged: true,
          enforcement: "per-launch-server-verified-fee-path-evidence-gate",
          admissionAssurance: "wallet-handoff-gate-only",
          safetyClaim: false,
          feeBehaviorClaim: false,
          tenBpsClaimRequiresExactPerLaunchVerifiedFeePathEvidence: true,
          claimScope: "exact-launch-and-stamped-poolkey-only",
          lpFee: "separate-from-platform-fee",
          genericFeeClaiming: "not-live",
          genericBuybackManagement: "not-live",
        },
      },
      versions: {
        v1: {
          reads: "live",
          create: "read-only",
          createHttpStatus: 409,
          createErrorCode: "CUSTOM_LAUNCH_V1_READ_ONLY",
          retryable: false,
        },
        v2: {
          reads: "live",
          create: "read-only",
          createHttpStatus: 409,
          createErrorCode: "CUSTOM_LAUNCH_V2_READ_ONLY",
          retryable: false,
          preparedAndSimulatingReads: "observation-only",
          readMayAuthorize: false,
          authorizedAndSubmittedReconciliation: "bounded",
        },
        v3: {
          status: "live",
          publicAuthorization: null,
          freshWritesOnlyProfileVersion: null,
          createHttpStatus: 202,
          replayHttpStatus: 200,
          capabilitiesPath: "/v3/capabilities",
          preflightPath: "/v3/custom-launches/preflight",
          preflightQuotaConsumed: false,
          preflightNonceAllocated: false,
          preflightPersisted: false,
        },
      },
    });
    expect(document.publicCategories.custom).toMatchObject({
      discoveryStatus: "live",
      publicSubmissionStatus: "closed",
      publicSubmissionStatusScope: "legacy-registry-intake",
      publicApiCreateStatus: "live",
      customLaunchApiStatus: "live",
      registryDiscoveryStatus: "legacy-closed",
      legacyRegistrySubmissionStatus: "closed",
      legacyGithubSubmissionStatus: "closed",
    });
    expect(JSON.stringify(document)).not.toContain("api-live");
    expect(JSON.stringify(document)).not.toContain("prelaunch");
  });

  it("binds published V3 discovery and its immutable machine bytes", () => {
    const digest = (bytes: Buffer) =>
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const publicPackSchema = readFileSync(
      join(root, "public/schemas/custom-launch/v3/pack-config.json"),
    );
    const packagedPackSchema = readFileSync(
      join(root, "packages/launch/schemas/programmable-launch-pack-config-v3.json"),
    );
    const publicOpenApi = readFileSync(
      join(root, "public/openapi/custom-launch-v3.json"),
    );
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );

    expect(publicPackSchema.equals(packagedPackSchema)).toBe(true);
    expect(digest(publicPackSchema)).toBe(
      "sha256:65e80af492582b8e42a440d9bbb23a776af31e22306ec828208959e8a790be15",
    );
    expect(digest(publicOpenApi)).toBe(
      "sha256:8c7f90255f62bb8c27083c868dfdef5a7cc15d9ed0815248c55b67b7b9302b6a",
    );
    expect(document.customLaunchApi.cli.releaseVersion).toBe("3.3.9");
    expect(document.customLaunchApi.cli.tarballSha256).toBe(
      "sha256:44b71185355bea8db6820b61f12351db7cc1237aa7ecf9b0db3cfbb09bebee01",
    );
    expect(document.customLaunchApi.releaseCandidate).toMatchObject({
      status: "promoted-to-public",
      artifactPublished: true,
      releaseVersion: "3.3.9",
      tarballSha256:
        "sha256:44b71185355bea8db6820b61f12351db7cc1237aa7ecf9b0db3cfbb09bebee01",
    });
  });

  it("publishes a public, reference-complete V2 contract", () => {
    const v1 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v1.json"),
      "utf8",
    ));
    const v2 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v2.json"),
      "utf8",
    ));

    expect(v2.openapi).toBe("3.1.0");
    expect(v2.info.version).toBe("2.0.0");
    expect(v2["x-programmable-availability"]).toMatchObject({
      status: "live",
      publicAuthorized: false,
      privateCanaryOnly: false,
      publicCreate: {
        status: "read-only",
        httpStatus: 409,
        errorCode: "CUSTOM_LAUNCH_V2_READ_ONLY",
        retryable: false,
      },
      readSemantics: {
        preparedAndSimulating: "observation-only",
        readMayAuthorize: false,
        authorizedAndSubmittedReconciliation: "bounded",
      },
    });
    expect(v2["x-programmable-release-candidate"]).toMatchObject({
      status: "read-compatibility",
      version: "2.0.1",
      launchProfileHash:
        "sha256:fd2d738117c4c69304efb49c75d402d2e8b8968832fd2e27548c3d9814c5c9ee",
      productionLaunchAuthorized: false,
    });
    expect(Object.keys(v2.paths).sort()).toEqual([
      "/v2/custom-launches",
      "/v2/custom-launches/{launchId}",
    ]);
    const operations = Object.values(v2.paths).flatMap((path) =>
      Object.values(path as Record<string, unknown>)
    ) as Array<Record<string, unknown>>;
    const operationIds = operations.map(({ operationId }) => operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);

    const create = v2.paths["/v2/custom-launches"].post;
    expect(create).toMatchObject({
      deprecated: true,
      summary: "V2 launch creation is read-only",
      "x-programmable-public-availability": "read-only",
    });
    expect(Object.keys(create.responses)).toEqual(["401", "403", "409"]);
    expect(create).not.toHaveProperty("parameters");
    expect(create).not.toHaveProperty("requestBody");
    expect(create.responses["409"].content["application/json"].example.error)
      .toMatchObject({ code: "CUSTOM_LAUNCH_V2_READ_ONLY" });
    expect(v2.components.responses.V2Unavailable.headers["Retry-After"])
      .toEqual({ $ref: "#/components/headers/RetryAfterSeconds" });
    expect(
      v2.components.responses.V2Unavailable.content["application/json"]
        .example.error.code,
    ).toBe("LAUNCH_UNAVAILABLE");

    const request = v2.components.schemas.CustomLaunchCreateRequestV2;
    expect(request.additionalProperties).toBe(false);
    expect(request.required).toEqual([
      "schemaVersion",
      "launchWallet",
      "chainId",
      "nonce",
      "sourceDescriptor",
      "sourceBundleManifest",
      "graphBundle",
      "launchProfile",
      "launchProfileSelection",
      "launchProfileHash",
      "launchIntentHash",
      "agentAttestation",
      "verificationBundle",
    ]);
    expect(request.properties.verificationBundle).toEqual({
      $ref: "#/components/schemas/ExactSourceVerificationBundleV2",
    });
    expect(v2.components.schemas.FeeEnforcedLaunchProfileV2.properties)
      .toMatchObject({
        profileId: {
          const:
            "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
        },
        profileRevision: { const: 3 },
        profileVersion: { const: "2.0.0" },
        productionLaunchAuthorized: { const: true },
        chainId: { const: "1" },
      });
    expect(v2.components.schemas.FeeEnforcedLaunchProfileBindingV2.properties)
      .toMatchObject({
        profileId: {
          const:
            "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
        },
        profileRevision: { const: 3 },
      });
    expect(v2.components.schemas.CustomLaunchResourceV2.properties.status.enum)
      .toContain("simulating");
    const sourceVerification =
      v2.components.schemas.CustomLaunchResourceV2.properties.sourceVerification;
    expect(v2.components.schemas.CustomLaunchResourceV2.required)
      .not.toContain("sourceVerification");
    expect(sourceVerification).toEqual({
      description:
        "Optional server-authored post-finality verification state returned by the single-resource GET. It is absent or null when no durable status exists; create and list responses do not populate it.",
      oneOf: [
        { $ref: "#/components/schemas/SourceVerificationStatusV1" },
        { type: "null" },
      ],
    });
    expect(v2.components.schemas.SourceVerificationStatusV1).toEqual({
      $ref:
        "./custom-launch-v1.json#/components/schemas/SourceVerificationStatusV1",
    });
    expect(v1.components.schemas.SourceVerificationStatusV1).toMatchObject({
      additionalProperties: false,
      required: ["schemaVersion", "status", "components", "updatedAt"],
      properties: {
        schemaVersion: {
          const: "programmable.source-verification-status.v1",
        },
        status: {
          enum: ["queued", "retrying", "exact_match", "needs_attention"],
        },
      },
    });
    expect(v1.components.schemas.SourceVerificationComponentV1).toMatchObject({
      additionalProperties: false,
      required: ["targetId", "address", "status", "provider"],
      properties: {
        status: {
          enum: ["queued", "retrying", "exact_match", "needs_attention"],
        },
        provider: {
          enum: ["sourcify", "etherscan", "blockscout", null],
        },
      },
    });
    expect(
      v1.components.schemas.SourceVerificationStatusV1.description,
    ).toContain("clients must not infer or submit this object");
    expect(
      v2.components.schemas.CustomLaunchSummaryV2.allOf[1].properties.output,
    ).toEqual({ type: "null" });
    expect(
      v2.components.schemas.CustomLaunchAuthorizedOutputV2.properties.simulation,
    ).toEqual({ $ref: "#/components/schemas/ExactSimulationEvidenceV2" });
    expect(
      v2.components.schemas.CustomLaunchAuthorizedOutputV2.properties
        .walletTransaction,
    ).toEqual({ $ref: "#/components/schemas/CustomLaunchWalletTransactionV1" });

    const documents = new Map<string, unknown>([
      ["", v2],
      ["./custom-launch-v1.json", v1],
    ]);
    const resolvePointer = (document: unknown, pointer: string): unknown =>
      pointer.slice(2).split("/").reduce<unknown>((current, segment) => {
        expect(current).toBeTypeOf("object");
        expect(current).not.toBeNull();
        const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
        return (current as Record<string, unknown>)[key];
      }, document);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (typeof record.$ref === "string") {
        const [documentPath = "", fragment = ""] = record.$ref.split("#");
        const document = documents.get(documentPath);
        expect(document, `unknown OpenAPI document ${documentPath}`).toBeDefined();
        expect(fragment.startsWith("/")).toBe(true);
        expect(resolvePointer(document, `#${fragment}`)).toBeDefined();
      }
      Object.values(record).forEach(visit);
    };
    visit(v2);
  });

  it("publishes a preparatory V3.4 contract without changing live V3.3 discovery", () => {
    const v1 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v1.json"),
      "utf8",
    ));
    const v2 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v2.json"),
      "utf8",
    ));
    const v3 = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v3.json"),
      "utf8",
    ));

    expect(v3.openapi).toBe("3.1.0");
    expect(v3.info.version).toBe("3.3.9");
    expect(v3["x-programmable-availability"]).toMatchObject({
      status: "live",
      publicAuthorized: true,
      liveContract: {
        cliReleaseVersion: "3.3.9",
        profileVersion: "3.3.0",
        discoveryAuthority: "https://programmable.market/.well-known/programmable.json",
      },
      publicCreate: {
        status: "live",
        path: "/v3/custom-launches",
        httpStatus: 202,
        replayHttpStatus: 200,
      },
      publicCapabilities: {
        status: "live",
        path: "/v3/capabilities",
        authentication: "none",
      },
      publicPreflight: {
        status: "live",
        path: "/v3/custom-launches/preflight",
        httpStatus: 200,
        authentication: "bearer-api-key",
        requiredScope: "custom-launch:create",
        quotaConsumed: false,
        quotaConsumedMeaning: "no-launch-creation-quota-or-durable-reservation",
        authenticatedRequestRateBudgetConsumed: true,
        nonceAllocated: false,
        persisted: false,
      },
      stableProductionVersion: "3",
      stableOpenApiUrl:
        "https://programmable.market/openapi/custom-launch-v3.json",
      freshWritesOnlyProfileVersion: "3.3.0",
      pendingProfileVersion: "3.4.0",
      preparatoryProfileCliReleaseVersion: "3.3.9",
      walletHandoffEvidenceGate: {
        decisionAuthority: "api-server",
        clientChecks: "preparation-only",
        requiredForProfileVersion: "3.4.0",
        walletHandoffRequiresVerifiedEvidence: false,
        configurationIsExecutionEvidence: false,
        requiredPlatformFeeConformanceStatus: "verified",
        nonFeeVectorsMayRemainUnverified: true,
        evidenceAuthority: "platform-runtime-executor",
        signedExecutionReceiptRequired: true,
        notConfiguredDisposition: "claims_remain_unverified",
        unavailableDisposition: "claims_remain_unverified",
        executedFeeFailureDisposition: "blocks_wallet_handoff",
        executedHardInvariantFailureDisposition: "blocks_wallet_handoff",
        feeBehaviorClaim: false,
        tenBpsClaimRequiresExactPerLaunchVerifiedFeePathEvidence: true,
        claimScope: "exact-launch-and-stamped-poolkey-only",
        mandatoryServerGates: [
          "static-hard-block-policy",
          "exact-router-simulation",
        ],
        localOrModelApprovalAccepted: false,
      },
      activationBlockers: [
        "backend-profile-3.4-activation",
        "well-known-profile-default-flip",
        "independent-profile-3.4-capability-and-route-probes",
      ],
    });
    expect(Object.keys(v3.paths).sort()).toEqual([
      "/v1/partner/subkeys",
      "/v1/partner/subkeys/{subkeyId}",
      "/v1/partner/subkeys/{subkeyId}/rotate",
      "/v3/capabilities",
      "/v3/custom-launches",
      "/v3/custom-launches/preflight",
      "/v3/custom-launches/{launchId}",
      "/v3/custom-launches/{launchId}/permit-reissues",
      "/v3/finalized-custom-launches",
      "/v3/wallet-admin/custom-launches/{launchId}/funding-authorization",
    ]);
    const capabilities = v3.paths["/v3/capabilities"].get;
    expect(capabilities.security).toEqual([]);
    expect(capabilities.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CustomLaunchCapabilitiesV1");
    const preflight = v3.paths["/v3/custom-launches/preflight"].post;
    expect(preflight.security).toEqual([{ CustomLaunchApiKey: [] }]);
    expect(preflight.parameters).toBeUndefined();
    expect(preflight.requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CustomLaunchCreateRequestV3");
    expect(preflight.responses["200"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CustomLaunchPreflightV1");
    expect(Object.keys(preflight.responses)).toEqual([
      "200", "400", "401", "403", "413", "415", "422", "500", "503",
    ]);
    expect(preflight.responses["503"].$ref)
      .toBe("#/components/responses/V3Unavailable");
    expect(v3.components.responses.V3Unavailable.headers["Retry-After"]
      .schema.pattern).toBe("^[1-9][0-9]*$");
    expect(preflight["x-programmable-side-effects"]).toEqual({
      quotaConsumed: false,
      quotaConsumedMeaning: "no-launch-creation-quota-or-durable-reservation",
      authenticatedRequestRateBudgetConsumed: true,
      nonceAllocated: false,
      persisted: false,
      walletSignatureRequiredLater: true,
      walletBroadcastByService: false,
    });
    const preflightSchema = v3.components.schemas.CustomLaunchPreflightV1;
    expect(preflightSchema.properties).toMatchObject({
      schemaVersion: { const: "programmable.custom-launch-preflight.v1" },
      requestHash: {
        $ref: "./custom-launch-v2.json#/components/schemas/Sha256Digest",
      },
      disposition: {
        enum: [
          "supported",
          "supported_with_warnings",
          "needs_evidence",
          "unsupported",
        ],
      },
      quotaConsumed: { const: false },
      nonceAllocated: { const: false },
      persisted: { const: false },
      walletSignatureRequiredLater: { const: true },
      walletBroadcastByService: { const: false },
    });
    expect(preflightSchema.properties.launchEligibility.required).toEqual([
      "deployable", "routable", "featured",
    ]);
    expect(preflightSchema.properties.evidenceTier.enum).toEqual([
      "launch_mechanics_verified",
      "standard_swap_compatible",
      "advanced_custom_accounting",
      "governed_external_trust",
    ]);
    expect(preflightSchema.required).toEqual(expect.arrayContaining([
      "riskClassification",
      "behaviorEvidence",
      "productTruthAxes",
    ]));
    expect(preflightSchema.properties.riskClassification.oneOf).toEqual([
      { $ref: "#/components/schemas/PlatformAdmissionRiskClassificationV3" },
      { type: "null" },
    ]);
    expect(preflightSchema.properties.behaviorEvidence.$ref)
      .toBe("#/components/schemas/CustomLaunchBehaviorEvidenceSummaryV3");
    expect(preflightSchema.properties.productTruthAxes.$ref)
      .toBe("#/components/schemas/CustomLaunchProductTruthAxesV3");
    expect(preflightSchema.properties.hardBlockFindingCodes.$ref)
      .toBe("#/components/schemas/CustomLaunchFindingCodeListV1");
    expect(preflightSchema.properties.needsEvidenceFindingCodes.$ref)
      .toBe("#/components/schemas/CustomLaunchFindingCodeListV1");
    expect(preflightSchema.properties.warningFindingCodes.$ref)
      .toBe("#/components/schemas/CustomLaunchFindingCodeListV1");
    expect(preflightSchema.properties.staticBaseline.oneOf).toEqual([
      { $ref: "#/components/schemas/StaticBaselineReportV1" },
      { type: "null" },
    ]);
    expect(preflightSchema.properties.remediations.items.$ref)
      .toBe("#/components/schemas/CustomLaunchRemediationV1");
    expect(v3.components.schemas.CustomLaunchCapabilitiesV1.properties
      .productTruthAxes.const).toEqual([
      "deployment",
      "trading",
      "platform_fee_evidence",
      "source_verification",
      "indexing",
      "featured",
    ]);
    expect(v3.components.schemas.CustomLaunchCapabilitiesV1.required)
      .toContain("behaviorEvidence");
    expect(v3.components.schemas.CustomLaunchCapabilitiesV1.properties
      .behaviorEvidence).toMatchObject({
        required: expect.arrayContaining([
          "requiredForProfileVersion",
          "configurationIsExecutionEvidence",
          "walletHandoffRequiresVerifiedEvidence",
          "requiredPlatformFeeConformanceStatus",
          "nonFeeVectorsMayRemainUnverified",
          "evidenceAuthority",
          "signedExecutionReceiptRequired",
          "notConfiguredDisposition",
          "unavailableDisposition",
          "executedFeeFailureDisposition",
          "executedHardInvariantFailureDisposition",
        ]),
        properties: {
          requiredForProfileVersion: { const: "3.4.0" },
          configurationIsExecutionEvidence: { const: false },
          walletHandoffRequiresVerifiedEvidence: { const: false },
          requiredPlatformFeeConformanceStatus: { const: "verified" },
          nonFeeVectorsMayRemainUnverified: { const: true },
          evidenceAuthority: { const: "platform-runtime-executor" },
          signedExecutionReceiptRequired: { const: true },
          notConfiguredDisposition: { const: "claims_remain_unverified" },
          unavailableDisposition: { const: "claims_remain_unverified" },
          executedFeeFailureDisposition: { const: "blocks_wallet_handoff" },
          executedHardInvariantFailureDisposition: {
            const: "blocks_wallet_handoff",
          },
        },
      });
    expect(v3.components.schemas.ProjectMetadataCapabilitiesV1.properties
      .requiredForProfileVersions)
      .toEqual({ const: ["3.2.0", "3.3.0", "3.4.0"] });
    expect(v3.components.schemas.ProjectMetadataCapabilitiesV1.properties
      .strictMetadataProfileVersions)
      .toEqual({ const: ["3.3.0", "3.4.0"] });
    expect(v3.components.schemas.ProjectMetadataCapabilitiesV1.properties
      .legacyMetadataProfileVersions)
      .toEqual({ const: ["3.2.0"] });
    expect(v3.components.schemas.CustomLaunchCapabilitiesV1.properties
      .feePolicy.properties
      .feeBehaviorClaim)
      .toEqual({ const: false });
    expect(v3.components.schemas.CustomLaunchCapabilitiesV1.properties
      .feePolicy.properties
      .tenBpsClaimRequiresExactPerLaunchVerifiedFeePathEvidence)
      .toEqual({ const: true });
    expect(v3.components.schemas.CustomLaunchCapabilitiesV1.properties
      .feePolicy.properties
      .claimScope)
      .toEqual({ const: "exact-launch-and-stamped-poolkey-only" });
    expect(v3.components.schemas.FinalizedCustomLaunchMetadataV1.required)
      .toContain("launchProfileVersion");
    expect(v3.components.schemas.FinalizedCustomLaunchMetadataV1.properties
      .launchProfileVersion)
      .toMatchObject({
        description: expect.stringContaining(
          "clients cannot infer current metadata requirements without this value",
        ),
        enum: ["2.0.0", "3.0.0", "3.1.0", "3.2.0", "3.3.0", "3.4.0"],
      });
    expect(v3.components.schemas.CustomLaunchResourceV3.required)
      .toContain("lifecycleQueue");
    expect(v3.components.schemas.CustomLaunchResourceV3.properties
      .lifecycleQueue.oneOf).toEqual([
        { $ref: "#/components/schemas/CustomLaunchLifecycleQueueV3" },
        { type: "null" },
      ]);
    expect(v3.paths["/v3/custom-launches"].post
      ["x-programmable-public-availability"]).toBe("live");
    expect(v3.paths["/v3/custom-launches"].post.responses["503"]
      .headers["Retry-After"].schema.pattern).toBe("^[1-9][0-9]*$");
    expect(Object.keys(v3.paths["/v3/custom-launches"].post.responses))
      .toEqual([
        "200", "202", "400", "401", "403", "409", "413", "415", "422", "429", "500", "503",
      ]);
    expect(v3.paths["/v3/custom-launches"].post.responses["202"])
      .toBeDefined();
    expect(v3.paths["/v3/custom-launches"].get.responses["200"])
      .toBeDefined();
    expect(v3.paths["/v3/custom-launches/{launchId}"].get.responses["200"])
      .toBeDefined();
    const fundingSubmission = v3.paths[
      "/v3/wallet-admin/custom-launches/{launchId}/funding-authorization"
    ].post;
    expect(fundingSubmission.security).toEqual([
      { CustomLaunchWebsiteToken: [] },
    ]);
    expect(fundingSubmission.parameters.map((parameter: { name: string }) =>
      parameter.name)).toEqual([
      "launchId",
      "Idempotency-Key",
      "X-Programmable-Privy-User-Id",
      "X-Programmable-Wallet-Address",
    ]);
    expect(fundingSubmission.requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/FundingAuthorizationSubmissionV1");
    expect(Object.keys(fundingSubmission.responses).sort()).toEqual([
      "200", "202", "400", "401", "403", "404", "409", "413", "415", "422", "429", "500", "503",
    ]);
    expect(v3["x-programmable-funding-boundary"]
      .excludedFromFundingIntentHash).toEqual([
      "signature",
      "initializerCalldataHash",
      "graphCommitment",
      "permitDigest",
    ]);

    const request = v3.components.schemas.CustomLaunchCreateRequestV3;
    expect(request.additionalProperties).toBe(false);
    expect(request.required).toEqual([
      "schemaVersion",
      "launchWallet",
      "chainId",
      "nonce",
      "permitWindow",
      "sourceDescriptor",
      "sourceBundleManifest",
      "graphBundle",
      "launchProfile",
      "launchProfileSelection",
      "launchProfileHash",
      "launchIntentHash",
      "agentAttestation",
      "verificationBundle",
    ]);
    expect(request.properties.schemaVersion.const)
      .toBe("programmable.custom-launch-create-request.v3");
    expect(request.allOf[0].oneOf).toHaveLength(6);
    expect(request.allOf[0].oneOf[0].properties.launchProfile.properties)
      .toMatchObject({
        schemaVersion: { const: "programmable.direct-native-hook-graph-profile.v3" },
        profileRevision: { const: 3 },
        profileVersion: { const: "3.4.0" },
      });
    expect(request.allOf[0].oneOf[0].properties.graphBundle.$ref)
      .toBe("#/components/schemas/CustomGraphBundleV3_4");
    expect(request.allOf[0].oneOf[0].required).toEqual(expect.arrayContaining([
      "behaviorScenarioInputs",
      "behaviorScenarioInputsHash",
    ]));
    expect(request.allOf[0].oneOf[1].properties.launchProfile.properties)
      .toMatchObject({
        schemaVersion: { const: "programmable.direct-native-hook-graph-profile.v3" },
        profileRevision: { const: 3 },
        profileVersion: { const: "3.3.0" },
      });
    expect(request.allOf[0].oneOf[0].properties.launchProfileSelection
      .properties).toMatchObject({
        schemaVersion: {
          const: "programmable.direct-native-hook-graph-profile-selection-binding.v3",
        },
        profileRevision: { const: 3 },
      });
    expect(request.allOf[0].oneOf[0].properties.verificationBundle.$ref)
      .toBe("#/components/schemas/DirectNativeExactSourceVerificationBundleV3");
    expect(request.allOf[0].oneOf[2].properties.launchProfile.properties)
      .toMatchObject({
        schemaVersion: { const: "programmable.direct-native-hook-graph-profile.v3" },
        profileRevision: { const: 3 },
        profileVersion: { const: "3.2.0" },
      });
    expect(request.allOf[0].oneOf[3].properties.launchProfile.properties)
      .toMatchObject({
        schemaVersion: { const: "programmable.direct-native-hook-graph-profile.v3" },
        profileRevision: { const: 3 },
        profileVersion: { const: "3.1.0" },
      });
    expect(request.allOf[0].oneOf[4].properties.launchProfile.properties)
      .toMatchObject({
        schemaVersion: { const: "programmable.direct-native-hook-graph-profile.v3" },
        profileRevision: { const: 3 },
        profileVersion: { const: "3.0.0" },
      });
    expect(request.allOf[0].oneOf[5].properties.launchProfile.properties)
      .toMatchObject({
        schemaVersion: { const: "programmable.direct-native-hook-graph-profile.v2" },
        profileRevision: { const: 2 },
        profileVersion: { const: "2.0.0" },
      });
    expect(request.allOf[2].then.required)
      .toEqual(["fundingAuthorization", "fundingIntentHash"]);
    expect(request.allOf[1].then.required)
      .toEqual(["behaviorScenarioInputs", "behaviorScenarioInputsHash"]);
    expect(request.properties.permitWindow.$ref)
      .toBe("#/components/schemas/DirectNativePermitWindowV1");
    expect(Object.keys(request.properties)).not.toContain("signature");

    const graph = v3.components.schemas.CustomGraphBundleV3;
    expect(graph.allOf[1].properties.targets).toMatchObject({
      minItems: 3,
      maxItems: 16,
    });
    const graphV3_4 = v3.components.schemas.CustomGraphBundleV3_4;
    expect(graphV3_4.allOf[1].properties.targets).toMatchObject({
      minItems: 4,
      maxItems: 16,
    });
    expect(v3["x-programmable-pending-profile"]).toMatchObject({
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 3,
      profileVersion: "3.4.0",
      compatibleProfileVersions: ["3.3.0", "3.2.0", "3.1.0", "3.0.0", "2.0.0"],
      activationStatus: "preparatory-not-live",
      liveProfileVersion: "3.3.0",
      availableForFreshWrites: false,
      productionLaunchAuthorized: false,
      minimumTargets: 4,
      maximumTargets: 16,
      minimumHookPermissionMask: 0,
      maximumHookPermissionMask: 16383,
      projectOwnedToken: true,
      projectOwnedHook: true,
      platformAdmissionReceiptRequired: true,
      routerSimulationRequiredBeforeAuthorization: true,
      serverVerifiedEvidenceRequiredForPositiveClaims: true,
      safetyClaim: false,
      feeBehaviorClaim: false,
      canonicalSettlementFeeModule: {
        moduleId: "programmable:settlement-fee-vault:v1",
        releaseBindingSha256:
          "sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9",
        sourceSha256:
          "sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b",
        creationBytecodeKeccak256:
          "0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e",
        runtimeBytecodeKeccak256:
          "0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554",
      },
    });
    expect(v3.components.schemas.DirectNativeHookPermissionPolicyV1.properties)
      .toMatchObject({
        minimumMask: { const: 0 },
        maximumMask: { const: 16383 },
        requireHookMinerAddressMaskMatch: { const: true },
      });

    const profile = v3.components.schemas.DirectNativeHookGraphProfileV1;
    expect(profile.required).toEqual(expect.arrayContaining([
      "permitAuthority",
      "permitAuthorityRuntimeCodeHash",
      "platformFeePolicy",
    ]));
    expect(profile.oneOf).toHaveLength(6);
    expect(profile.properties.permitAuthority.const)
      .toBe("0x755509eA6e3F5Ec1aA2E797bb68f1B87DD8b886b");
    expect(profile.properties).toMatchObject({
      profileVersion: {
        enum: ["2.0.0", "3.0.0", "3.1.0", "3.2.0", "3.3.0", "3.4.0"],
      },
      productionLaunchAuthorized: { const: true },
      routerRuntimeCodeHash: {
        const:
          "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
      },
      permitAuthorityRuntimeCodeHash: {
        const:
          "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
      },
      graphFactoryRuntimeCodeHash: {
        const:
          "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
      },
      poolManagerRuntimeCodeHash: {
        const:
          "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
      },
      fundingTokenRuntimeCodeHash: {
        const:
          "0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505",
      },
    });
    expect(profile.properties.platformFeePolicy.$ref)
      .toBe("#/components/schemas/PlatformFeePolicyV1");
    expect(profile.properties.platformAdmissionPolicy.$ref)
      .toBe("#/components/schemas/PlatformAdmissionPolicyV1");
    expect(v3.components.schemas.PlatformAdmissionPolicyV1.oneOf).toEqual([
      { $ref: "#/components/schemas/PlatformAdmissionPolicyV3_1_0" },
      { $ref: "#/components/schemas/PlatformAdmissionPolicyV3_0_0" },
    ]);
    expect(v3.components.schemas.PlatformAdmissionPolicyV3_1_0.properties)
      .toMatchObject({
        warningDisposition: { const: "bound-and-visible" },
        noBlockingFindingDisposition: { const: "router-simulation-eligible" },
        blockingFindingDisposition: { const: "action-required" },
        routerSimulationRequiredBeforeAuthorization: { const: true },
        assurance: { const: "launch-admission-only" },
        safetyClaim: { const: false },
        feeBehaviorClaim: { const: false },
      });
    expect(v3.components.schemas.PlatformAdmissionPolicyV3_1_0.properties
      .blockingFindingRules.const).toEqual([
        { code: "RUNTIME_CALLCODE", targetRoles: ["any"] },
        { code: "RUNTIME_SELFDESTRUCT", targetRoles: ["any"] },
        { code: "SOURCE_SELFDESTRUCT_SURFACE", targetRoles: ["any"] },
        { code: "V4_CALLBACK_AUTHENTICATION_MISSING", targetRoles: ["hook"] },
        { code: "V4_CALLBACK_AUTHENTICATION_INVALID", targetRoles: ["hook"] },
        { code: "V4_CALLBACK_POOL_MANAGER_MISMATCH", targetRoles: ["hook"] },
        { code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING", targetRoles: ["hook"] },
      ]);
    expect(v3.components.schemas.PlatformAdmissionPolicyV3_0_0.properties
      .blockingFindingRules.const).toHaveLength(13);
    expect(v3["x-programmable-admission-policy"]
      .needsEvidenceFindingCodes).toEqual(expect.arrayContaining([
        "RUNTIME_DELEGATECALL",
        "SOURCE_PROXY_OR_UPGRADE_SURFACE",
        "SOURCE_PUBLIC_MINT_SURFACE",
        "SOURCE_MUTABLE_TAX_OR_FEE_SURFACE",
        "SOURCE_MUTABLE_PAUSE_SURFACE",
        "SOURCE_LIQUIDITY_LOCK_OR_CUSTODY_SURFACE",
      ]));
    expect(v3.components.schemas.StaticBaselineFindingV1.properties.code.enum)
      .toContain("V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING");
    expect(v3.components.schemas.DirectNativeExactSourceVerificationBundleV3
      .allOf[1].properties.compilationUnits.items.allOf[1]
      .properties.compilerVersion.const)
      .toBe("0.8.26+commit.8a97fa7a");
    expect(v3.components.schemas.PlatformFeePolicyV1.properties)
      .toMatchObject({
        accountingMode: {
          enum: ["additive-platform-share", "inclusive-selected-total"],
        },
        rateDenominator: { const: "1000000" },
        programmableFeeHundredthsOfBip: { const: "1000" },
      });
    expect(v3.components.schemas.SelectedFeeHundredthsOfBipV1.pattern)
      .toBe("^(?:0|[1-9][0-9]{0,5})$");
    expect(v3.components.schemas.ApplicantSelectedFeeHundredthsOfBipV1.pattern)
      .toBe("^(?:0|[1-9][0-9]{0,4}|100000)$");
    expect(v3.components.schemas.PlatformFeeEconomicsV2.properties
      .applicantSelectedHundredthsOfBip.$ref)
      .toBe("#/components/schemas/ApplicantSelectedFeeHundredthsOfBipV1");
    expect(v3.components.schemas.PlatformFeeEconomicsV2.properties
      .projectHundredthsOfBip.$ref)
      .toBe("#/components/schemas/SelectedFeeHundredthsOfBipV1");
    expect(v3.components.schemas.PlatformFeeEconomicsV2.properties
      .effectiveTotalHundredthsOfBip.$ref)
      .toBe("#/components/schemas/SelectedFeeHundredthsOfBipV1");
    expect(v3.components.schemas.DirectNativeTargetRolesV1.properties
      .initializerTargetId.description).toContain("componentKind is other");

    const binding = v3.components.schemas.DirectNativeProfileSelectionBindingV1;
    expect(binding.required).toEqual(expect.arrayContaining([
      "expectedPoolId",
      "platformFeeBinding",
    ]));
    const patch = v3.components.schemas.FundingSignaturePatchDescriptorV1;
    expect(patch.required).toEqual([
      "schemaVersion",
      "targetId",
      "unsignedInitializerCalldataSha256",
      "initializerCalldataLengthBytes",
      "signatureEncoding",
      "rOffsetBytes",
      "sOffsetBytes",
      "vOffsetBytes",
    ]);
    expect(patch.properties.signatureEncoding.const)
      .toBe("eip3009-r-s-v-abi-words");
    expect(v3.components.schemas.DirectNativePoolKeyV1.properties.fee.oneOf)
      .toEqual([
        { type: "integer", minimum: 0, maximum: 999999 },
        { const: 8388608 },
      ]);
    expect(v3.components.schemas.DirectNativePoolKeyV1.properties.tickSpacing)
      .toMatchObject({ type: "integer", minimum: 1, maximum: 32767 });
    const funding = v3.components.schemas.Eip3009FundingAuthorizationDescriptorV1;
    expect(funding.required).toEqual([
      "schemaVersion",
      "method",
      "token",
      "from",
      "to",
      "value",
      "validAfter",
      "validBefore",
      "nonce",
    ]);
    expect(Object.keys(funding.properties)).not.toEqual(
      expect.arrayContaining(["signature", "v", "r", "s"]),
    );
    expect(v3.components.schemas.FundingAuthorizationSubmissionV1
      .properties.signature.pattern).toBe("^0x[0-9a-f]{130}$");
    expect(v3.components.schemas.CustomLaunchResourceV3.properties.status.enum)
      .toEqual(expect.arrayContaining([
        "pending_review",
        "action_required",
        "awaiting_funding_authorization",
        "funding_authorization_verified",
        "authorized",
      ]));
    expect(v3.components.schemas.CustomLaunchResourceV3.properties
      .walletHandoffUrl.oneOf).toEqual([
      { type: "string", format: "uri" },
      { type: "null" },
    ]);
    expect(v3.components.schemas.CustomLaunchResourceV3.properties
      .expiresAt.oneOf).toEqual([
      { type: "string", format: "date-time" },
      { type: "null" },
    ]);
    const outputVariants = v3.components.schemas.CustomLaunchOutputV3.oneOf;
    const outputForStage = (stage: string) => outputVariants.find(
      (variant: { properties: { stage: { const?: string } } }) =>
        variant.properties.stage.const === stage,
    );
    expect(outputForStage("platform-review-pending")).toBeDefined();
    expect(outputForStage("funding-signature-required")).toBeDefined();
    expect(outputForStage("funding-signature-verified")).toBeDefined();
    const onchainOutput = outputForStage("onchain-observation");
    expect(onchainOutput).toBeDefined();
    expect(onchainOutput.required).toEqual([
      "schemaVersion",
      "integrationState",
      "stage",
      "actionRequired",
      "fundingBoundary",
      "artifact",
      "observationWindow",
      "onchain",
      "simulation",
      "behaviorEvidence",
      "behaviorAssurance",
    ]);
    expect(onchainOutput.properties).not.toHaveProperty("signedPermit");
    expect(onchainOutput.properties).not.toHaveProperty("walletTransaction");

    expect(outputForStage("simulating")).toBeUndefined();
    const simulatingResourceContract = v3.components.schemas
      .CustomLaunchResourceV3.allOf.find(
        (constraint: { if?: { properties?: { status?: { const?: string } } } }) =>
          constraint.if?.properties?.status?.const === "simulating",
      );
    expect(simulatingResourceContract).toEqual({
      if: {
        properties: { status: { const: "simulating" } },
        required: ["status"],
      },
      then: {
        properties: { output: { type: "null" } },
        required: ["output"],
      },
    });
    const authorizedRouterEnvelopeContract = v3.components.schemas
      .CustomLaunchResourceV3.allOf.find(
        (constraint: {
          if?: { properties?: { output?: { anyOf?: unknown[] } } };
        }) => Array.isArray(constraint.if?.properties?.output?.anyOf),
      );
    expect(authorizedRouterEnvelopeContract).toEqual({
      if: {
        properties: {
          output: {
            type: "object",
            anyOf: [
              { required: ["signedPermit"] },
              { required: ["walletTransaction"] },
            ],
          },
        },
        required: ["output"],
      },
      then: {
        properties: {
          status: { enum: ["authorized", "submitted", "finalized"] },
        },
        required: ["status"],
      },
    });

    const walletOutput = outputForStage("router-transaction-required");
    expect(walletOutput.required).toEqual([
      "schemaVersion",
      "integrationState",
      "stage",
      "actionRequired",
      "fundingBoundary",
      "artifact",
      "signedPermit",
      "observationWindow",
      "onchain",
      "walletTransaction",
      "simulation",
      "behaviorEvidence",
      "behaviorAssurance",
    ]);
    expect(walletOutput.properties).toMatchObject({
      artifact: {
        $ref: "#/components/schemas/PreparedLaunchArtifactV3",
      },
      signedPermit: {
        $ref: "./custom-launch-v2.json#/components/schemas/SignedPreparedLaunchPermitV1",
      },
      observationWindow: {
        $ref: "./custom-launch-v2.json#/components/schemas/CustomLaunchObservationWindowV1",
      },
      onchain: {
        oneOf: [
          {
            $ref: "#/components/schemas/CustomLaunchOnchainEvidenceV3",
          },
          { type: "null" },
        ],
      },
      walletTransaction: {
        $ref: "#/components/schemas/ExactWalletTransactionV3",
      },
      simulation: {
        $ref: "#/components/schemas/ExactSimulationEvidenceV3",
      },
    });
    expect(walletOutput.additionalProperties).toBe(false);
    expect(outputVariants.filter(
      (variant: { properties: Record<string, unknown> }) =>
        Object.hasOwn(variant.properties, "signedPermit") ||
        Object.hasOwn(variant.properties, "walletTransaction"),
    )).toEqual([walletOutput]);
    expect(v3.components.schemas.ExactSimulationEvidenceV3.required).toEqual([
      "outcome",
      "transactionPreimageHash",
      "profileHash",
      "blockNumber",
      "blockHash",
      "blockTimestamp",
      "responseDigest",
      "gasEstimate",
      "behaviorEvidence",
    ]);
    expect(v3.components.schemas.ExactSimulationEvidenceV3.additionalProperties)
      .toBe(false);
    expect(v1.components.schemas.PreparedLaunchArtifactV1.properties
      .verificationBundleHash.$ref).toBe("#/components/schemas/Sha256Digest");
    expect(v3.components.schemas.PreparedLaunchArtifactV3.required)
      .toContain("verificationBundleHash");
    expect(v3.components.schemas.PreparedLaunchArtifactV3.oneOf[0].required)
      .toEqual([
        "unboundGraphBundleHash",
        "projectMetadata",
        "projectMetadataHash",
      ]);
    expect(v3.components.schemas.CustomLaunchOnchainEvidenceV3.properties
      .finalizedCheckpoint.$ref)
      .toBe("#/components/schemas/FinalizedCheckpointV1");
    expect(v1.components.schemas.CustomLaunchOnchainEvidenceV1.properties
      .finalizedCheckpoint.$ref)
      .toBe("#/components/schemas/FinalizedCheckpointV1");
    expect(v3.components.schemas.FinalizedCheckpointV1).toMatchObject({
      required: [
        "schemaVersion",
        "blockNumber",
        "blockHash",
        "quorumSize",
        "observations",
      ],
      properties: {
        schemaVersion: {
          const: "programmable.ethereum-finalized-checkpoint-quorum.v1",
        },
        quorumSize: { const: 2 },
        observations: { minItems: 2, maxItems: 2 },
      },
      additionalProperties: false,
    });

    const actionRequiredOutput = outputForStage("platform-review-action-required");
    expect(actionRequiredOutput.properties.actionRequired.properties.kind.const)
      .toBe("security-review");
    expect(actionRequiredOutput.properties.actionRequired.required)
      .toContain("remediations");
    expect(actionRequiredOutput.properties.actionRequired.properties.remediations)
      .toMatchObject({
        minItems: 1,
        items: { $ref: "#/components/schemas/CustomLaunchRemediationV1" },
      });
    expect(v3.components.schemas.CustomLaunchRemediationV1).toMatchObject({
      required: expect.arrayContaining([
        "schemaVersion",
        "remediationId",
        "code",
        "stage",
        "requiredChange",
        "retryable",
        "requiresNewRequest",
        "resumeAt",
      ]),
      properties: {
        schemaVersion: { const: "programmable.custom-launch-remediation.v1" },
        catalogUrl: {
          const: "https://programmable.market/policies/custom-launch-agent-remediation-v1.json",
        },
        guideUrl: {
          const: "https://programmable.market/docs/developers/custom-launch#existing-project-integration",
        },
      },
      additionalProperties: false,
    });
    expect(v3.components.schemas.CustomLaunchFailureV3.required)
      .toEqual(["code", "message", "retryable", "remediations"]);
    expect(v3.components.schemas.CustomLaunchResourceV3.properties.failure.oneOf[0])
      .toEqual({ $ref: "#/components/schemas/CustomLaunchFailureV3" });
    expect(actionRequiredOutput.required).toContain("staticBaseline");
    expect(outputVariants.every(
      (variant: { required: string[] }) =>
        variant.required.includes("fundingBoundary"),
    )).toBe(true);
    expect(outputVariants.filter(
      (variant: { properties: { stage: { const?: string } } }) =>
        variant.properties.stage.const !== "platform-review-action-required",
    ).every(
      (variant: { properties: Record<string, unknown> }) =>
        Object.hasOwn(variant.properties, "platformAdmission"),
    )).toBe(true);
    expect(v3.components.schemas.PlatformAdmissionStatusV1.properties)
      .toMatchObject({
        disposition: { const: "no_blocking_static_finding" },
        routerSimulationRequiredBeforeAuthorization: { const: true },
        safetyClaim: { const: false },
        feeBehaviorClaim: { const: false },
      });
    expect(v3.components.schemas.FundingBoundaryV3.properties).toMatchObject({
      approvalTransactionRequired: { const: false },
      permit2Used: { const: false },
      fundingSignatureProducedByService: { const: false },
      walletTransactionBroadcastByService: { const: false },
    });
    expect(JSON.stringify(v3)).not.toContain("CUSTOM_LAUNCH_API_UNAVAILABLE");
    expect(v3.components.responses.V3Unavailable.content["application/json"]
      .example.error.code).toBe("CUSTOM_LAUNCH_V3_UNAVAILABLE");
    expect(walletOutput.properties.actionRequired.required)
      .toEqual(expect.arrayContaining([
      "permitDigest",
      "initializerCalldataHash",
    ]));
    expect(v3.components.schemas.CustomLaunchListPageV3.properties.launches
      .items.$ref).toBe("#/components/schemas/CustomLaunchSummaryV3");
    expect(v3.components.schemas.CustomLaunchSummaryV3.allOf).toEqual([
      { $ref: "#/components/schemas/CustomLaunchResourceV3" },
      {
        type: "object",
        required: ["output"],
        properties: { output: { type: "null" } },
      },
    ]);

    const serialized = JSON.stringify(v3);
    expect(serialized).not.toContain('"additive":true');

    const documents = new Map<string, unknown>([
      ["", v3],
      ["./custom-launch-v1.json", v1],
      ["./custom-launch-v2.json", v2],
    ]);
    const resolvePointer = (document: unknown, pointer: string): unknown =>
      pointer.slice(2).split("/").reduce<unknown>((current, segment) => {
        expect(current).toBeTypeOf("object");
        expect(current).not.toBeNull();
        const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
        return (current as Record<string, unknown>)[key];
      }, document);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value === null || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (typeof record.$ref === "string") {
        const [documentPath = "", fragment = ""] = record.$ref.split("#");
        const document = documents.get(documentPath);
        expect(document, `unknown OpenAPI document ${documentPath}`).toBeDefined();
        expect(fragment.startsWith("/")).toBe(true);
        expect(resolvePointer(document, `#${fragment}`)).toBeDefined();
      }
      Object.values(record).forEach(visit);
    };
    visit(v3);
  });

  it("ships the executable no-broadcast example in the public package", () => {
    const packageJson = JSON.parse(readFileSync(
      join(root, "packages/launch/package.json"),
      "utf8",
    ));
    expect(packageJson.files).toContain("examples");
    const packageGuide = readFileSync(
      join(root, "packages/launch/README.md"),
      "utf8",
    );
    expect(packageGuide).toContain(
      "The historical released package `3.3.9` defaults to general profile",
    );
    expect(packageGuide).toContain(
      "same package contains explicit preparatory support for",
    );
    const guide = readFileSync(
      join(root, "packages/launch/examples/no-broadcast/README.md"),
      "utf8",
    );
    expect(guide).toContain("deterministic-hook-permission-grind-v1");
    expect(guide).toContain("afterInitialize");
    expect(guide).toContain("Stop after `validate`");
    expect(guide).toContain("CUSTOM_LAUNCH_V1_READ_ONLY");
    expect(guide).toContain("never submits, polls, signs, broadcasts");
    expect(guide).toContain("`submit: false`");
    expect(guide).toContain('`stopAt: "pre-submit"`');
  });

  it("builds, packs, and validates the direct-native V3 no-broadcast example", () => {
    const exampleRoot = join(
      root,
      "packages/launch/examples/direct-native-v3-no-broadcast/project",
    );
    const temporaryRoot = mkdtempSync(join(tmpdir(), "programmable-direct-native-v3-"));
    const projectRoot = join(temporaryRoot, "project");
    const cli = join(root, "packages/launch/bin/programmable-launch.mjs");
    const configPath = join(projectRoot, "programmable-launch.config.json");
    const fetchFixturePath = join(temporaryRoot, "capabilities-fetch.mjs");
    const capabilitiesRequestsPath = join(temporaryRoot, "capabilities-requests.txt");
    const capabilitiesRequest = "GET https://api.programmable.market/v3/capabilities";
    const environment = {
      ...process.env,
      PROGRAMMABLE_LAUNCH_WALLET: "0x1111111111111111111111111111111111111111",
      PROGRAMMABLE_SOURCE_REVISION: "1111111111111111111111111111111111111111",
      PROGRAMMABLE_LAUNCH_NONCE: `0x${"22".repeat(32)}`,
      PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH: "project-logo.png",
      PROGRAMMABLE_PROJECT_IMAGE_URI: "https://example.com/project-logo.png",
      PROGRAMMABLE_WEBSITE_URL: "https://example.com/",
      PROGRAMMABLE_X_URL: "https://x.com/example",
    };

    try {
      writeFileSync(fetchFixturePath, `
import { appendFileSync } from "node:fs";
import { jsonResponse, validCapabilities36 } from ${JSON.stringify(pathToFileURL(
  join(root, "packages/launch/test/fixtures/capabilities.mjs"),
).href)};
globalThis.fetch = async (url, options = {}) => {
  const request = (options.method ?? "GET") + " " + url;
  if (request !== ${JSON.stringify(capabilitiesRequest)}) {
    throw new Error("Unexpected CLI fetch: " + request);
  }
  appendFileSync(${JSON.stringify(capabilitiesRequestsPath)}, request + "\\n");
  return jsonResponse(validCapabilities36());
};
`);
      cpSync(exampleRoot, projectRoot, { recursive: true });
      mkdirSync(join(projectRoot, "release-modules"), { recursive: true });
      for (const fileName of [
        "programmable-settlement-fee-vault-v1.json",
        "programmable-settlement-fee-vault-v1.standard-json.json",
      ]) {
        cpSync(
          join(root, "packages/launch/test/fixtures", fileName),
          join(projectRoot, "release-modules", fileName),
        );
      }
      writeFileSync(
        join(projectRoot, "project-logo.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
        cwd: projectRoot,
        env: environment,
        stdio: "pipe",
      });
      execFileSync("npm", ["run", "build"], {
        cwd: projectRoot,
        env: environment,
        stdio: "pipe",
      });
      const rehearsalEvidence = JSON.parse(readFileSync(
        join(projectRoot, "evidence/rehearsal.json"),
        "utf8",
      ));
      const exampleBuildSource = readFileSync(
        join(projectRoot, "build-and-configure.mjs"),
        "utf8",
      );
      expect(rehearsalEvidence.profile).toMatchObject({
        profileId: "programmable.direct-native-hook-graph.v1",
        profileVersion: "3.3.0",
        profileRevision: 3,
        productionLaunchAuthorized: true,
      });
      expect(exampleBuildSource.match(/profileVersion: "3\.3\.0"/gu))
        .toHaveLength(2);
      expect(exampleBuildSource).not.toContain('profileVersion: "2.0.0"');
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      expect(Object.hasOwn(config, "profileVersion")).toBe(false);
      const packOutput = JSON.parse(execFileSync(process.execPath, [
        "--import",
        fetchFixturePath,
        cli,
        "pack",
        "--config",
        configPath,
        "--output",
        join(projectRoot, "launch.json"),
      ], {
        cwd: projectRoot,
        env: environment,
        encoding: "utf8",
      }));
      const validateOutput = JSON.parse(execFileSync(process.execPath, [
        "--import",
        fetchFixturePath,
        cli,
        "validate",
        join(projectRoot, "launch.json"),
        "--config",
        configPath,
      ], {
        cwd: projectRoot,
        env: environment,
        encoding: "utf8",
      }));
      const request = JSON.parse(readFileSync(join(projectRoot, "launch.json"), "utf8"));

      expect(packOutput.requestSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(packOutput.fundingIntentHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(validateOutput).toMatchObject({
        schemaVersion: "programmable.custom-launch-create-request.v3",
        productionLaunchAuthorized: true,
        reproducedFromConfig: true,
        requestSha256: packOutput.requestSha256,
      });
      expect(request).toMatchObject({
        schemaVersion: "programmable.custom-launch-create-request.v3",
        launchProfile: {
          schemaVersion: "programmable.direct-native-hook-graph-profile.v3",
          profileVersion: "3.6.0",
          profileRevision: 3,
          productionLaunchAuthorized: true,
        },
        launchProfileSelection: {
          schemaVersion:
            "programmable.direct-native-hook-graph-profile-selection-binding.v3",
          profileRevision: 3,
          fundingMode: "eip-3009-receive-with-authorization",
        },
      });
      expect(request.graphBundle.targets).toHaveLength(4);
      expect(request.launchProfileSelection.targetRoles).toMatchObject({
        platformFeeBindingTargetId: "settlement-fee-vault",
      });
      expect(request.behaviorScenarioInputs).toBeUndefined();
      expect(JSON.stringify(request)).not.toContain('"signature"');
      expect(readFileSync(capabilitiesRequestsPath, "utf8"))
        .toBe(`${capabilitiesRequest}\n`);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 180_000);

  it("keeps V1 reads live while documenting the exact non-retryable write fence", () => {
    const openApi = JSON.parse(readFileSync(
      join(root, "public/openapi/custom-launch-v1.json"),
      "utf8",
    ));
    const post = openApi.paths["/v1/custom-launches"].post;
    expect(post).toMatchObject({
      deprecated: true,
      summary: "V1 launch creation is read-only",
    });
    expect(Object.keys(post.responses)).toEqual(["401", "403", "409"]);
    expect(post.responses["409"].content["application/json"].example.error)
      .toMatchObject({ code: "CUSTOM_LAUNCH_V1_READ_ONLY" });
    expect(openApi.paths["/v1/custom-launches"].get.responses["200"])
      .toBeDefined();
    expect(openApi.paths["/v1/custom-launches/{launchId}"].get.responses["200"])
      .toBeDefined();
    expect(openApi["x-programmable-availability"]).toEqual({
      v1Reads: "live",
      v1Create: {
        status: "read-only",
        httpStatus: 409,
        errorCode: "CUSTOM_LAUNCH_V1_READ_ONLY",
        retryable: false,
      },
      v2ReleaseCandidate: {
        status: "retired-to-read-compatibility",
        release: "2.0.0",
        publicAuthorization: false,
        openApiUrl: "https://programmable.market/openapi/custom-launch-v2.json",
      },
      v2: {
        reads: "live",
        create: "read-only",
        createHttpStatus: 409,
        createErrorCode: "CUSTOM_LAUNCH_V2_READ_ONLY",
        retryable: false,
        preparedAndSimulatingReads: "observation-only",
        readMayAuthorize: false,
        authorizedAndSubmittedReconciliation: "bounded",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v2.json",
      },
      v3: {
        status: "live",
        profileId: "programmable.direct-native-hook-graph.v1",
        profileRevision: 3,
        profileVersion: "3.3.0",
        freshWritesOnly: true,
        compatibleProfileVersions: ["3.2.0", "3.1.0", "3.0.0", "2.0.0"],
        productionLaunchAuthorized: true,
        createHttpStatus: 202,
        replayHttpStatus: 200,
        retryAfter: "honor-on-429-or-503",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
      },
      legacyIntake: { registry: "closed", github: "closed" },
    });

    const compilationUnit =
      openApi.components.schemas.ExactSourceCompilationUnitV1;
    expect(compilationUnit.properties.standardJsonInputBase64.maxLength)
      .toBe(6_990_508);
    expect(compilationUnit.properties.standardJsonInputBase64.description)
      .toContain("5,242,880 bytes");

    const constants = readFileSync(
      join(root, "packages/launch/src/constants.mjs"),
      "utf8",
    );
    expect(constants).toContain("MAX_REQUEST_BYTES = 8_388_608");
    expect(constants).toContain("MAX_STANDARD_JSON_INPUT_BYTES = 5_242_880");
    expect(constants).toContain("MAX_TOTAL_STANDARD_JSON_INPUT_BYTES = 5_242_880");
    expect(constants).toContain("MAX_STANDARD_JSON_SOURCES = 2_048");
    expect(constants).toContain(
      'DIRECT_NATIVE_REQUIRED_SOLC_VERSION = "0.8.26+commit.8a97fa7a"',
    );
  });
});
