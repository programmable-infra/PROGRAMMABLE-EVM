// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../IFoundationModuleV1.sol";
import { LaunchWalletCapV1 } from "./LaunchWalletCapV1.sol";

/// @notice Ethereum deployment binding for the same storage-bound wallet-cap module.
contract LaunchWalletCapEthereumFactoryV1 is IFoundationModuleFactoryV1 {
    error OnlyBoundHost();
    error InvalidInfrastructure();

    address public constant BUY_ROUTER = 0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA;
    bytes32 public constant BUY_ROUTER_CODE_HASH = 0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face;

    constructor() {
        if (block.chainid != 1 || BUY_ROUTER.codehash != BUY_ROUTER_CODE_HASH) revert InvalidInfrastructure();
    }

    function createModule(T.ModuleContext calldata context_, bytes calldata configuration) external returns (address) {
        if (msg.sender != context_.host) revert OnlyBoundHost();
        return address(new LaunchWalletCapV1(context_, configuration, BUY_ROUTER, BUY_ROUTER_CODE_HASH));
    }
}
