// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Proxy } from "@openzeppelin/contracts/proxy/Proxy.sol";
import { FoundationEthereumGraphLaunchV1 } from "./FoundationEthereumGraphLaunchV1.sol";

/// @notice One immutable launch account, with settlement code shared between Ethereum launches.
/// @dev There is no upgrade function or mutable implementation slot. The exact implementation
/// address and runtime hash are part of this account's CREATE2 init code and stamped runtime.
contract FoundationEthereumGraphProxyV1 is Proxy {
    address public immutable implementation;
    bytes32 public immutable implementationCodeHash;

    error InvalidImplementation();

    constructor(address target, bytes32 expectedCodeHash, address launchWallet) {
        if (
            target.code.length == 0 || target.codehash != expectedCodeHash
                || msg.sender != FoundationEthereumGraphLaunchV1(payable(target)).GRAPH_FACTORY()
        ) {
            revert InvalidImplementation();
        }
        implementation = target;
        implementationCodeHash = expectedCodeHash;
        (bool success, bytes memory result) =
            target.delegatecall(abi.encodeCall(FoundationEthereumGraphLaunchV1.initializeGraphWallet, (launchWallet)));
        if (!success) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }

    function _implementation() internal view override returns (address) {
        return implementation;
    }

    receive() external payable {
        _fallback();
    }
}
