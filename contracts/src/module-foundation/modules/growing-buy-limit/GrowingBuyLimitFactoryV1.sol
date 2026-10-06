// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../IFoundationModuleV1.sol";
import { GrowingBuyLimitV1 } from "./GrowingBuyLimitV1.sol";

/// @notice One source package for both chains, with no external address bindings.
contract GrowingBuyLimitFactoryV1 is IFoundationModuleFactoryV1 {
    error OnlyBoundHost();

    function createModule(T.ModuleContext calldata context_, bytes calldata configuration) external returns (address) {
        if (msg.sender != context_.host) revert OnlyBoundHost();
        return address(new GrowingBuyLimitV1(context_, configuration));
    }
}
