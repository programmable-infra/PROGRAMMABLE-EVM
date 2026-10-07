import { validateSettlementFeeVaultGraphWithRelease, validateSettlementFeeVaultBuildWithRelease } from "./settlement-fee-vault-validation.mjs";

export const CANONICAL_SETTLEMENT_FEE_VAULT_V2 = deepFreeze({
  "schemaVersion": "programmable.canonical-settlement-fee-module.v2",
  "moduleId": "programmable:settlement-fee-vault:v2",
  "contractName": "EthereumSettlementFeeVaultV2",
  "source": {
    "path": "src/custom-fee-v2/EthereumSettlementFeeVaultV2.sol",
    "sha256": "sha256:58cf9561f5fdd51c3a158fbe9ed7c73c5bdf10dbcc7d59a5e5c074e3cd4c0320"
  },
  "compiler": {
    "version": "0.8.26+commit.8a97fa7a",
    "evmVersion": "paris",
    "optimizer": {
      "enabled": true,
      "runs": 1000
    },
    "viaIR": false,
    "metadata": {
      "bytecodeHash": "none",
      "appendCBOR": false
    },
    "remappings": [
      "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
      "@openzeppelin/uniswap-hooks/=lib/openzeppelin-uniswap-hooks/",
      "@uniswap/v4-core/=lib/v4-core/"
    ],
    "outputSelection": {
      "*": {
        "": [
          "ast"
        ],
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.immutableReferences"
        ]
      }
    },
    "standardJsonInput": {
      "byteLength": 119915,
      "sha256": "sha256:0b7c83b8e4ac01499e7967ac44ca711fa9e7192f0db5dd9ab5ee58433cbad7d0"
    }
  },
  "creationBytecode": {
    "byteLength": 7935,
    "sha256": "sha256:f494403cb004547c6a8ae27d124c0cd695b76c45b7389d8c7751fd1871de208e",
    "keccak256": "0x51a9b3fd49454a6f6f9913186e0d52e74f6028f5d5f7567035eba579731a38f2"
  },
  "runtimeBytecode": {
    "byteLength": 7751,
    "sha256": "sha256:f1b57e62b9f39f5f016882a33f90c8f404f43417542a982007bf6fd0c4a8b84c",
    "keccak256": "0x6dfc6731166326aebbe152c67fa1560c164239de00f6033b0ba8ce52047a7d98"
  },
  "releaseBindingSha256": "sha256:6aeb8f26c2251e3492dbeb6eb2daab8e6e966ee40da7647d4579cce6be978ea1"
});

export function validateCanonicalSettlementFeeVaultV2Graph(graph, targetId) {
  return validateSettlementFeeVaultGraphWithRelease(graph, targetId, CANONICAL_SETTLEMENT_FEE_VAULT_V2);
}

export function validateCanonicalSettlementFeeVaultV2Build(graph, verification, targetId) {
  return validateSettlementFeeVaultBuildWithRelease(graph, verification, targetId, CANONICAL_SETTLEMENT_FEE_VAULT_V2);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
