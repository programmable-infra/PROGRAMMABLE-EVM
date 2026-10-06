// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../../src/module-foundation/FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../../src/module-foundation/IFoundationModuleV1.sol";
import { GrowingBuyLimitV1 } from "../../../src/module-foundation/modules/growing-buy-limit/GrowingBuyLimitV1.sol";
import {
    GrowingBuyLimitFactoryV1
} from "../../../src/module-foundation/modules/growing-buy-limit/GrowingBuyLimitFactoryV1.sol";

interface GrowingLimitVm {
    function warp(uint256 timestamp) external;
    function chainId(uint256 chainId_) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata reason) external;
}

contract GrowingLimitHostFixture {
    GrowingBuyLimitV1 public module;
    uint256 public settledTrades;
    uint256 public settledFees;
    bool private tokenZero;

    function context(bool zero) public view returns (T.ModuleContext memory) {
        return T.ModuleContext(
            address(this),
            zero ? address(0x10) : address(0x20),
            zero ? address(0x20) : address(0x10),
            address(0x30),
            address(0x40),
            keccak256("pool")
        );
    }

    function configure(GrowingBuyLimitFactoryV1 factory, bytes memory data, bool zero) external {
        require(address(module) == address(0));
        tokenZero = zero;
        module = GrowingBuyLimitV1(factory.createModule(context(zero), data));
    }

    function swap(uint256 amount, bool buy, bool exactInput) external {
        T.SwapContext memory c =
            T.SwapContext(keccak256("pool"), msg.sender, buy, exactInput, exactInput ? 1 : amount, 1, 0, 0);
        require(module.onBeforeSwap{ gas: 50_000 }(c) == IFoundationModuleV1.onBeforeSwap.selector);
        ++settledTrades;
        ++settledFees;
        int128 tokenDelta = buy ? int128(int256(amount)) : -int128(int256(amount));
        c.coreAmount0 = tokenZero ? tokenDelta : int128(-1);
        c.coreAmount1 = tokenZero ? int128(-1) : tokenDelta;
        require(module.onAfterSwap{ gas: 50_000 }(c) == IFoundationModuleV1.onAfterSwap.selector);
    }
}

contract GrowingBuyLimitV1Test {
    GrowingLimitVm private constant vm = GrowingLimitVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    GrowingBuyLimitFactoryV1 private factory;
    GrowingLimitHostFixture private host;
    GrowingBuyLimitV1 private module;

    function setUp() public {
        vm.warp(1000);
        factory = new GrowingBuyLimitFactoryV1();
        host = new GrowingLimitHostFixture();
        host.configure(factory, abi.encode(uint16(50), uint16(500), uint32(600)), true);
        module = host.module();
    }

    function testTimeBoundariesAndFinalLimit() public {
        uint256 first = T.TOKEN_SUPPLY * 50 / 10_000;
        uint256 last = T.TOKEN_SUPPLY * 500 / 10_000;
        require(module.currentTokenLimit() == first);
        vm.warp(1300);
        require(module.currentTokenLimit() == first + (last - first) / 2);
        vm.warp(1599);
        require(module.currentTokenLimit() < last);
        vm.warp(1600);
        require(module.currentTokenLimit() == last);
        vm.warp(1_000_000);
        require(module.currentTokenLimit() == last);
    }

    function testBothSwapModesBoundaryAndAtomicRollback() public {
        uint256 limit = module.currentTokenLimit();
        host.swap(limit, true, true);
        host.swap(limit, true, false);
        for (uint256 i; i < 2; ++i) {
            vm.expectRevert(abi.encodeWithSelector(GrowingBuyLimitV1.BuyLimitExceeded.selector, limit + 1, limit));
            host.swap(limit + 1, true, i == 0);
        }
        require(host.settledTrades() == 2 && host.settledFees() == 2);
        host.swap(T.TOKEN_SUPPLY, false, true);
        host.swap(T.TOKEN_SUPPLY, false, false);
        require(host.settledTrades() == 4);
    }

    function testBothChainsBothTokenOrdersAndEveryRouter() public {
        for (uint256 chain; chain < 2; ++chain) {
            vm.chainId(chain == 0 ? 1 : 4663);
            for (uint256 order; order < 2; ++order) {
                GrowingLimitHostFixture other = new GrowingLimitHostFixture();
                other.configure(factory, abi.encode(uint16(100), uint16(1000), uint32(60)), order == 0);
                vm.prank(address(uint160(100 + order)));
                other.swap(T.TOKEN_SUPPLY / 100, true, order == 0);
                vm.warp(other.module().startsAt() + 60);
                other.swap(T.TOKEN_SUPPLY / 10, true, order != 0);
                require(other.settledTrades() == 2);
            }
        }
    }

    function testPerSwapNotCumulativeAndCreatorHasNoExemption() public {
        uint256 limit = module.currentTokenLimit();
        for (uint256 i; i < 3; ++i) {
            host.swap(limit, true, true);
        }
        vm.prank(address(0x30));
        vm.expectRevert(abi.encodeWithSelector(GrowingBuyLimitV1.BuyLimitExceeded.selector, limit + 1, limit));
        host.swap(limit + 1, true, true);
        require(host.settledTrades() == 3);
    }

    function testAuthorityPoolAndDeltaChecks() public {
        T.SwapContext memory c;
        c.poolId = keccak256("pool");
        vm.expectRevert(GrowingBuyLimitV1.OnlyHost.selector);
        module.onBeforeSwap(c);
        vm.expectRevert(GrowingBuyLimitV1.OnlyHost.selector);
        module.onAfterSwap(c);
        c.poolId = keccak256("other pool");
        vm.prank(address(host));
        vm.expectRevert(GrowingBuyLimitV1.InvalidContext.selector);
        module.onAfterSwap(c);
        c.poolId = keccak256("pool");
        c.buy = true;
        vm.prank(address(host));
        vm.expectRevert(GrowingBuyLimitV1.InvalidTokenDelta.selector);
        module.onAfterSwap(c);
        c.coreAmount0 = -1;
        vm.prank(address(host));
        vm.expectRevert(GrowingBuyLimitV1.InvalidTokenDelta.selector);
        module.onAfterSwap(c);
        vm.expectRevert(GrowingBuyLimitV1.NoActions.selector);
        module.onAction(address(this), "");
    }

    function testRejectsInvalidConfigurationsAndContext() public {
        T.ModuleContext memory c = host.context(true);
        bytes[4] memory bad = [
            abi.encode(uint16(0), uint16(500), uint32(600)),
            abi.encode(uint16(500), uint16(499), uint32(600)),
            abi.encode(uint16(50), uint16(10_001), uint32(600)),
            abi.encode(uint16(50), uint16(500), uint32(0))
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(GrowingBuyLimitV1.InvalidConfiguration.selector);
            new GrowingBuyLimitV1(c, bad[i]);
        }
        vm.expectRevert(GrowingBuyLimitV1.InvalidConfiguration.selector);
        new GrowingBuyLimitV1(c, hex"00");
        c.quote = c.token;
        vm.expectRevert(GrowingBuyLimitV1.InvalidContext.selector);
        new GrowingBuyLimitV1(c, abi.encode(uint16(50), uint16(500), uint32(600)));
        c = host.context(true);
        vm.expectRevert(GrowingBuyLimitFactoryV1.OnlyBoundHost.selector);
        factory.createModule(c, abi.encode(uint16(50), uint16(500), uint32(600)));
    }

    function testFreshInstancesSameRuntimeAndFixedLimit() public {
        GrowingLimitHostFixture other = new GrowingLimitHostFixture();
        bytes memory config = abi.encode(uint16(10_000), uint16(10_000), type(uint32).max);
        other.configure(factory, config, false);
        GrowingBuyLimitV1 second = other.module();
        require(address(second) != address(module) && address(second).codehash == address(module).codehash);
        require(second.configurationHash() == keccak256(config));
        require(second.currentTokenLimit() == T.TOKEN_SUPPLY);
        other.swap(T.TOKEN_SUPPLY, true, true);
        vm.warp(block.timestamp + type(uint32).max);
        require(second.currentTokenLimit() == T.TOKEN_SUPPLY);
    }

    function testFuzzMonotonicAndBounded(uint16 initial, uint16 increase, uint32 duration, uint32 time) public {
        initial = uint16(uint256(initial) % 10_000 + 1);
        uint16 finalBps = initial + uint16(uint256(increase) % (10_001 - uint256(initial)));
        if (duration == 0) duration = 1;
        GrowingBuyLimitV1 other = new GrowingBuyLimitV1(host.context(true), abi.encode(initial, finalBps, duration));
        vm.warp(1000 + uint256(time));
        uint256 limit = other.currentTokenLimit();
        require(limit >= other.initialTokenLimit() && limit <= other.finalTokenLimit());
        vm.warp(1001 + uint256(time));
        require(other.currentTokenLimit() >= limit);
    }
}
