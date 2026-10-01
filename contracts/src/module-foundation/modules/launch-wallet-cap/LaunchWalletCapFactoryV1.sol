// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../IFoundationModuleV1.sol";
import { LaunchWalletCapV1 } from "./LaunchWalletCapV1.sol";

/// @notice Fresh optional modules bound to the source-pinned Robinhood Universal Router.
contract LaunchWalletCapFactoryV1 is IFoundationModuleFactoryV1 {
    error OnlyBoundHost();

    address public constant BUY_ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    bytes32 public constant BUY_ROUTER_CODE_HASH = 0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5;

    function createModule(T.ModuleContext calldata context_, bytes calldata configuration) external returns (address) {
        if (msg.sender != context_.host) revert OnlyBoundHost();
        return address(new LaunchWalletCapV1(context_, configuration, BUY_ROUTER, BUY_ROUTER_CODE_HASH));
    }
}
