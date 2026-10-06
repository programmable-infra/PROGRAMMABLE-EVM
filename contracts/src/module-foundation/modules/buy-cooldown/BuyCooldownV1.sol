// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";
import { BoundModuleV1 } from "../common/BoundModuleV1.sol";

interface ICooldownRouterV1 {
    function msgSender() external view returns (address);
}

interface ICooldownHostV1 {
    function initializer() external view returns (address);
}

/// @notice A minimum interval between buys by the official router's authenticated initiator.
contract BuyCooldownV1 is BoundModuleV1 {
    error UnsupportedBuyRouter();
    error InvalidBuyer();
    error InvalidTokenDelta();
    error BuyTooSoon(address wallet, uint256 nextBuyAt);

    address public buyRouter;
    bytes32 public buyRouterCodeHash;
    uint32 public cooldownSeconds;
    mapping(address wallet => uint256 timestamp) public nextBuyAt;

    constructor(T.ModuleContext memory c, bytes memory configuration, address router, bytes32 routerHash)
        BoundModuleV1(c, configuration)
    {
        if (configuration.length != 32) revert InvalidConfiguration();
        uint32 seconds_ = abi.decode(configuration, (uint32));
        if (seconds_ == 0 || seconds_ > 1 days) revert InvalidConfiguration();
        if (router == address(0) || router.code.length == 0 || router.codehash != routerHash) revert InvalidContext();
        cooldownSeconds = seconds_;
        buyRouter = router;
        buyRouterCodeHash = routerHash;
    }

    function descriptor() external pure returns (T.Descriptor memory) {
        return T.Descriptor(
            keccak256("programmable.foundation.buy-cooldown.v1"),
            1,
            T.BEFORE_SWAP | T.AFTER_SWAP,
            0,
            100_000,
            100_000,
            0,
            false,
            keccak256("programmable.foundation.buy-cooldown")
        );
    }

    function onBeforeSwap(T.SwapContext calldata swap) external view onlyBoundHost(swap.poolId) returns (bytes4) {
        if (swap.buy) _check(_buyer(swap.router));
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata swap) external onlyBoundHost(swap.poolId) returns (bytes4) {
        if (swap.buy) {
            address wallet = _buyer(swap.router);
            _check(wallet);
            if ((_context.token < _context.quote ? swap.coreAmount0 : swap.coreAmount1) <= 0) {
                revert InvalidTokenDelta();
            }
            nextBuyAt[wallet] = block.timestamp + cooldownSeconds;
        }
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function _check(address wallet) private view {
        if (block.timestamp < nextBuyAt[wallet]) revert BuyTooSoon(wallet, nextBuyAt[wallet]);
    }

    function _buyer(address router) private view returns (address wallet) {
        if (router != buyRouter || router.codehash != buyRouterCodeHash) revert UnsupportedBuyRouter();
        wallet = ICooldownRouterV1(router).msgSender();
        if (wallet == address(0)) revert InvalidBuyer();
        if (wallet == ICooldownHostV1(_context.host).initializer()) wallet = _context.creator;
    }
}
