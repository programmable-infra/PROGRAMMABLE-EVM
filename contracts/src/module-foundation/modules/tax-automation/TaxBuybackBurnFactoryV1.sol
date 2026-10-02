// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FoundationTypesV1 as T} from "../../FoundationTypesV1.sol";
import {IFoundationModuleFactoryV1} from "../../IFoundationModuleV1.sol";
import {TaxBuybackBurnV1} from "./TaxBuybackBurnV1.sol";

contract TaxBuybackBurnFactoryV1 is IFoundationModuleFactoryV1 {
    IPoolManager public immutable poolManager;
    error InvalidManager();
    error OnlyBoundHost();

    constructor(IPoolManager manager) {
        if (address(manager).code.length == 0) revert InvalidManager();
        poolManager = manager;
    }

    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        if (msg.sender != c.host) revert OnlyBoundHost();
        return address(new TaxBuybackBurnV1(c, configuration, poolManager));
    }
}
