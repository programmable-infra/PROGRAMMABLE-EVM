// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FoundationTypesV1 as T} from "../../FoundationTypesV1.sol";
import {TaxAutomationBaseV1} from "./TaxAutomationBaseV1.sol";

contract TaxToLiquidityV1 is TaxAutomationBaseV1 {
    constructor(T.ModuleContext memory c, bytes memory configuration_, IPoolManager manager)
        TaxAutomationBaseV1(c, configuration_, manager, 1)
    {}

    function moduleId() public pure override returns (bytes32) {
        return keccak256("programmable.foundation.tax-to-liquidity.v1");
    }
}
