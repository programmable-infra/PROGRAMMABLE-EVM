// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

/// @dev Bounded time-weighted log-price history. Must observe every swap in the bound pool.
/// Stores at most one checkpoint per minute. No keeper-provided or current spot quote is trusted for minimum output.
abstract contract PoolPriceWindowV1 {
    using StateLibrary for IPoolManager;

    struct Observation {
        uint64 timestamp;
        int192 cumulative;
    }
    Observation[16] public observations;
    uint8 public observationIndex;
    uint64 public priceUpdatedAt;
    int24 public lastTick;
    int192 public tickCumulative;
    error PriceUnavailable();

    function _beforePrice(IPoolManager manager, bytes32 poolId) internal {
        (, int24 tick,,) = manager.getSlot0(PoolId.wrap(poolId));
        if (priceUpdatedAt == 0) {
            priceUpdatedAt = uint64(block.timestamp);
            lastTick = tick;
            observations[0] = Observation(uint64(block.timestamp), 0);
            return;
        }
        tickCumulative = _cumulativeNow();
        priceUpdatedAt = uint64(block.timestamp);
        if (block.timestamp - observations[observationIndex].timestamp >= 60) {
            observationIndex = uint8((uint256(observationIndex) + 1) % 16);
            observations[observationIndex] = Observation(uint64(block.timestamp), tickCumulative);
        }
    }

    function _afterPrice(IPoolManager manager, bytes32 poolId) internal {
        (, lastTick,,) = manager.getSlot0(PoolId.wrap(poolId));
    }

    function averageTick(uint32 window) public view returns (int24 tick) {
        if (priceUpdatedAt == 0 || block.timestamp < window) revert PriceUnavailable();
        uint256 target = block.timestamp - window;
        Observation memory anchor;
        for (uint256 i; i < 16; ++i) {
            Observation memory o = observations[i];
            if (o.timestamp != 0 && o.timestamp <= target && o.timestamp > anchor.timestamp) anchor = o;
        }
        if (anchor.timestamp == 0) revert PriceUnavailable();
        int256 numerator = int256(_cumulativeNow()) - anchor.cumulative;
        int256 denominator = int256(block.timestamp - anchor.timestamp);
        int256 mean = numerator / denominator;
        if (numerator < 0 && numerator % denominator != 0) --mean;
        tick = int24(mean);
    }

    function _cumulativeNow() private view returns (int192) {
        return tickCumulative + int192(int256(lastTick) * int256(block.timestamp - priceUpdatedAt));
    }

    function _quoteAtTick(int24 tick, uint128 amount, bool token0In) internal pure returns (uint256) {
        uint160 sqrt = TickMath.getSqrtPriceAtTick(tick);
        if (sqrt <= type(uint128).max) {
            uint256 ratio = uint256(sqrt) * sqrt;
            return token0In ? FullMath.mulDiv(ratio, amount, 1 << 192) : FullMath.mulDiv(1 << 192, amount, ratio);
        }
        uint256 ratio128 = FullMath.mulDiv(sqrt, sqrt, 1 << 64);
        return token0In ? FullMath.mulDiv(ratio128, amount, 1 << 128) : FullMath.mulDiv(1 << 128, amount, ratio128);
    }
}
