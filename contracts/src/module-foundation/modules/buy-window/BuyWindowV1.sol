// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";
import { BoundModuleV1 } from "../common/BoundModuleV1.sol";

/// @notice A fixed daily UTC window for buys; sells are always allowed by this module.
contract BuyWindowV1 is BoundModuleV1 {
    error BuyWindowClosed(uint256 nextOpening);

    uint8 public startHourUtc;
    uint8 public openHours;

    constructor(T.ModuleContext memory c, bytes memory configuration) BoundModuleV1(c, configuration) {
        if (configuration.length != 64) revert InvalidConfiguration();
        (startHourUtc, openHours) = abi.decode(configuration, (uint8, uint8));
        if (startHourUtc > 23 || openHours == 0 || openHours > 23) revert InvalidConfiguration();
    }

    function descriptor() external pure returns (T.Descriptor memory) {
        return T.Descriptor(
            keccak256("programmable.foundation.buy-window.v1"),
            1,
            T.BEFORE_SWAP,
            0,
            50_000,
            0,
            0,
            false,
            keccak256("programmable.foundation.buy-window")
        );
    }

    function isBuyOpen() public view returns (bool) {
        return _elapsed() < uint256(openHours) * 1 hours;
    }

    function nextBuyTime() public view returns (uint256) {
        uint256 elapsed = _elapsed();
        return elapsed < uint256(openHours) * 1 hours ? block.timestamp : block.timestamp + 1 days - elapsed;
    }

    function onBeforeSwap(T.SwapContext calldata swap) external view onlyBoundHost(swap.poolId) returns (bytes4) {
        if (swap.buy && !isBuyOpen()) revert BuyWindowClosed(nextBuyTime());
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata swap) external view onlyBoundHost(swap.poolId) returns (bytes4) {
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function _elapsed() private view returns (uint256) {
        return (block.timestamp % 1 days + 1 days - uint256(startHourUtc) * 1 hours) % 1 days;
    }
}
