// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { SharedModuleBaseV1, SharedBindingsV1 } from "./SharedModuleBaseV1.sol";
import { PoolPriceWindowV1 } from "./PoolPriceWindowV1.sol";
import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";

interface ILinkedHostV1 {
    function poolManager() external view returns (IPoolManager);
    function poolKey() external view returns (PoolKey memory);
    function token() external view returns (address);
    function quote() external view returns (address);
}

/// @notice Uses an existing same-chain pool with the same quote. The reference's spot price is public game state,
/// not an oracle for extracting reserves. Buy caps are bounded; sells are never gated.
contract LinkedPoolV1 is SharedModuleBaseV1, PoolPriceWindowV1 {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    enum Kind {
        ReactivePair,
        Entangled
    }
    Kind public kind;
    bytes32 public referencePool;
    address public referenceToken;
    int24 public baselineTick;
    uint16 public baseCapBps;
    uint16 public minimumCapBps;
    uint16 public maximumCapBps;
    uint16 public unlockRiseBps;
    bool public unlocked;
    error ReferenceNotReady();
    error BuyLocked();
    error BuyLimit(uint256 allowed);
    event PermanentlyUnlocked(int24 referenceTick);

    constructor(T.ModuleContext memory c, bytes memory config, SharedBindingsV1.Bindings memory b, Kind k)
        SharedModuleBaseV1(c, config, b)
    {
        if (config.length != 160) revert InvalidConfiguration();
        address referenceHost;
        (referenceHost, baseCapBps, minimumCapBps, maximumCapBps, unlockRiseBps) =
            abi.decode(config, (address, uint16, uint16, uint16, uint16));
        if (referenceHost == c.host || referenceHost.code.length == 0) revert InvalidConfiguration();
        ILinkedHostV1 host = ILinkedHostV1(referenceHost);
        PoolKey memory key = host.poolKey();
        referenceToken = host.token();
        if (
            address(host.poolManager()) != b.manager || host.quote() != c.quote || referenceToken == c.quote
                || (Currency.unwrap(key.currency0) != referenceToken
                    && Currency.unwrap(key.currency1) != referenceToken)
                || (Currency.unwrap(key.currency0) != c.quote && Currency.unwrap(key.currency1) != c.quote)
        ) revert InvalidContext();
        referencePool = PoolId.unwrap(key.toId());
        (uint160 price, int24 tick,,) = IPoolManager(b.manager).getSlot0(key.toId());
        if (price == 0 || IPoolManager(b.manager).getLiquidity(key.toId()) == 0) revert ReferenceNotReady();
        baselineTick = tick;
        if (k == Kind.ReactivePair) {
            if (
                minimumCapBps == 0 || minimumCapBps > baseCapBps || baseCapBps > maximumCapBps || maximumCapBps > 10_000
                    || unlockRiseBps != 0
            ) revert InvalidConfiguration();
        } else if (baseCapBps != 0 || minimumCapBps != 0 || maximumCapBps != 0 || unlockRiseBps == 0) {
            revert InvalidConfiguration();
        }
        kind = k;
    }

    function descriptor() external view returns (T.Descriptor memory) {
        bytes32 id = kind == Kind.ReactivePair
            ? keccak256("programmable.foundation.reactive-pair.v1")
            : keccak256("programmable.foundation.entangled.v1");
        return T.Descriptor(id, 1, T.BEFORE_SWAP | T.AFTER_SWAP, 0, 100_000, 100_000, 0, false, id);
    }

    function currentCap() public view returns (uint256 cap) {
        (, int24 tick,,) = IPoolManager(bindings.manager).getSlot0(PoolId.wrap(referencePool));
        // Clamp log-price movement before exponentiation, so extreme reference moves cannot overflow.
        int256 move = (int256(tick) - baselineTick) * (referenceToken < _context.quote ? int256(1) : int256(-1));
        if (move > 92_108) return T.TOKEN_SUPPLY * maximumCapBps / 10_000;
        if (move < -92_108) return T.TOKEN_SUPPLY * minimumCapBps / 10_000;
        uint256 ratio = _quoteAtTick(int24(move), 1e18, true);
        uint256 bps = FullMath.mulDiv(baseCapBps, ratio, 1e18);
        if (bps < minimumCapBps) bps = minimumCapBps;
        if (bps > maximumCapBps) bps = maximumCapBps;
        return T.TOKEN_SUPPLY * bps / 10_000;
    }

    function unlockReached() public view returns (bool) {
        if (unlocked) return true;
        (, int24 tick,,) = IPoolManager(bindings.manager).getSlot0(PoolId.wrap(referencePool));
        int256 move = (int256(tick) - baselineTick) * (referenceToken < _context.quote ? int256(1) : int256(-1));
        if (move <= 0) return false;
        if (move > 92_108) return true;
        return _quoteAtTick(int24(move), 1e18, true) >= FullMath.mulDiv(1e18, 10_000 + uint256(unlockRiseBps), 10_000);
    }

    function onBeforeSwap(T.SwapContext calldata s) external onlySwap(s) returns (bytes4) {
        if (s.buy) {
            if (kind == Kind.Entangled) {
                if (!unlockReached()) revert BuyLocked();
                if (!unlocked) {
                    unlocked = true;
                    (, int24 tick,,) = IPoolManager(bindings.manager).getSlot0(PoolId.wrap(referencePool));
                    emit PermanentlyUnlocked(tick);
                }
            } else if (!s.exactInput && s.specifiedAmount > currentCap()) {
                revert BuyLimit(currentCap());
            }
        }
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata s) external view onlySwap(s) returns (bytes4) {
        if (s.buy && kind == Kind.ReactivePair) {
            int128 amount = _context.token < _context.quote ? s.coreAmount0 : s.coreAmount1;
            uint256 cap = currentCap();
            if (amount <= 0 || uint256(uint128(amount)) > cap) revert BuyLimit(cap);
        }
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function onAction(address, bytes calldata) external pure returns (bytes4) {
        revert InvalidAction();
    }
}
