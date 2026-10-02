// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {FoundationTypesV1 as T} from "../../FoundationTypesV1.sol";
import {IFoundationModuleV1} from "../../IFoundationModuleV1.sol";

interface ITaxBudgetLedgerV1 {
    function moduleCredited(address module) external view returns (uint256);
    function moduleClaimed(address module) external view returns (uint256);
    function claimModule(uint256 amount) external;
}

interface ITaxBurnTokenV1 {
    function burn(uint256 amount) external;
}

/// @notice Immutable fee-budget processing. No user balances, platform credits, arbitrary calls or withdrawals.
/// @dev A 60s default TWAP, a bounded batch and a strict fill limit isolate compounding from abnormal prices.
/// Full-range positions belong to this instance. There is no removal, transfer, sweep or fee-withdrawal function.
abstract contract TaxAutomationBaseV1 is IFoundationModuleV1, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    struct Configuration {
        uint128 minimumQuote;
        uint128 maximumQuote;
        uint16 maximumTickDeviation;
        uint32 oracleSeconds;
        uint16 liquidityBps;
    }

    struct Observation {
        uint64 time;
        int256 cumulative;
    }
    T.ModuleContext private _context;
    IPoolManager public poolManager;
    Configuration public configuration;
    bytes32 public configurationHash;
    uint128 public liquidityAdded;
    uint256 public quoteProcessed;
    uint256 public tokensBurned;
    uint256 public processCount;
    uint64 private _lastTime;
    int24 private _lastTick;
    int256 private _cumulative;
    Observation[64] private _observations;
    uint8 private _count;
    uint8 private _index;
    bool private _processing;
    bytes32 private _unlockHash;

    error InvalidConfiguration();
    error InvalidContext();
    error OnlyHost();
    error OnlyProcessor();
    error InvalidSettlement();
    error PriceGuard();
    error InvalidAction();
    event TaxProcessed(uint256 quote, uint256 burned, uint128 liquidity, uint256 count);
    event ProcessingDeferred(bytes4 reason);

    constructor(T.ModuleContext memory c, bytes memory encoded, IPoolManager manager, uint8 mode) {
        if (encoded.length != 160) revert InvalidConfiguration();
        Configuration memory cfg = abi.decode(encoded, (Configuration));
        if (
            cfg.minimumQuote == 0 || cfg.maximumQuote < cfg.minimumQuote || cfg.maximumQuote > uint128(type(int128).max)
                || cfg.maximumTickDeviation < 10 || cfg.maximumTickDeviation > 2000 || cfg.oracleSeconds < 30
                || cfg.oracleSeconds > 300 || cfg.liquidityBps > 10_000 || (mode == 0 && cfg.liquidityBps != 0)
                || (mode == 1 && cfg.liquidityBps != 10_000)
                || (mode == 2 && (cfg.liquidityBps == 0 || cfg.liquidityBps == 10_000))
        ) revert InvalidConfiguration();
        if (
            address(manager).code.length == 0 || c.host == address(0) || c.token.code.length == 0
                || c.quote.code.length == 0 || c.token == c.quote || c.creator == address(0) || c.ledger == address(0)
        ) revert InvalidContext();
        _context = c;
        poolManager = manager;
        configuration = cfg;
        configurationHash = keccak256(encoded);
        if (PoolId.unwrap(poolKey().toId()) != c.poolId) revert InvalidContext();
    }

    function moduleId() public pure virtual returns (bytes32);

    function context() external view returns (T.ModuleContext memory) {
        return _context;
    }

    function descriptor() external pure returns (T.Descriptor memory) {
        return T.Descriptor(
            moduleId(),
            1,
            T.BEFORE_SWAP | T.AFTER_SWAP | T.ACTION,
            T.OWN_QUOTE_BUDGET,
            100_000,
            650_000,
            1_500_000,
            true,
            bytes32(0)
        );
    }

    function poolKey() public view returns (PoolKey memory) {
        bool quote0 = _context.quote < _context.token;
        return PoolKey(
            Currency.wrap(quote0 ? _context.quote : _context.token),
            Currency.wrap(quote0 ? _context.token : _context.quote),
            T.LP_FEE,
            T.TICK_SPACING,
            IHooks(_context.host)
        );
    }
    modifier onlyHost(bytes32 id) {
        if (msg.sender != _context.host) revert OnlyHost();
        if (id != _context.poolId) revert InvalidContext();
        _;
    }

    function onBeforeSwap(T.SwapContext calldata s) external onlyHost(s.poolId) returns (bytes4) {
        _observe();
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata s) external onlyHost(s.poolId) returns (bytes4) {
        _observe();
        // Respect an outer router's ERC20 sync window. Its reserves must never be replaced by an internal settlement.
        if (!_processing && Currency.unwrap(poolManager.getSyncedCurrency()) == address(0)) {
            try this.process() {}
            catch (bytes memory reason) {
                bytes4 selector;
                if (reason.length >= 4) {
                    assembly ("memory-safe") { selector := mload(add(reason, 32)) }
                }
                emit ProcessingDeferred(selector);
            }
        }
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function onAction(address, bytes calldata data) external onlyHost(_context.poolId) returns (bytes4) {
        if ((data.length != 0 && (data.length != 4 || bytes4(data) != this.process.selector)) || _processing) {
            revert InvalidAction();
        }
        // Permissionless retry, with exactly the same immutable price/budget checks as automatic processing.
        this.process();
        return IFoundationModuleV1.onAction.selector;
    }

    function process() external {
        if (msg.sender != address(this) || _processing) revert OnlyProcessor();
        ITaxBudgetLedgerV1 ledger = ITaxBudgetLedgerV1(_context.ledger);
        uint256 credit = ledger.moduleCredited(address(this)) - ledger.moduleClaimed(address(this));
        uint256 held = IERC20(_context.quote).balanceOf(address(this));
        uint256 budget = credit + held;
        if (budget < configuration.minimumQuote) return;
        if (budget > configuration.maximumQuote) budget = configuration.maximumQuote;
        (bool ready, int24 average) = oracleTick();
        if (!ready) return;
        (, int24 spot,,) = poolManager.getSlot0(PoolId.wrap(_context.poolId));
        _checkTick(spot, average);
        _processing = true;
        uint256 claim = budget > held ? budget - held : 0;
        if (claim != 0) ledger.claimModule(claim);
        bytes memory data = abi.encode(budget, average);
        if (poolManager.isUnlocked()) {
            _execute(budget, average);
        } else {
            _unlockHash = keccak256(data);
            poolManager.unlock(data);
            if (_unlockHash != 0) revert InvalidSettlement();
        }
        _observe();
        _processing = false;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_processing || _unlockHash == 0 || keccak256(data) != _unlockHash) {
            revert OnlyProcessor();
        }
        _unlockHash = 0;
        (uint256 budget, int24 average) = abi.decode(data, (uint256, int24));
        _execute(budget, average);
        return bytes("");
    }

    function _execute(uint256 budget, int24 average) private {
        uint256 lpQuote = FullMath.mulDiv(budget, configuration.liquidityBps, 10_000);
        uint256 burnQuote = budget - lpQuote;
        uint256 spent = burnQuote;
        uint256 burned;
        if (burnQuote != 0) {
            burned = _buy(burnQuote, average);
            ITaxBurnTokenV1(_context.token).burn(burned);
            tokensBurned += burned;
        }
        uint128 added;
        if (lpQuote > 1) {
            _buy(lpQuote / 2, average);
            spent += lpQuote / 2;
            (uint160 price, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(_context.poolId));
            _checkTick(tick, average);
            uint256 quoteLeft = lpQuote - lpQuote / 2;
            uint256 tokens = IERC20(_context.token).balanceOf(address(this));
            int24 lower = TickMath.minUsableTick(T.TICK_SPACING);
            int24 upper = TickMath.maxUsableTick(T.TICK_SPACING);
            bool quote0 = _context.quote < _context.token;
            added = LiquidityAmounts.getLiquidityForAmounts(
                price,
                TickMath.getSqrtPriceAtTick(lower),
                TickMath.getSqrtPriceAtTick(upper),
                quote0 ? quoteLeft : tokens,
                quote0 ? tokens : quoteLeft
            );
            // Round the liquidity down by one unit so the Core's rounded-up token debts remain within the budget.
            if (added > 1) {
                added -= 1;
                (BalanceDelta delta, BalanceDelta fees) = poolManager.modifyLiquidity(
                    poolKey(), ModifyLiquidityParams(lower, upper, int256(uint256(added)), moduleId()), bytes("")
                );
                // Core realizes this position's accrued fees on addition. Separate principal from that credit.
                // Earned quote may exceed the batch debit; its surplus belongs to the next bounded batch.
                int256 principal = quote0
                    ? int256(delta.amount0()) - int256(fees.amount0())
                    : int256(delta.amount1()) - int256(fees.amount1());
                if (principal > 0 || uint256(-principal) > quoteLeft) revert InvalidSettlement();
                spent += uint256(-principal);
                _settleDelta(delta);
                liquidityAdded += added;
            } else {
                added = 0;
            }
        }
        if (
            poolManager.currencyDelta(address(this), Currency.wrap(_context.quote)) != 0
                || poolManager.currencyDelta(address(this), Currency.wrap(_context.token)) != 0
        ) revert InvalidSettlement();
        quoteProcessed += spent;
        emit TaxProcessed(spent, burned, added, ++processCount);
    }

    function _buy(uint256 amount, int24 average) private returns (uint256 received) {
        bool quote0 = _context.quote < _context.token;
        int24 limitTick = average
            + (quote0
                    ? -int24(uint24(configuration.maximumTickDeviation))
                    : int24(uint24(configuration.maximumTickDeviation)));
        if (limitTick <= TickMath.MIN_TICK || limitTick >= TickMath.MAX_TICK) revert PriceGuard();
        uint256 beforeToken = IERC20(_context.token).balanceOf(address(this));
        BalanceDelta delta = poolManager.swap(
            poolKey(), SwapParams(quote0, -int256(amount), TickMath.getSqrtPriceAtTick(limitTick)), bytes("")
        );
        int128 spent = quote0 ? delta.amount0() : delta.amount1();
        if (spent >= 0 || uint256(-int256(spent)) != amount) revert InvalidSettlement();
        _settleDelta(delta);
        received = IERC20(_context.token).balanceOf(address(this)) - beforeToken;
        if (received == 0) revert InvalidSettlement();
    }

    function _settleDelta(BalanceDelta delta) private {
        PoolKey memory key = poolKey();
        _settleCurrency(key.currency0, delta.amount0());
        _settleCurrency(key.currency1, delta.amount1());
    }

    function _settleCurrency(Currency currency, int128 delta) private {
        if (delta < 0) {
            uint256 debt = uint256(-int256(delta));
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), debt);
            if (poolManager.settle() != debt) revert InvalidSettlement();
        } else if (delta > 0) {
            poolManager.take(currency, address(this), uint256(uint128(delta)));
        }
    }

    function _checkTick(int24 spot, int24 average) private view {
        int256 difference = int256(spot) - average;
        if (difference < 0) difference = -difference;
        if (uint256(difference) >= configuration.maximumTickDeviation) revert PriceGuard();
    }

    /// @notice Time-weighted mean over the configured window, using observations from earlier timestamps.
    function oracleTick() public view returns (bool ready, int24 mean) {
        if (_count == 0 || block.timestamp < configuration.oracleSeconds) return (false, 0);
        uint64 target = uint64(block.timestamp - configuration.oracleSeconds);
        uint256 oldest = (_index + 64 + 1 - _count) % 64;
        if (_observations[oldest].time > target) return (false, 0);
        uint256 lo;
        uint256 hi = _count - 1;
        while (lo < hi) {
            uint256 middle = (lo + hi + 1) / 2;
            if (_observations[(oldest + middle) % 64].time <= target) lo = middle;
            else hi = middle - 1;
        }
        Observation memory a = _observations[(oldest + lo) % 64];
        int256 nowCumulative = _cumulative + int256(_lastTick) * int256(block.timestamp - _lastTime);
        // Use an exact cumulative observation at least one configured window old; quiet periods can extend it.
        int256 delta = nowCumulative - a.cumulative;
        int256 duration = int256(block.timestamp - a.time);
        int256 tick = delta / duration;
        if (delta < 0 && delta % duration != 0) --tick;
        mean = int24(tick);
        ready = true;
    }

    function _observe() private {
        (, int24 tick,,) = poolManager.getSlot0(PoolId.wrap(_context.poolId));
        uint64 time = uint64(block.timestamp);
        if (_count == 0) {
            _observations[0] = Observation(time, 0);
            _count = 1;
        } else {
            _cumulative += int256(_lastTick) * int256(uint256(time - _lastTime));
            if (time >= _observations[_index].time + 5) {
                _index = uint8((uint256(_index) + 1) % 64);
                _observations[_index] = Observation(time, _cumulative);
                if (_count < 64) ++_count;
            }
        }
        _lastTime = time;
        _lastTick = tick;
    }
}
