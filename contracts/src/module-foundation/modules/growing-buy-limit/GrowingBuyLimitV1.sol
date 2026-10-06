// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";

/// @notice A per-swap token purchase limit that grows linearly from launch time.
/// @dev Uses actual token output, not quote price, decimals, router identity or block count.
contract GrowingBuyLimitV1 is IFoundationModuleV1 {
    error InvalidConfiguration();
    error InvalidContext();
    error OnlyHost();
    error InvalidTokenDelta();
    error BuyLimitExceeded(uint256 requested, uint256 limit);
    error NoActions();

    T.ModuleContext private _context;
    bytes32 public configurationHash;
    uint256 public startsAt;
    uint256 public initialTokenLimit;
    uint256 public finalTokenLimit;
    uint32 public durationSeconds;

    constructor(T.ModuleContext memory context_, bytes memory configuration) {
        if (configuration.length != 96) revert InvalidConfiguration();
        (uint16 initialBps, uint16 finalBps, uint32 seconds_) = abi.decode(configuration, (uint16, uint16, uint32));
        if (initialBps == 0 || finalBps < initialBps || finalBps > 10_000 || seconds_ == 0) {
            revert InvalidConfiguration();
        }
        if (
            context_.host == address(0) || context_.token == address(0) || context_.quote == address(0)
                || context_.token == context_.quote || context_.creator == address(0) || context_.ledger == address(0)
                || context_.poolId == bytes32(0)
        ) revert InvalidContext();
        _context = context_;
        configurationHash = keccak256(configuration);
        startsAt = block.timestamp;
        initialTokenLimit = T.TOKEN_SUPPLY * initialBps / 10_000;
        finalTokenLimit = T.TOKEN_SUPPLY * finalBps / 10_000;
        durationSeconds = seconds_;
    }

    function context() external view returns (T.ModuleContext memory) {
        return _context;
    }

    function descriptor() external pure returns (T.Descriptor memory) {
        return T.Descriptor({
            moduleId: keccak256("programmable.foundation.growing-buy-limit.v1"),
            abiVersion: 1,
            phases: T.BEFORE_SWAP | T.AFTER_SWAP,
            resources: 0,
            beforeGas: 50_000,
            afterGas: 50_000,
            actionGas: 0,
            failOpenAfter: false,
            exclusiveGroup: keccak256("programmable.foundation.growing-buy-limit")
        });
    }

    function currentTokenLimit() public view returns (uint256) {
        uint256 elapsed = block.timestamp - startsAt;
        if (elapsed >= durationSeconds) return finalTokenLimit;
        return initialTokenLimit + (finalTokenLimit - initialTokenLimit) * elapsed / durationSeconds;
    }

    modifier onlyBoundHost(bytes32 poolId) {
        if (msg.sender != _context.host) revert OnlyHost();
        if (poolId != _context.poolId) revert InvalidContext();
        _;
    }

    function onBeforeSwap(T.SwapContext calldata swap) external view onlyBoundHost(swap.poolId) returns (bytes4) {
        if (swap.buy && !swap.exactInput) _check(swap.specifiedAmount);
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata swap) external view onlyBoundHost(swap.poolId) returns (bytes4) {
        if (swap.buy) {
            int128 delta = _context.token < _context.quote ? swap.coreAmount0 : swap.coreAmount1;
            if (delta <= 0) revert InvalidTokenDelta();
            _check(uint256(uint128(delta)));
        }
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function onAction(address, bytes calldata) external pure returns (bytes4) {
        revert NoActions();
    }

    function _check(uint256 amount) private view {
        uint256 limit = currentTokenLimit();
        if (amount > limit) revert BuyLimitExceeded(amount, limit);
    }
}
