import { validateSettlementFeeVaultGraphWithRelease, validateSettlementFeeVaultBuildWithRelease } from "./settlement-fee-vault-validation.mjs";
import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
} from "viem";

import { parseStrictJson } from "./canonical-json.mjs";
import {
  DIRECT_NATIVE_REQUIRED_SOLC_VERSION,
  GRAPH_FACTORY,
  MAX_STANDARD_JSON_INPUT_BYTES,
} from "./constants.mjs";
import {
  decodeExactUtf8,
  sha256Digest,
} from "./io.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BIND_ROUTE_SELECTOR = "0x8ce2a828";
const SETTLEMENT_FEE_VAULT_GETTER_SELECTOR = "0x0fb5c7c9";

export const CANONICAL_SETTLEMENT_FEE_VAULT_V1 = deepFreeze({
  schemaVersion: "programmable.canonical-settlement-fee-module.v1",
  moduleId: "programmable:settlement-fee-vault:v1",
  releaseBindingSha256:
    "sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9",
  contractName: "ProgrammableSettlementFeeVaultV1",
  source: {
    path: "src/ProgrammableSettlementFeeVaultV1.sol",
    sha256:
      "sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b",
  },
  compiler: {
    version: DIRECT_NATIVE_REQUIRED_SOLC_VERSION,
    standardJsonInput: {
      byteLength: 119_921,
      sha256:
        "sha256:840f0827714818dd9cf28ce15b684eb907d58b3701d3b3a9f28d0f3be137c7d9",
    },
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 1_000 },
    viaIR: false,
    metadata: {
      useLiteralContent: false,
      bytecodeHash: "none",
      appendCBOR: false,
    },
  },
  creationBytecode: {
    byteLength: 7_935,
    sha256:
      "sha256:7b0d51612be90023839f36cf28ae56963d8146d28ff441dd2a20195d56238b81",
    keccak256:
      "0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e",
  },
  runtimeBytecode: {
    byteLength: 7_751,
    sha256:
      "sha256:980c0eec1017a7dbbd9010935107440125070a0b1fa4688bca92754e2bf1e649",
    keccak256:
      "0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554",
  },
  constructor: {
    bindingAuthority: "graphFactory",
    graphFactory: GRAPH_FACTORY,
  },
  initializer: {
    signature: "bindRoute(address)",
    selector: BIND_ROUTE_SELECTOR,
    routeArgument: "exact-reciprocal-route-target-locator",
  },
  reciprocalRoute: {
    getterSignature: "settlementFeeVault()",
    getterSelector: SETTLEMENT_FEE_VAULT_GETTER_SELECTOR,
    behaviorAuthority: "server-static-and-runtime-evidence",
  },
});

export function validateCanonicalSettlementFeeVaultV1Graph(graph, targetId) {
  return validateSettlementFeeVaultGraphWithRelease(graph, targetId, CANONICAL_SETTLEMENT_FEE_VAULT_V1);
}
export function validateCanonicalSettlementFeeVaultV1Build(graph, verification, targetId) {
  return validateSettlementFeeVaultBuildWithRelease(graph, verification, targetId, CANONICAL_SETTLEMENT_FEE_VAULT_V1);
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
