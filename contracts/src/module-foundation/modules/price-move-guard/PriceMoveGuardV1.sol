// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";
import { BoundModuleV1 } from "../common/BoundModuleV1.sol";

interface IGuardPoolManagerV1 {
    function extsload(bytes32 slot) external view returns (bytes32);
}

/// @notice Caps a single swap's change in the pool's quote-per-token spot price.
/// @dev No oracle, trigger price or cumulative price floor. Smaller consecutive swaps remain possible.
contract PriceMoveGuardV1 is BoundModuleV1 {
    error InvalidSwapSequence();
    error InvalidPoolPrice();
    error PriceMoveExceeded(uint160 beforeSqrtPriceX96, uint160 afterSqrtPriceX96);

    address public poolManager;
    uint16 public maxMoveBps;
    uint160 private _beforeSqrtPriceX96;

    constructor(T.ModuleContext memory c, bytes memory configuration, address manager, bytes32 managerHash)
        BoundModuleV1(c, configuration)
    {
        if (configuration.length != 32) revert InvalidConfiguration();
        maxMoveBps = abi.decode(configuration, (uint16));
        if (maxMoveBps == 0 || maxMoveBps > 5000) revert InvalidConfiguration();
        if (manager == address(0) || manager.code.length == 0 || manager.codehash != managerHash) {
            revert InvalidContext();
        }
        poolManager = manager;
    }

    function descriptor() external pure returns (T.Descriptor memory) {
        return T.Descriptor(
            keccak256("programmable.foundation.price-move-guard.v1"),
            1,
            T.BEFORE_SWAP | T.AFTER_SWAP,
            0,
            100_000,
            100_000,
            0,
            false,
            keccak256("programmable.foundation.price-move-guard")
        );
    }

    function onBeforeSwap(T.SwapContext calldata swap) external onlyBoundHost(swap.poolId) returns (bytes4) {
        if (_beforeSqrtPriceX96 != 0) revert InvalidSwapSequence();
        _beforeSqrtPriceX96 = _readPrice();
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata swap) external onlyBoundHost(swap.poolId) returns (bytes4) {
        uint160 beforePrice = _beforeSqrtPriceX96;
        if (beforePrice == 0) revert InvalidSwapSequence();
        uint160 afterPrice = _readPrice();
        if (!priceMoveAllowed(beforePrice, afterPrice)) revert PriceMoveExceeded(beforePrice, afterPrice);
        delete _beforeSqrtPriceX96;
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function priceMoveAllowed(uint160 beforePrice, uint160 afterPrice) public view returns (bool) {
        if (beforePrice == 0 || afterPrice == 0) return false;
        uint256 numerator = _context.token < _context.quote ? afterPrice : beforePrice;
        uint256 denominator = _context.token < _context.quote ? beforePrice : afterPrice;
        // A sqrt-price ratio above 2 exceeds every permitted increase (at most 50%).
        if (numerator > denominator * 2) return false;
        // uint160 * 1e18 fits uint256. Round toward the forbidden side of each boundary.
        bool increasing = numerator >= denominator;
        uint256 ratio = (numerator * 1e18 + (increasing ? denominator - 1 : 0)) / denominator;
        uint256 square = ratio * ratio;
        return increasing
            ? square * 10_000 <= 1e36 * (10_000 + uint256(maxMoveBps))
            : square * 10_000 >= 1e36 * (10_000 - uint256(maxMoveBps));
    }

    function _readPrice() private view returns (uint160 price) {
        // Uniswap V4 StateLibrary.getSlot0: pools mapping at slot 6, sqrt price in the low 160 bits.
        // Factories pin the exact manager runtime supporting this layout on each chain.
        bytes32 slot = keccak256(abi.encode(_context.poolId, uint256(6)));
        price = uint160(uint256(IGuardPoolManagerV1(poolManager).extsload(slot)));
        if (price == 0) revert InvalidPoolPrice();
    }
}
