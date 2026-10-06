// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../IFoundationModuleV1.sol";
import { BuyWindowV1 } from "./BuyWindowV1.sol";

contract BuyWindowFactoryV1 is IFoundationModuleFactoryV1 {
    error OnlyBoundHost();

    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        if (msg.sender != c.host) revert OnlyBoundHost();
        return address(new BuyWindowV1(c, configuration));
    }
}
