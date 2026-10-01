// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../../src/module-foundation/FoundationTypesV1.sol";
import { LaunchWalletCapV1 } from "../../../src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapV1.sol";
import {
    LaunchWalletCapFactoryV1
} from "../../../src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapFactoryV1.sol";

interface WalletCapVm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata reason) external;
    function etch(address target, bytes calldata code) external;
}

/// @dev Models the official router's locked initiator; the module must additionally pin its address and runtime.
contract WalletCapRouterFixture {
    address private initiator;

    function msgSender() external view returns (address) {
        return initiator;
    }

    function execute(WalletCapHostFixture host, uint256 amount, bool buy, bool exactInput) external {
        require(initiator == address(0));
        initiator = msg.sender;
        host.swap(amount, buy, exactInput);
        initiator = address(0);
    }
}

contract WalletCapHostFixture {
    address public constant initializer = address(0xFA);
    address public constant creator = address(0xC0);
    bytes32 public constant poolId = keccak256("wallet-cap-pool");
    LaunchWalletCapV1 public module;
    uint256 public settledTrades;
    uint256 public accruedQuoteFees;
    bool private tokenIsZero;

    function moduleContext(bool tokenZero) public view returns (T.ModuleContext memory) {
        return T.ModuleContext({
            host: address(this),
            token: tokenZero ? address(0x10) : address(0x20),
            quote: tokenZero ? address(0x20) : address(0x10),
            creator: creator,
            ledger: address(0x30),
            poolId: poolId
        });
    }

    function configure(address router, bytes32 routerHash, uint16 limitBps, uint32 minutes_, bool tokenZero) external {
        require(address(module) == address(0));
        tokenIsZero = tokenZero;
        module = new LaunchWalletCapV1(moduleContext(tokenZero), abi.encode(limitBps, minutes_), router, routerHash);
    }

    function createFromFactory(LaunchWalletCapFactoryV1 factory, bytes memory configuration)
        external
        returns (address)
    {
        return factory.createModule(moduleContext(true), configuration);
    }

    function swap(uint256 amount, bool buy, bool exactInput) external {
        T.SwapContext memory c = T.SwapContext({
            poolId: poolId,
            router: msg.sender,
            buy: buy,
            exactInput: exactInput,
            specifiedAmount: exactInput ? 1 : amount,
            grossQuote: 0,
            coreAmount0: 0,
            coreAmount1: 0
        });
        if (address(module) != address(0)) module.onBeforeSwap{ gas: 100_000 }(c);
        ++settledTrades;
        ++accruedQuoteFees;
        c.grossQuote = 1;
        int128 tokenDelta = buy ? int128(int256(amount)) : -int128(int256(amount));
        int128 quoteDelta = buy ? int128(-1) : int128(1);
        c.coreAmount0 = tokenIsZero ? tokenDelta : quoteDelta;
        c.coreAmount1 = tokenIsZero ? quoteDelta : tokenDelta;
        if (address(module) != address(0)) module.onAfterSwap{ gas: 100_000 }(c);
    }
}

contract LaunchWalletCapV1Test {
    WalletCapVm private constant vm = WalletCapVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA1);
    address private constant BOB = address(0xB0);
    WalletCapRouterFixture private router;
    WalletCapHostFixture private host;
    LaunchWalletCapV1 private module;
    uint256 private constant CAP = T.TOKEN_SUPPLY * 2 / 100;

    function setUp() public {
        vm.warp(1000);
        router = new WalletCapRouterFixture();
        host = new WalletCapHostFixture();
        host.configure(address(router), address(router).codehash, 200, 3, true);
        module = host.module();
    }

    function _trade(address wallet, uint256 amount, bool buy, bool exactInput) private {
        vm.prank(wallet);
        router.execute(host, amount, buy, exactInput);
    }

    function testCumulativeBuysExactBoundaryAndWholeTradeRollback() public {
        _trade(ALICE, CAP / 3, true, true);
        _trade(ALICE, CAP - CAP / 3, true, false);
        require(module.purchasedTokens(ALICE) == CAP);
        vm.expectRevert(abi.encodeWithSelector(LaunchWalletCapV1.WalletBuyLimitExceeded.selector, ALICE, CAP + 1, CAP));
        _trade(ALICE, 1, true, true);
        require(host.settledTrades() == 2 && host.accruedQuoteFees() == 2);
        require(module.purchasedTokens(ALICE) == CAP && router.msgSender() == address(0));
    }

    function testWalletIsolationAndSellsDoNotRestoreAllowance() public {
        _trade(ALICE, CAP, true, true);
        _trade(ALICE, CAP, false, false);
        _trade(BOB, CAP, true, false);
        require(module.purchasedTokens(ALICE) == CAP && module.purchasedTokens(BOB) == CAP);
        vm.expectRevert(abi.encodeWithSelector(LaunchWalletCapV1.WalletBuyLimitExceeded.selector, ALICE, CAP + 1, CAP));
        _trade(ALICE, 1, true, false);
    }

    function testCreatorFirstBuyCountsAndSmartWalletIsInitiator() public {
        address creator = host.creator();
        _trade(host.initializer(), CAP, true, true);
        require(module.purchasedTokens(creator) == CAP);
        require(module.purchasedTokens(host.initializer()) == 0);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchWalletCapV1.WalletBuyLimitExceeded.selector, creator, CAP + 1, CAP)
        );
        _trade(creator, 1, true, true);
        WalletCapHostFixture smartWallet = new WalletCapHostFixture();
        _trade(address(smartWallet), CAP, true, true);
        require(module.purchasedTokens(address(smartWallet)) == CAP);
    }

    function testDifferentSettingsTokenOrderingAndAutomaticExpiry() public {
        WalletCapHostFixture other = new WalletCapHostFixture();
        other.configure(address(router), address(router).codehash, 725, 11, false);
        LaunchWalletCapV1 configured = other.module();
        uint256 limit = T.TOKEN_SUPPLY * 725 / 10_000;
        require(configured.walletTokenLimit() == limit && configured.protectionEndsAt() == 1660);
        vm.prank(ALICE);
        router.execute(other, limit, true, false);
        require(configured.purchasedTokens(ALICE) == limit);
        vm.warp(1659);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchWalletCapV1.WalletBuyLimitExceeded.selector, ALICE, limit + 1, limit)
        );
        vm.prank(ALICE);
        router.execute(other, 1, true, true);
        vm.warp(1660);
        other.swap(T.TOKEN_SUPPLY, true, true); // Unrecognized route becomes usable at the exact expiry.
        require(configured.purchasedTokens(ALICE) == limit && other.settledTrades() == 2);
    }

    function testUnknownRouterAndCodeDriftCannotBypassWindow() public {
        WalletCapRouterFixture forged = new WalletCapRouterFixture();
        vm.expectRevert(LaunchWalletCapV1.UnsupportedBuyRouter.selector);
        forged.execute(host, 1, true, true);
        forged.execute(host, 1, false, true); // Sells do not require a recognized buy route.
        vm.etch(address(router), hex"00");
        vm.expectRevert(LaunchWalletCapV1.UnsupportedBuyRouter.selector);
        vm.prank(address(router));
        host.swap(1, true, true);
        vm.warp(module.protectionEndsAt());
        host.swap(T.TOKEN_SUPPLY, true, true);
        require(host.settledTrades() == 2);
    }

    function testUnselectedModuleLeavesBuysUnrestricted() public {
        WalletCapHostFixture unrestricted = new WalletCapHostFixture();
        unrestricted.swap(T.TOKEN_SUPPLY, true, true);
        unrestricted.swap(T.TOKEN_SUPPLY, true, false);
        require(unrestricted.settledTrades() == 2 && address(unrestricted.module()) == address(0));
    }

    function testConfigurationAndCallbackAuthority() public {
        T.ModuleContext memory c = host.moduleContext(true);
        vm.expectRevert(LaunchWalletCapV1.InvalidConfiguration.selector);
        new LaunchWalletCapV1(c, abi.encode(uint16(0), uint32(3)), address(router), address(router).codehash);
        vm.expectRevert(LaunchWalletCapV1.InvalidConfiguration.selector);
        new LaunchWalletCapV1(c, abi.encode(uint16(10_001), uint32(3)), address(router), address(router).codehash);
        vm.expectRevert(LaunchWalletCapV1.InvalidConfiguration.selector);
        new LaunchWalletCapV1(c, abi.encode(uint16(200), uint32(0)), address(router), address(router).codehash);
        vm.expectRevert(LaunchWalletCapV1.InvalidConfiguration.selector);
        new LaunchWalletCapV1(c, hex"00", address(router), address(router).codehash);
        T.SwapContext memory swap;
        swap.poolId = c.poolId;
        vm.expectRevert(LaunchWalletCapV1.OnlyHost.selector);
        module.onBeforeSwap(swap);
        vm.expectRevert(LaunchWalletCapV1.OnlyHost.selector);
        module.onAfterSwap(swap);
        swap.poolId = bytes32(uint256(1));
        vm.expectRevert(LaunchWalletCapV1.InvalidContext.selector);
        vm.prank(address(host));
        module.onBeforeSwap(swap);
    }

    function testFactoryCreatesFreshPinnedInstancesWithIdenticalRuntime() public {
        LaunchWalletCapFactoryV1 factory = new LaunchWalletCapFactoryV1();
        bytes memory configuration = abi.encode(uint16(200), uint32(3));
        address first = host.createFromFactory(factory, configuration);
        address second = host.createFromFactory(factory, abi.encode(uint16(900), uint32(40)));
        require(first != second && first.codehash == second.codehash);
        require(LaunchWalletCapV1(first).configurationHash() == keccak256(configuration));
        require(LaunchWalletCapV1(first).buyRouter() == factory.BUY_ROUTER());
        require(LaunchWalletCapV1(first).buyRouterCodeHash() == factory.BUY_ROUTER_CODE_HASH());
        require(!LaunchWalletCapV1(first).descriptor().failOpenAfter);
        T.ModuleContext memory c = host.moduleContext(true);
        vm.expectRevert(LaunchWalletCapFactoryV1.OnlyBoundHost.selector);
        factory.createModule(c, configuration);
    }
}
