// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";
import { SharedModuleBaseV1, SharedBindingsV1, ISharedLedgerV1, ISharedRouterV1 } from "./SharedModuleBaseV1.sol";
import { PoolPriceWindowV1 } from "./PoolPriceWindowV1.sol";

interface IStrategyBurnableV1 {
    function burn(uint256 amount) external;
}

/// @notice Uses only this module's assigned creator-fee budget. No arbitrary route, recipient or caller quote.
/// @dev Executes between swaps through host.executeModuleAction; can be called by any funded executor.
contract FeeStrategyV1 is SharedModuleBaseV1, PoolPriceWindowV1, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    enum Kind {
        BuybackBurn,
        DipBuyback,
        LPRewards,
        FullRangeLP
    }
    Kind public kind;
    uint128 public minimumBudget;
    uint128 public maximumBatch;
    uint32 public intervalSeconds;
    uint32 public priceWindowSeconds;
    uint16 public slippageBps;
    uint16 public dipBps;
    uint256 public nextExecutionAt;
    uint256 public totalQuoteUsed;
    uint256 public totalBurned;
    uint128 public lockedLiquidity;
    uint256 public quoteInventory;
    uint256 public tokenInventory;
    bool private _executing;
    bytes32 private _unlockHash;
    bytes4 public constant EXECUTE = bytes4(keccak256("execute()"));
    bytes32 public constant POSITION_SALT = keccak256("programmable.permanent.full-range.v1");
    error NotReady();
    error UnsafePrice();
    error NoLiquidity();
    event StrategyExecuted(uint256 quoteUsed, uint256 tokensBurned, uint128 liquidityAdded);

    constructor(T.ModuleContext memory c, bytes memory config, SharedBindingsV1.Bindings memory b, Kind k)
        SharedModuleBaseV1(c, config, b)
    {
        if (config.length != 192) revert InvalidConfiguration();
        (minimumBudget, maximumBatch, intervalSeconds, priceWindowSeconds, slippageBps, dipBps) =
            abi.decode(config, (uint128, uint128, uint32, uint32, uint16, uint16));
        if (
            minimumBudget == 0 || maximumBatch < minimumBudget || maximumBatch > uint128(type(int128).max)
                || intervalSeconds < 30 || intervalSeconds > 7 days || priceWindowSeconds < 300
                || priceWindowSeconds > 600 || slippageBps == 0 || slippageBps > 1000 || dipBps > 5000
                || (k == Kind.DipBuyback ? dipBps == 0 : dipBps != 0)
        ) revert InvalidConfiguration();
        kind = k;
    }

    function descriptor() external view returns (T.Descriptor memory) {
        bytes32 id = kind == Kind.BuybackBurn
            ? keccak256("programmable.foundation.buyback-burn.v1")
            : kind == Kind.DipBuyback
                ? keccak256("programmable.foundation.dip-buyback.v1")
                : kind == Kind.LPRewards
                    ? keccak256("programmable.foundation.lp-rewards.v1")
                    : keccak256("programmable.foundation.full-range-lp.v1");
        return T.Descriptor({
            moduleId: id,
            abiVersion: 1,
            phases: T.BEFORE_SWAP | T.AFTER_SWAP | T.ACTION,
            resources: T.OWN_QUOTE_BUDGET,
            beforeGas: 100_000,
            afterGas: 40_000,
            actionGas: 2_000_000,
            failOpenAfter: false,
            exclusiveGroup: id
        });
    }

    function poolKey() public view returns (PoolKey memory key) {
        bool q0 = _context.quote < _context.token;
        key = PoolKey(
            Currency.wrap(q0 ? _context.quote : _context.token),
            Currency.wrap(q0 ? _context.token : _context.quote),
            T.LP_FEE,
            T.TICK_SPACING,
            IHooks(_context.host)
        );
        if (PoolId.unwrap(key.toId()) != _context.poolId) revert InvalidContext();
    }

    function onBeforeSwap(T.SwapContext calldata s) external onlySwap(s) returns (bytes4) {
        _beforePrice(IPoolManager(bindings.manager), _context.poolId);
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata s) external onlySwap(s) returns (bytes4) {
        _afterPrice(IPoolManager(bindings.manager), _context.poolId);
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function executableBudget() public view returns (uint256 amount) {
        if (block.timestamp < nextExecutionAt || _executing) return 0;
        amount = _available();
        if (amount < minimumBudget) return 0;
        if (amount > maximumBatch) amount = maximumBatch;
    }

    function onAction(address, bytes calldata data) external onlyHost returns (bytes4) {
        if (data.length != 4 || bytes4(data) != EXECUTE) revert InvalidAction();
        uint256 amount = executableBudget();
        if (amount == 0) revert NotReady();
        IPoolManager manager = IPoolManager(bindings.manager);
        if (manager.getLiquidity(PoolId.wrap(_context.poolId)) == 0) revert NoLiquidity();
        uint256 minimumOutput;
        if (kind != Kind.LPRewards) {
            int24 mean = averageTick(priceWindowSeconds);
            (, int24 spot,,) = manager.getSlot0(PoolId.wrap(_context.poolId));
            if (kind == Kind.DipBuyback) {
                // Quote value of one reference unit must have fallen relative to the time-weighted price.
                uint256 referencePrice = _quoteAtTick(mean, 1e18, _context.token < _context.quote);
                uint256 current = _quoteAtTick(spot, 1e18, _context.token < _context.quote);
                if (referencePrice == 0 || current > FullMath.mulDiv(referencePrice, 10_000 - dipBps, 10_000)) {
                    revert NotReady();
                }
            }
            uint128 input = uint128(kind == Kind.FullRangeLP ? amount / 2 : amount);
            if (input == 0) revert NotReady();
            uint256 expected = _quoteAtTick(mean, input, _context.quote < _context.token);
            // V3 has directional fees; the live Robinhood V2 factory creates V1 hosts
            // with one symmetric fee. Read the actual rate on either host version.
            (bool ok, bytes memory feeData) = _context.host.staticcall(abi.encodeWithSignature("creatorBuyFeeBps()"));
            if (!ok || feeData.length == 0) {
                (ok, feeData) = _context.host.staticcall(abi.encodeWithSignature("creatorFeeBps()"));
            }
            if (!ok || feeData.length != 32) revert InvalidContext();
            uint256 fee = abi.decode(feeData, (uint256));
            if (fee > 1000) revert InvalidContext();
            minimumOutput = FullMath.mulDiv(expected, 10_000 - fee - T.PLATFORM_BPS, 10_000);
            minimumOutput = FullMath.mulDiv(minimumOutput, 10_000 - slippageBps, 10_000);
            if (minimumOutput == 0 || minimumOutput > type(uint128).max) revert UnsafePrice();
            if (kind == Kind.FullRangeLP) {
                // LP deposits must also reject favourable-but-manipulated spot deviations on the opposite side.
                uint256 currentOutput = _quoteAtTick(spot, input, _context.quote < _context.token);
                if (
                    currentOutput > FullMath.mulDiv(expected, 10_000 + slippageBps, 10_000)
                        || currentOutput < FullMath.mulDiv(expected, 10_000 - slippageBps, 10_000)
                ) revert UnsafePrice();
            }
        }
        _executing = true;
        nextExecutionAt = block.timestamp + intervalSeconds;
        ISharedLedgerV1(_context.ledger).claimModule(amount);
        uint256 burned;
        uint128 added;
        if (kind == Kind.LPRewards) {
            _unlock(abi.encode(uint8(0), amount));
        } else {
            uint256 bought = _buy(uint128(kind == Kind.FullRangeLP ? amount / 2 : amount), uint128(minimumOutput));
            if (kind == Kind.FullRangeLP) {
                quoteInventory += amount - amount / 2;
                tokenInventory += bought;
                uint128 beforeLiquidity = lockedLiquidity;
                _unlock(abi.encode(uint8(1), uint256(0)));
                added = lockedLiquidity - beforeLiquidity;
            } else {
                uint256 beforeSupply = IERC20(_context.token).totalSupply();
                IStrategyBurnableV1(_context.token).burn(bought);
                if (IERC20(_context.token).totalSupply() != beforeSupply - bought) revert InvalidTransfer();
                burned = bought;
                totalBurned += bought;
            }
        }
        totalQuoteUsed += amount;
        _executing = false;
        emit StrategyExecuted(amount, burned, added);
        return IFoundationModuleV1.onAction.selector;
    }

    function _buy(uint128 amount, uint128 minimum) private returns (uint256 bought) {
        IERC20 quote = IERC20(_context.quote);
        uint256 beforeQuote = quote.balanceOf(address(this));
        uint256 beforeToken = IERC20(_context.token).balanceOf(address(this));
        quote.forceApprove(bindings.permit2, amount);
        IAllowanceTransfer(bindings.permit2).approve(_context.quote, bindings.router, amount, uint48(block.timestamp));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams(poolKey(), _context.quote < _context.token, amount, minimum, 0, bytes(""))
        );
        params[1] = abi.encode(Currency.wrap(_context.quote), uint256(amount));
        params[2] = abi.encode(Currency.wrap(_context.token), uint256(minimum));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)),
            params
        );
        ISharedRouterV1(bindings.router).execute(hex"10", inputs, block.timestamp);
        IAllowanceTransfer(bindings.permit2).approve(_context.quote, bindings.router, 0, 0);
        quote.forceApprove(bindings.permit2, 0);
        bought = IERC20(_context.token).balanceOf(address(this)) - beforeToken;
        if (bought < minimum || quote.balanceOf(address(this)) != beforeQuote - amount) revert InvalidTransfer();
    }

    function _unlock(bytes memory data) private {
        _unlockHash = keccak256(data);
        IPoolManager(bindings.manager).unlock(data);
        if (_unlockHash != 0) revert InvalidContext();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != bindings.manager || !_executing || _unlockHash == 0 || _unlockHash != keccak256(data)) {
            revert InvalidContext();
        }
        _unlockHash = 0;
        (uint8 operation, uint256 amount) = abi.decode(data, (uint8, uint256));
        IPoolManager manager = IPoolManager(bindings.manager);
        PoolKey memory key = poolKey();
        BalanceDelta delta;
        if (operation == 0) {
            delta = manager.donate(
                key, _context.quote < _context.token ? amount : 0, _context.quote < _context.token ? 0 : amount, ""
            );
        } else {
            (uint160 price,,,) = manager.getSlot0(PoolId.wrap(_context.poolId));
            int24 low = TickMath.minUsableTick(T.TICK_SPACING);
            int24 high = TickMath.maxUsableTick(T.TICK_SPACING);
            uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
                price,
                TickMath.getSqrtPriceAtTick(low),
                TickMath.getSqrtPriceAtTick(high),
                _context.quote < _context.token ? quoteInventory : tokenInventory,
                _context.quote < _context.token ? tokenInventory : quoteInventory
            );
            if (liquidity == 0) revert NoLiquidity();
            (delta,) = manager.modifyLiquidity(
                key, ModifyLiquidityParams(low, high, int256(uint256(liquidity)), POSITION_SALT), ""
            );
            lockedLiquidity += liquidity;
            quoteInventory =
                _remaining(quoteInventory, _context.quote < _context.token ? delta.amount0() : delta.amount1());
            tokenInventory =
                _remaining(tokenInventory, _context.quote < _context.token ? delta.amount1() : delta.amount0());
        }
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return "";
    }

    function _settle(Currency currency, int128 delta) private {
        IPoolManager manager = IPoolManager(bindings.manager);
        if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            manager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(bindings.manager, amount);
            if (manager.settle() != amount) revert InvalidTransfer();
        } else if (delta > 0) {
            manager.take(currency, address(this), uint128(delta));
        }
    }

    function _remaining(uint256 inventory, int128 delta) private pure returns (uint256) {
        return delta < 0 ? inventory - uint256(-int256(delta)) : inventory + uint128(delta);
    }
}
