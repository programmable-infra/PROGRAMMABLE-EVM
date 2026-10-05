// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationFactoryV3NativeBase } from "./FoundationFactoryV3NativeBase.sol";
import { IFoundationUniversalRouterV2 } from "./FoundationFactoryV2.sol";
import { FoundationHookDeployerV2 } from "./FoundationHookDeployerV2.sol";

/// @notice Ethereum mainnet binding for the shared Module Mode engine.
contract FoundationFactoryV3EthereumNative is FoundationFactoryV3NativeBase {
    constructor(
        IPoolManager manager,
        IPositionManager positions,
        IFoundationUniversalRouterV2 router,
        IAllowanceTransfer permits,
        FoundationHookDeployerV2 deployer,
        bytes32[5] memory expectedCodeHashes
    )
        FoundationFactoryV3NativeBase(
            manager,
            positions,
            router,
            permits,
            deployer,
            expectedCodeHashes,
            0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
            0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23
        )
    {
        if (
            block.chainid != 1 || address(manager) != 0x000000000004444c5dc75cB358380D2e3dE08A90
                || address(positions) != 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e
                || address(router) != 0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA
                || address(permits) != 0x000000000022D473030F116dDEE9F6B43aC78BA3
        ) revert InvalidInfrastructure();
    }
}
