// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FoundationTypesV1 as T} from "../../FoundationTypesV1.sol";
import {IFoundationModuleFactoryV1} from "../../IFoundationModuleV1.sol";
import {TaxLiquidityBurnV1} from "./TaxLiquidityBurnV1.sol";

contract TaxLiquidityBurnFactoryV1 is IFoundationModuleFactoryV1 {
    IPoolManager public immutable poolManager;
    error InvalidManager();
    error OnlyBoundHost();

    constructor(IPoolManager manager) {
        if (address(manager).code.length == 0) revert InvalidManager();
        poolManager = manager;
    }

    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        if (msg.sender != c.host) revert OnlyBoundHost();
        return address(new TaxLiquidityBurnV1(c, configuration, poolManager));
    }
}
