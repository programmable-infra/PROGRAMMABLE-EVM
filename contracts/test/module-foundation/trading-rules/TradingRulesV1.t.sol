// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { FoundationTypesV1 as T } from "../../../src/module-foundation/FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../../src/module-foundation/IFoundationModuleV1.sol";
import { BoundModuleV1 } from "../../../src/module-foundation/modules/common/BoundModuleV1.sol";
import { BuyCooldownV1 } from "../../../src/module-foundation/modules/buy-cooldown/BuyCooldownV1.sol";
import { BuyCooldownFactoryV1 } from "../../../src/module-foundation/modules/buy-cooldown/BuyCooldownFactoryV1.sol";
import { BuyWindowV1 } from "../../../src/module-foundation/modules/buy-window/BuyWindowV1.sol";
import { BuyWindowFactoryV1 } from "../../../src/module-foundation/modules/buy-window/BuyWindowFactoryV1.sol";
import { PriceMoveGuardV1 } from "../../../src/module-foundation/modules/price-move-guard/PriceMoveGuardV1.sol";
import {
    PriceMoveGuardFactoryV1
} from "../../../src/module-foundation/modules/price-move-guard/PriceMoveGuardFactoryV1.sol";

contract RulesRouterFixture {
    address public msgSender;

    function setWallet(address wallet) external {
        msgSender = wallet;
    }
}

contract RulesManagerFixture {
    mapping(bytes32 => bytes32) private slots;

    function setPrice(bytes32 poolId, uint160 price) external {
        slots[keccak256(abi.encode(poolId, uint256(6)))] = bytes32(uint256(price));
    }

    function extsload(bytes32 slot) external view returns (bytes32) {
        return slots[slot];
    }
}

contract RulesHostFixture {
    address public constant initializer = address(0xFA);
    address public constant creator = address(0xCA);
    RulesRouterFixture public router = new RulesRouterFixture();
    RulesManagerFixture public manager = new RulesManagerFixture();
    IFoundationModuleV1 public module;
    uint256 public trades;
    bool private token0;

    function context(bool zero) public view returns (T.ModuleContext memory) {
        return T.ModuleContext(
            address(this),
            zero ? address(1) : address(2),
            zero ? address(2) : address(1),
            creator,
            address(4),
            keccak256("rules-pool")
        );
    }

    function install(uint8 kind, bytes calldata data, bool zero) external {
        token0 = zero;
        T.ModuleContext memory c = context(zero);
        if (kind == 0) module = new BuyCooldownV1(c, data, address(router), address(router).codehash);
        if (kind == 1) module = new BuyWindowV1(c, data);
        if (kind == 2) module = new PriceMoveGuardV1(c, data, address(manager), address(manager).codehash);
        manager.setPrice(c.poolId, 1e18);
    }

    function swap(address wallet, bool buy, bool exactInput, int128 delta, uint160 endingPrice, bool failAfter)
        external
    {
        router.setWallet(wallet);
        T.SwapContext memory c = T.SwapContext(
            keccak256("rules-pool"),
            address(router),
            buy,
            exactInput,
            1,
            1,
            token0 ? delta : int128(-1),
            token0 ? int128(-1) : delta
        );
        T.Descriptor memory d = module.descriptor();
        if (d.phases & T.BEFORE_SWAP != 0) {
            require(module.onBeforeSwap{ gas: d.beforeGas }(c) == IFoundationModuleV1.onBeforeSwap.selector);
        }
        manager.setPrice(c.poolId, endingPrice);
        if (d.phases & T.AFTER_SWAP != 0) {
            require(module.onAfterSwap{ gas: d.afterGas }(c) == IFoundationModuleV1.onAfterSwap.selector);
        }
        require(!failAfter, "downstream failure");
        trades++;
    }
}

contract TradingRulesV1Test is Test {
    RulesHostFixture private host;
    IFoundationModuleV1 private module;
    address private constant ALICE = address(0xA1);
    address private constant BOB = address(0xB1);

    function setUp() public {
        vm.warp(1 days + 8 hours);
        host = new RulesHostFixture();
    }

    function _install(uint8 kind, bytes memory config, bool token0) private {
        host.install(kind, config, token0);
        module = host.module();
    }

    function _swap(address wallet, bool buy) private {
        host.swap(wallet, buy, true, buy ? int128(100) : int128(-100), 1e18, false);
    }

    function _c() private view returns (T.SwapContext memory c) {
        c.poolId = keccak256("rules-pool");
        c.router = address(host.router());
        c.buy = true;
    }

    function testCooldownBoundaryIndependentWalletsAndSells() public {
        _install(0, abi.encode(uint32(30)), true);
        BuyCooldownV1 m = BuyCooldownV1(address(module));
        _swap(ALICE, true);
        uint256 next = m.nextBuyAt(ALICE);
        _swap(BOB, true);
        _swap(ALICE, false);
        assertEq(m.nextBuyAt(ALICE), next);
        vm.warp(next - 1);
        vm.expectRevert(abi.encodeWithSelector(BuyCooldownV1.BuyTooSoon.selector, ALICE, next));
        host.swap(ALICE, true, false, 100, 1e18, false);
        vm.warp(next);
        _swap(ALICE, true);
        assertEq(m.nextBuyAt(ALICE), next + 30);
        assertEq(host.trades(), 4);
    }

    function testCooldownCreatorInitialBuyAndSmartWallet() public {
        _install(0, abi.encode(uint32(30)), false);
        BuyCooldownV1 m = BuyCooldownV1(address(module));
        _swap(address(0xFA), true);
        assertGt(m.nextBuyAt(address(0xCA)), block.timestamp);
        vm.expectRevert();
        host.swap(address(0xCA), true, true, 100, 1e18, false);
        // An arbitrary contract wallet is an independent authenticated initiator, without tx.origin.
        _swap(address(this), true);
        assertGt(m.nextBuyAt(address(this)), block.timestamp);
    }

    function testCooldownFailedBuyDoesNotConsumeTime() public {
        _install(0, abi.encode(uint32(30)), true);
        vm.expectRevert("downstream failure");
        host.swap(ALICE, true, true, 100, 1e18, true);
        assertEq(BuyCooldownV1(address(module)).nextBuyAt(ALICE), 0);
        _swap(ALICE, true);
    }

    function testCooldownRejectsSpoofedRouterZeroBuyerAndInvalidOutput() public {
        _install(0, abi.encode(uint32(30)), true);
        T.SwapContext memory c = _c();
        c.router = address(0xBAD);
        vm.prank(address(host));
        vm.expectRevert(BuyCooldownV1.UnsupportedBuyRouter.selector);
        module.onBeforeSwap(c);
        vm.expectRevert(BuyCooldownV1.InvalidBuyer.selector);
        host.swap(address(0), true, true, 100, 1e18, false);
        vm.expectRevert(BuyCooldownV1.InvalidTokenDelta.selector);
        host.swap(ALICE, true, true, 0, 1e18, false);
        c.buy = false;
        vm.prank(address(host));
        module.onBeforeSwap(c); // Sells do not depend on a supported router.
    }

    function testWindowExactBoundariesAndNextOpening() public {
        _install(1, abi.encode(uint8(8), uint8(12)), true);
        BuyWindowV1 m = BuyWindowV1(address(module));
        assertTrue(m.isBuyOpen());
        _swap(ALICE, true);
        vm.warp(1 days + 20 hours - 1);
        assertTrue(m.isBuyOpen());
        vm.warp(1 days + 20 hours);
        assertFalse(m.isBuyOpen());
        assertEq(m.nextBuyTime(), 2 days + 8 hours);
        vm.expectRevert(abi.encodeWithSelector(BuyWindowV1.BuyWindowClosed.selector, 2 days + 8 hours));
        host.swap(address(0xFA), true, true, 100, 1e18, false);
        _swap(ALICE, false);
        vm.warp(m.nextBuyTime());
        _swap(ALICE, true);
    }

    function testWindowAcrossMidnightAndNoDaylightSavingOffset() public {
        _install(1, abi.encode(uint8(22), uint8(4)), false);
        BuyWindowV1 m = BuyWindowV1(address(module));
        vm.warp(1 days + 22 hours);
        assertTrue(m.isBuyOpen());
        vm.warp(2 days);
        assertTrue(m.isBuyOpen());
        vm.warp(2 days + 2 hours - 1);
        assertTrue(m.isBuyOpen());
        vm.warp(2 days + 2 hours);
        assertFalse(m.isBuyOpen());
        assertEq(m.nextBuyTime(), 2 days + 22 hours);
        vm.warp(300 days + 22 hours);
        assertTrue(m.isBuyOpen());
    }

    function testFuzzWindowMatchesDailySchedule(uint8 hour, uint8 duration, uint32 timestamp) public {
        hour %= 24;
        duration = uint8(uint256(duration) % 23 + 1);
        _install(1, abi.encode(hour, duration), true);
        vm.warp(timestamp);
        uint256 second = uint256(timestamp) % 86_400;
        uint256 start = uint256(hour) * 3600;
        uint256 end = start + uint256(duration) * 3600;
        bool open = end <= 86_400 ? second >= start && second < end : second >= start || second < end - 86_400;
        BuyWindowV1 m = BuyWindowV1(address(module));
        assertEq(m.isBuyOpen(), open);
        uint256 next = m.nextBuyTime();
        if (open) {
            assertEq(next, timestamp);
        } else {
            assertGt(next, timestamp);
            assertLe(next - timestamp, 86_400);
            vm.warp(next);
            assertTrue(m.isBuyOpen());
        }
    }

    function testGuardExactPercentAndTokenOrientation() public {
        _install(2, abi.encode(uint16(1900)), true);
        PriceMoveGuardV1 m = PriceMoveGuardV1(address(module));
        assertTrue(m.priceMoveAllowed(100e18, 90e18)); // price 1 -> 0.81, exactly -19%
        assertFalse(m.priceMoveAllowed(100e18, 90e18 - 1));
        assertFalse(m.priceMoveAllowed(100e18, 110e18)); // +21%
        _install(2, abi.encode(uint16(4400)), true);
        m = PriceMoveGuardV1(address(module));
        assertTrue(m.priceMoveAllowed(100e18, 120e18)); // exactly +44%
        assertFalse(m.priceMoveAllowed(100e18, 120e18 + 1));
        _install(2, abi.encode(uint16(1900)), false);
        m = PriceMoveGuardV1(address(module));
        assertFalse(m.priceMoveAllowed(100e18, 90e18)); // inverse price increases by 23.456...%
        assertTrue(m.priceMoveAllowed(100e18, 110e18)); // inverse price falls by 17.355...%
    }

    function testGuardBothDirectionsRollbackAndSnapshotReset() public {
        _install(2, abi.encode(uint16(1000)), true);
        host.swap(ALICE, true, true, 100, 1e18 + 1e16, false);
        vm.expectRevert(
            abi.encodeWithSelector(PriceMoveGuardV1.PriceMoveExceeded.selector, uint160(1e18 + 1e16), uint160(2e18))
        );
        host.swap(ALICE, true, false, 100, 2e18, false);
        vm.expectRevert();
        host.swap(ALICE, false, true, -100, 5e17, false);
        assertEq(host.trades(), 1);
        host.swap(ALICE, false, false, -100, 1e18, false);
        assertEq(host.trades(), 2);
    }

    function testGuardRejectsMissingBeforeNestedBeforeAndEmptyPool() public {
        _install(2, abi.encode(uint16(1000)), true);
        T.SwapContext memory c = _c();
        vm.prank(address(host));
        vm.expectRevert(PriceMoveGuardV1.InvalidSwapSequence.selector);
        module.onAfterSwap(c);
        vm.prank(address(host));
        module.onBeforeSwap(c);
        vm.prank(address(host));
        vm.expectRevert(PriceMoveGuardV1.InvalidSwapSequence.selector);
        module.onBeforeSwap(c);
        vm.prank(address(host));
        module.onAfterSwap(c);
        host.manager().setPrice(c.poolId, 0);
        vm.prank(address(host));
        vm.expectRevert(PriceMoveGuardV1.InvalidPoolPrice.selector);
        module.onBeforeSwap(c);
    }

    function testGuardFullUint160PriceRange() public {
        _install(2, abi.encode(uint16(5000)), true);
        PriceMoveGuardV1 m = PriceMoveGuardV1(address(module));
        assertTrue(m.priceMoveAllowed(type(uint160).max, type(uint160).max));
        assertTrue(m.priceMoveAllowed(1, 1));
        assertFalse(m.priceMoveAllowed(1, type(uint160).max));
        assertFalse(m.priceMoveAllowed(type(uint160).max, 1));
        assertFalse(m.priceMoveAllowed(0, 1));
        assertFalse(m.priceMoveAllowed(1, 0));
    }

    function testFuzzGuardNeverAdmitsExcessPriceMove(uint112 start, uint112 end, uint16 bps, bool zero) public {
        if (start == 0) start = 1;
        if (end == 0) end = 1;
        bps = uint16(uint256(bps) % 5000 + 1);
        _install(2, abi.encode(bps), zero);
        bool allowed = PriceMoveGuardV1(address(module)).priceMoveAllowed(start, end);
        uint256 beforeSquare = uint256(start) * start;
        uint256 afterSquare = uint256(end) * end;
        uint256 numerator = zero ? afterSquare : beforeSquare;
        uint256 denominator = zero ? beforeSquare : afterSquare;
        uint256 difference = numerator > denominator ? numerator - denominator : denominator - numerator;
        if (allowed) assertLe(difference * 10_000, denominator * bps);
        // Outside the rounding boundary, an allowed trade must not be rejected either.
        if (difference * 10_000 + denominator < denominator * bps) assertTrue(allowed);
    }

    function testAllRulesRejectUnboundCallersPoolsAndActions() public {
        for (uint8 kind; kind < 3; kind++) {
            _install(
                kind,
                kind == 0
                    ? abi.encode(uint32(30))
                    : kind == 1 ? abi.encode(uint8(8), uint8(12)) : abi.encode(uint16(1000)),
                true
            );
            T.SwapContext memory c = _c();
            vm.expectRevert(BoundModuleV1.OnlyHost.selector);
            module.onBeforeSwap(c);
            vm.expectRevert(BoundModuleV1.OnlyHost.selector);
            module.onAfterSwap(c);
            c.poolId = keccak256("different");
            vm.prank(address(host));
            vm.expectRevert(BoundModuleV1.InvalidContext.selector);
            module.onBeforeSwap(c);
            vm.expectRevert(BoundModuleV1.NoActions.selector);
            module.onAction(ALICE, "");
        }
    }

    function testInvalidConfigurationsAndRuntimePins() public {
        bytes[6] memory configs = [
            abi.encode(uint32(0)),
            abi.encode(uint32(86_401)),
            abi.encode(uint8(24), uint8(1)),
            abi.encode(uint8(0), uint8(0)),
            abi.encode(uint16(0)),
            abi.encode(uint16(5001))
        ];
        for (uint8 i; i < 6; i++) {
            vm.expectRevert(BoundModuleV1.InvalidConfiguration.selector);
            host.install(i / 2, configs[i], true);
        }
        vm.expectRevert(BoundModuleV1.InvalidConfiguration.selector);
        host.install(1, hex"00", true);
        T.ModuleContext memory c = host.context(true);
        address router = address(host.router());
        address manager = address(host.manager());
        vm.expectRevert(BoundModuleV1.InvalidContext.selector);
        new BuyCooldownV1(c, abi.encode(uint32(30)), router, bytes32(uint256(1)));
        vm.expectRevert(BoundModuleV1.InvalidContext.selector);
        new PriceMoveGuardV1(c, abi.encode(uint16(1000)), manager, bytes32(uint256(1)));
        c.token = c.quote;
        vm.expectRevert(BoundModuleV1.InvalidContext.selector);
        new BuyWindowV1(c, abi.encode(uint8(8), uint8(12)));
    }

    function testFactoriesRejectOtherHostAndUnsupportedChains() public {
        BuyCooldownFactoryV1 cooldown = new BuyCooldownFactoryV1();
        BuyWindowFactoryV1 window = new BuyWindowFactoryV1();
        PriceMoveGuardFactoryV1 guard = new PriceMoveGuardFactoryV1();
        T.ModuleContext memory c = host.context(true);
        vm.expectRevert(BuyCooldownFactoryV1.OnlyBoundHost.selector);
        cooldown.createModule(c, abi.encode(uint32(30)));
        vm.expectRevert(BuyWindowFactoryV1.OnlyBoundHost.selector);
        window.createModule(c, abi.encode(uint8(8), uint8(12)));
        vm.expectRevert(PriceMoveGuardFactoryV1.OnlyBoundHost.selector);
        guard.createModule(c, abi.encode(uint16(1000)));
        vm.chainId(31_337);
        vm.prank(address(host));
        vm.expectRevert(BuyCooldownFactoryV1.UnsupportedChain.selector);
        cooldown.createModule(c, abi.encode(uint32(30)));
        vm.prank(address(host));
        vm.expectRevert(PriceMoveGuardFactoryV1.UnsupportedChain.selector);
        guard.createModule(c, abi.encode(uint16(1000)));
    }
}
