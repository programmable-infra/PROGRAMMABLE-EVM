// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";

/// @notice Shared storage-bound context for optional modules without management actions.
abstract contract BoundModuleV1 is IFoundationModuleV1 {
    error InvalidContext();
    error InvalidConfiguration();
    error OnlyHost();
    error NoActions();

    T.ModuleContext internal _context;
    bytes32 public configurationHash;

    constructor(T.ModuleContext memory c, bytes memory configuration) {
        if (
            c.host == address(0) || c.token == address(0) || c.quote == address(0) || c.token == c.quote
                || c.creator == address(0) || c.ledger == address(0) || c.poolId == bytes32(0)
        ) {
            revert InvalidContext();
        }
        _context = c;
        configurationHash = keccak256(configuration);
    }

    function context() external view returns (T.ModuleContext memory) {
        return _context;
    }

    modifier onlyBoundHost(bytes32 poolId) {
        if (msg.sender != _context.host) revert OnlyHost();
        if (poolId != _context.poolId) revert InvalidContext();
        _;
    }

    function onAction(address, bytes calldata) external pure returns (bytes4) {
        revert NoActions();
    }
}
