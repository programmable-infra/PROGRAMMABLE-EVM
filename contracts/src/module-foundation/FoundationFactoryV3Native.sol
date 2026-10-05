// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationFactoryV3NativeBase } from "./FoundationFactoryV3NativeBase.sol";
import { IFoundationUniversalRouterV2 } from "./FoundationFactoryV2.sol";
import { FoundationHookDeployerV2 } from "./FoundationHookDeployerV2.sol";

/// @notice Robinhood native funding binding. The public constructor and launch ABI are unchanged.
contract FoundationFactoryV3Native is FoundationFactoryV3NativeBase {
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
            0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73,
            0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353
        )
    { }
}
