// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationNativeV3Test } from "./FoundationNativeV3.t.sol";
import { FoundationDirectionalFeesV3Test } from "./FoundationDirectionalFeesV3.t.sol";

library FoundationEthereumFixtureV3 {
    address internal constant MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSM = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant ROUTER = 0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA;

    function hashes() internal pure returns (bytes32[4] memory) {
        return [
            bytes32(0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293),
            bytes32(0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b),
            bytes32(0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face),
            bytes32(0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131)
        ];
    }
}

/// @notice The same native launch suite executes against pinned Ethereum mainnet periphery.
contract FoundationEthereumNativeV3Test is FoundationNativeV3Test {
    function _configureNetwork() internal override {
        MANAGER = FoundationEthereumFixtureV3.MANAGER;
        POSM = FoundationEthereumFixtureV3.POSM;
        ROUTER = FoundationEthereumFixtureV3.ROUTER;
        WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        expectedChainId = 1;
        expectedInfrastructureHashes = FoundationEthereumFixtureV3.hashes();
        snapshotBlock = 26_125_239;
        forkRpcEnvironment = "FOUNDATION_ETHEREUM_RPC_URL";
        forkBlockEnvironment = "FOUNDATION_ETHEREUM_FORK_BLOCK";
    }

    function _nativeFactoryArtifact() internal pure override returns (string memory) {
        return "FoundationFactoryV3EthereumNative.sol:FoundationFactoryV3EthereumNative";
    }
}

/// @notice Directional fees, module composition and trade invariants run on the same Ethereum fork.
contract FoundationEthereumDirectionalFeesV3Test is FoundationDirectionalFeesV3Test {
    function _configureNetwork() internal override {
        MANAGER = FoundationEthereumFixtureV3.MANAGER;
        POSM = FoundationEthereumFixtureV3.POSM;
        ROUTER = FoundationEthereumFixtureV3.ROUTER;
        expectedChainId = 1;
        expectedInfrastructureHashes = FoundationEthereumFixtureV3.hashes();
        snapshotBlock = 26_125_239;
        forkRpcEnvironment = "FOUNDATION_ETHEREUM_RPC_URL";
        forkBlockEnvironment = "FOUNDATION_ETHEREUM_FORK_BLOCK";
    }
}
