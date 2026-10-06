// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../IFoundationModuleV1.sol";
import { PriceMoveGuardV1 } from "./PriceMoveGuardV1.sol";

contract PriceMoveGuardFactoryV1 is IFoundationModuleFactoryV1 {
    error OnlyBoundHost();
    error UnsupportedChain();

    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        if (msg.sender != c.host) revert OnlyBoundHost();
        if (block.chainid == 1) {
            return address(
                new PriceMoveGuardV1(
                    c,
                    configuration,
                    0x000000000004444c5dc75cB358380D2e3dE08A90,
                    0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293
                )
            );
        }
        if (block.chainid == 4663) {
            return address(
                new PriceMoveGuardV1(
                    c,
                    configuration,
                    0x8366a39CC670B4001A1121B8F6A443A643e40951,
                    0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626
                )
            );
        }
        revert UnsupportedChain();
    }
}
