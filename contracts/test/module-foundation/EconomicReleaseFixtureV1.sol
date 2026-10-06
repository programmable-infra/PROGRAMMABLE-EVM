// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Vm } from "forge-std/Vm.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";

/// @dev Optional, public release evidence for testing deployed factories on local forks.
library EconomicReleaseFixtureV1 {
    function _key(Vm vm, uint8 kind) private view returns (string memory) {
        return string.concat(".chains.c", vm.toString(block.chainid), ".m", vm.toString(uint256(kind)));
    }

    function factory(Vm vm, uint8 kind) internal view returns (address) {
        string memory file = vm.envOr("ECONOMIC_RELEASE_MANIFEST", string(""));
        if (bytes(file).length == 0) return address(0);
        string memory json = vm.readFile(file);
        string memory key = _key(vm, kind);
        if (vm.parseJsonBool(json, string.concat(key, ".localCandidate"))) return address(0);
        address target = vm.parseJsonAddress(json, string.concat(key, ".factory"));
        require(target.code.length > 0, "Released factory missing on fork");
        require(
            target.codehash == vm.parseJsonBytes32(json, string.concat(key, ".factoryCodeHash")),
            "Released factory runtime mismatch"
        );
        return target;
    }

    function verify(Vm vm, uint8 kind, T.ModuleSelection memory selection) internal view {
        string memory file = vm.envOr("ECONOMIC_RELEASE_MANIFEST", string(""));
        if (bytes(file).length == 0) return;
        string memory json = vm.readFile(file);
        string memory key = _key(vm, kind);
        require(
            selection.factoryCodeHash == vm.parseJsonBytes32(json, string.concat(key, ".factoryCodeHash")),
            "Factory runtime mismatch"
        );
        require(
            selection.moduleCodeHash == vm.parseJsonBytes32(json, string.concat(key, ".moduleCodeHash")),
            "Released module runtime mismatch"
        );
        require(
            selection.descriptorHash == vm.parseJsonBytes32(json, string.concat(key, ".descriptorHash")),
            "Released module descriptor mismatch"
        );
    }
}
