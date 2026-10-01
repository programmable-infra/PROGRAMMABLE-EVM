// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";

interface ILaunchWalletCapRouterV1 {
    function msgSender() external view returns (address);
}

interface ILaunchWalletCapHostV1 {
    function initializer() external view returns (address);
}

/// @notice Cumulative token purchases by the authenticated router initiator during an initial launch window.
/// @dev Storage-bound settings keep the reviewed runtime identical for every launch. There are no setters.
contract LaunchWalletCapV1 is IFoundationModuleV1 {
    error InvalidConfiguration();
    error InvalidContext();
    error OnlyHost();
    error UnsupportedBuyRouter();
    error InvalidBuyer();
    error InvalidTokenDelta();
    error WalletBuyLimitExceeded(address wallet, uint256 purchased, uint256 limit);
    error NoActions();

    T.ModuleContext private _context;
    bytes32 public configurationHash;
    address public buyRouter;
    bytes32 public buyRouterCodeHash;
    uint16 public supplyLimitBps;
    uint32 public durationMinutes;
    uint256 public protectionEndsAt;
    uint256 public walletTokenLimit;
    mapping(address wallet => uint256 amount) public purchasedTokens;

    constructor(T.ModuleContext memory context_, bytes memory configuration, address router, bytes32 routerCodeHash) {
        if (configuration.length != 64) revert InvalidConfiguration();
        (uint16 limitBps, uint32 minutes_) = abi.decode(configuration, (uint16, uint32));
        if (limitBps == 0 || limitBps > 10_000 || minutes_ == 0) revert InvalidConfiguration();
        if (
            context_.host == address(0) || context_.token == address(0) || context_.quote == address(0)
                || context_.token == context_.quote || context_.creator == address(0) || context_.ledger == address(0)
                || context_.poolId == bytes32(0) || router == address(0) || routerCodeHash == bytes32(0)
        ) revert InvalidContext();
        _context = context_;
        configurationHash = keccak256(configuration);
        buyRouter = router;
        buyRouterCodeHash = routerCodeHash;
        supplyLimitBps = limitBps;
        durationMinutes = minutes_;
        protectionEndsAt = block.timestamp + uint256(minutes_) * 60;
        walletTokenLimit = T.TOKEN_SUPPLY * limitBps / 10_000;
    }

    function context() external view returns (T.ModuleContext memory) {
        return _context;
    }

    function descriptor() external pure returns (T.Descriptor memory) {
        return T.Descriptor({
            moduleId: keccak256("programmable.foundation.launch-wallet-cap.v1"),
            abiVersion: 1,
            phases: T.BEFORE_SWAP | T.AFTER_SWAP,
            resources: 0,
            beforeGas: 100_000,
            afterGas: 100_000,
            actionGas: 0,
            failOpenAfter: false,
            exclusiveGroup: keccak256("programmable.foundation.launch-wallet-cap")
        });
    }

    modifier onlyBoundHost(bytes32 poolId) {
        if (msg.sender != _context.host) revert OnlyHost();
        if (poolId != _context.poolId) revert InvalidContext();
        _;
    }

    function onBeforeSwap(T.SwapContext calldata swap) external view onlyBoundHost(swap.poolId) returns (bytes4) {
        if (swap.buy && block.timestamp < protectionEndsAt) {
            address wallet = _buyer(swap.router);
            // Exact-output buys declare the token amount. Exact-input buys are checked against the actual output below.
            if (!swap.exactInput) _checkLimit(wallet, swap.specifiedAmount);
        }
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata swap) external onlyBoundHost(swap.poolId) returns (bytes4) {
        if (swap.buy && block.timestamp < protectionEndsAt) {
            address wallet = _buyer(swap.router);
            int128 tokenDelta = _context.token < _context.quote ? swap.coreAmount0 : swap.coreAmount1;
            if (tokenDelta <= 0) revert InvalidTokenDelta();
            uint256 bought = uint256(uint128(tokenDelta));
            _checkLimit(wallet, bought);
            purchasedTokens[wallet] += bought;
        }
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function onAction(address, bytes calldata) external pure returns (bytes4) {
        revert NoActions();
    }

    function _checkLimit(address wallet, uint256 bought) private view {
        uint256 purchased = purchasedTokens[wallet];
        if (bought > walletTokenLimit - purchased) {
            revert WalletBuyLimitExceeded(wallet, purchased + bought, walletTokenLimit);
        }
    }

    function _buyer(address router) private view returns (address wallet) {
        // A router-supplied address or tx.origin would permit spoofing or break smart contract wallets.
        if (router != buyRouter || router.codehash != buyRouterCodeHash) revert UnsupportedBuyRouter();
        wallet = ILaunchWalletCapRouterV1(router).msgSender();
        if (wallet == address(0)) revert InvalidBuyer();
        // The atomic launch's first buy is initiated by the Foundation factory for the bound creator.
        if (wallet == ILaunchWalletCapHostV1(_context.host).initializer()) wallet = _context.creator;
    }
}
