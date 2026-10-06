// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SharedModuleBaseV1, SharedBindingsV1 } from "./SharedModuleBaseV1.sol";
import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";

/// @notice Bounded last-buyer sell pause or an existing-holder gate for this pool's buys.
/// @dev Ordinary ERC20 transfers and other pools are outside this module's authority.
contract PoolGamesV1 is SharedModuleBaseV1 {
    enum Kind {
        HotPotato,
        Plague
    }
    Kind public kind;
    uint128 public minimum;
    uint32 public pauseSeconds;
    address public lastBuyer;
    uint256 public pausedUntil;
    error BuyerPaused(uint256 until);
    error TokensRequired(uint256 minimum);
    event LastBuyerChanged(address indexed buyer, uint256 pausedUntil);

    constructor(T.ModuleContext memory c, bytes memory config, SharedBindingsV1.Bindings memory b, Kind k)
        SharedModuleBaseV1(c, config, b)
    {
        if (config.length != 64) revert InvalidConfiguration();
        (minimum, pauseSeconds) = abi.decode(config, (uint128, uint32));
        if (
            minimum == 0 || (k == Kind.HotPotato && (pauseSeconds == 0 || pauseSeconds > 1 hours))
                || (k == Kind.Plague && (pauseSeconds != 0 || minimum > T.TOKEN_SUPPLY))
        ) revert InvalidConfiguration();
        kind = k;
    }

    function descriptor() external view returns (T.Descriptor memory) {
        bytes32 id = kind == Kind.HotPotato
            ? keccak256("programmable.foundation.hot-potato.v1")
            : keccak256("programmable.foundation.plague.v1");
        return T.Descriptor(id, 1, T.BEFORE_SWAP | T.AFTER_SWAP, 0, 110_000, 110_000, 0, false, id);
    }

    function onBeforeSwap(T.SwapContext calldata s) external view onlySwap(s) returns (bytes4) {
        if (kind == Kind.HotPotato) {
            if (!s.buy && block.timestamp < pausedUntil && _actor(s.router) == lastBuyer) {
                revert BuyerPaused(pausedUntil);
            }
        } else if (s.buy) {
            address buyer = _actor(s.router);
            // Creator seeds the holder network; reviewed modules may execute the pool's fee strategy.
            if (buyer != address(0) && buyer != _context.creator && IERC20(_context.token).balanceOf(buyer) < minimum) {
                revert TokensRequired(minimum);
            }
        }
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata s) external onlySwap(s) returns (bytes4) {
        if (kind == Kind.HotPotato && s.buy && s.grossQuote >= minimum) {
            address buyer = _actor(s.router);
            if (buyer != address(0)) {
                lastBuyer = buyer;
                pausedUntil = block.timestamp + pauseSeconds;
                emit LastBuyerChanged(buyer, pausedUntil);
            }
        }
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function onAction(address, bytes calldata) external pure returns (bytes4) {
        revert InvalidAction();
    }
}
