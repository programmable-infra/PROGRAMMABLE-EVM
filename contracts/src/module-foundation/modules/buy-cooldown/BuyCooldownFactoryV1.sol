// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../IFoundationModuleV1.sol";
import { BuyCooldownV1 } from "./BuyCooldownV1.sol";

contract BuyCooldownFactoryV1 is IFoundationModuleFactoryV1 {
    error OnlyBoundHost();
    error UnsupportedChain();

    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        if (msg.sender != c.host) revert OnlyBoundHost();
        if (block.chainid == 1) {
            return address(
                new BuyCooldownV1(
                    c,
                    configuration,
                    0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA,
                    0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face
                )
            );
        }
        if (block.chainid == 4663) {
            return address(
                new BuyCooldownV1(
                    c,
                    configuration,
                    0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99,
                    0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5
                )
            );
        }
        revert UnsupportedChain();
    }
}
