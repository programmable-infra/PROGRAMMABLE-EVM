// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBaseV3 } from "./FoundationDirectionalFeesV3.t.sol";
import { FoundationEthereumFixtureV3 } from "./FoundationEthereumV3.t.sol";
import { FoundationQuoteFixture } from "./FoundationFixturesV1.sol";
import { GrowingWalletCapFactoryFixture } from "./GrowingBuyLimitForkV1.t.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { FoundationLaunchTypesV3 as P } from "../../src/module-foundation/FoundationLaunchTypesV3.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import { FoundationHookV2 } from "../../src/module-foundation/FoundationHookV2.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { IFoundationModuleV1, IFoundationModuleFactoryV1 } from "../../src/module-foundation/IFoundationModuleV1.sol";
import { BuyCooldownV1 } from "../../src/module-foundation/modules/buy-cooldown/BuyCooldownV1.sol";
import { BuyCooldownFactoryV1 } from "../../src/module-foundation/modules/buy-cooldown/BuyCooldownFactoryV1.sol";
import { BuyWindowV1 } from "../../src/module-foundation/modules/buy-window/BuyWindowV1.sol";
import { BuyWindowFactoryV1 } from "../../src/module-foundation/modules/buy-window/BuyWindowFactoryV1.sol";
import {
    PriceMoveGuardFactoryV1
} from "../../src/module-foundation/modules/price-move-guard/PriceMoveGuardFactoryV1.sol";
import {
    GrowingBuyLimitFactoryV1
} from "../../src/module-foundation/modules/growing-buy-limit/GrowingBuyLimitFactoryV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract TradingRulesForkBase is FoundationForkBaseV3 {
    function ruleSelection(uint8 kind, bytes calldata custom) external returns (T.ModuleSelection memory) {
        IFoundationModuleFactoryV1 f;
        bytes memory config;
        if (kind == 0) {
            f = new BuyCooldownFactoryV1();
            config = abi.encode(uint32(30));
        }
        if (kind == 1) {
            f = new BuyWindowFactoryV1();
            config = abi.encode(uint8(block.timestamp / 1 hours % 24), uint8(4));
        }
        if (kind == 2) {
            f = new PriceMoveGuardFactoryV1();
            config = abi.encode(uint16(1000));
        }
        if (kind == 3) {
            f = new GrowingBuyLimitFactoryV1();
            config = abi.encode(uint16(50), uint16(500), uint32(600));
        }
        if (kind == 4) {
            f = new GrowingWalletCapFactoryFixture(ROUTER);
            config = abi.encode(uint16(200), uint32(60));
        }
        if (custom.length != 0) config = custom;
        T.ModuleContext memory c =
            T.ModuleContext(address(this), address(1), address(2), ALICE, address(3), bytes32(uint256(1)));
        address sample = f.createModule(c, config);
        return T.ModuleSelection(
            address(f),
            address(f).codehash,
            sample.codehash,
            keccak256(abi.encode(IFoundationModuleV1(sample).descriptor())),
            config,
            0
        );
    }

    function launchRules(bytes calldata kinds, bool quoteFirst, uint128 initial)
        external
        returns (L.LaunchResultV2 memory)
    {
        P.LaunchParamsV3 memory p = _params(quoteFirst, 100, 300, 0, initial);
        if (quote.decimals() == 6) p.initialTick = quoteFirst ? int24(276_300) : int24(-276_300);
        p.modules = new T.ModuleSelection[](kinds.length);
        for (uint256 i; i < kinds.length; i++) {
            p.modules[i] = this.ruleSelection(uint8(kinds[i]), "");
        }
        _mine(p);
        return _launch(p);
    }

    function testCooldownQuoteFirstLifecycle() public {
        _cooldown(true);
    }

    function testCooldownTokenFirstLifecycle() public {
        _cooldown(false);
    }

    function _cooldown(bool quoteFirst) private {
        L.LaunchResultV2 memory r = this.launchRules(hex"00", quoteFirst, 0.001 ether);
        BuyCooldownV1 m = BuyCooldownV1(FoundationHookV2(r.hook).moduleAt(0).instance);
        uint256 next = m.nextBuyAt(ALICE);
        assertGt(next, block.timestamp);
        uint256 fees = FoundationLedgerV1(r.ledger).platformReceived();
        vm.expectRevert();
        this.tradeExternal(r, true, false, 1 ether);
        assertEq(FoundationLedgerV1(r.ledger).platformReceived(), fees);
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE));
        assertEq(m.nextBuyAt(ALICE), next);
        vm.warp(next - 1);
        vm.expectRevert();
        this.tradeExternal(r, true, true, 1 ether);
        vm.warp(next);
        this.tradeExternal(r, true, false, 1000 ether);
        vm.warp(m.nextBuyAt(ALICE));
        this.tradeExternal(r, true, true, 1 ether);
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE));
    }

    function testDailyWindowBuySellAndReopening() public {
        L.LaunchResultV2 memory r = this.launchRules(hex"01", true, 0.001 ether);
        BuyWindowV1 m = BuyWindowV1(FoundationHookV2(r.hook).moduleAt(0).instance);
        this.tradeExternal(r, true, false, 1000 ether);
        vm.warp(block.timestamp + 4 hours - block.timestamp % 1 hours);
        assertFalse(m.isBuyOpen());
        vm.expectRevert();
        this.tradeExternal(r, true, false, 1 ether);
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE));
        vm.warp(m.nextBuyTime());
        this.tradeExternal(r, true, true, 1 ether);
    }

    function testDailyWindowRejectsClosedCreatorFirstBuy() public {
        P.LaunchParamsV3 memory p = _params(true, 100, 300, 0, 0.001 ether);
        p.modules = new T.ModuleSelection[](1);
        p.modules[0] = this.ruleSelection(1, abi.encode(uint8((block.timestamp / 1 hours + 1) % 24), uint8(1)));
        _mine(p);
        address token = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        vm.prank(ALICE);
        vm.expectRevert();
        factory.launch(p);
        assertEq(token.code.length, 0);
        // Omitting the first buy can create the pool while its buy window is closed.
        p.initialBuyQuoteAmount = 0;
        p.initialBuyMinimumTokenAmount = 0;
        _mine(p);
        _launch(p);
    }

    function testPriceGuardQuoteFirstLifecycle() public {
        _guard(true);
    }

    function testPriceGuardTokenFirstLifecycle() public {
        _guard(false);
    }

    function _guard(bool quoteFirst) private {
        L.LaunchResultV2 memory r = this.launchRules(hex"02", quoteFirst, 0.001 ether);
        uint256 before = IERC20(r.token).balanceOf(ALICE);
        uint256 fees = FoundationLedgerV1(r.ledger).platformReceived();
        vm.expectRevert();
        this.tradeExternal(r, true, false, 200_000_000 ether);
        vm.expectRevert();
        this.tradeExternal(r, true, true, 5000 ether);
        assertEq(IERC20(r.token).balanceOf(ALICE), before);
        assertEq(FoundationLedgerV1(r.ledger).platformReceived(), fees);
        for (uint256 i; i < 5; i++) {
            this.tradeExternal(r, true, false, 20_000_000 ether);
        }
        uint256 aggregateBalance = IERC20(r.token).balanceOf(ALICE);
        vm.expectRevert();
        this.tradeExternal(r, false, true, aggregateBalance);
        // Large aggregate moves are possible, but each swap must satisfy the chosen percentage.
        for (uint256 i; i < 5; i++) {
            this.tradeExternal(r, false, true, 20_000_000 ether);
        }
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE));
    }

    function testAllRulesComposeWithGrowingAndWalletLimits() public {
        L.LaunchResultV2 memory r = this.launchRules(hex"0001020304", true, 0.001 ether);
        assertEq(FoundationHookV2(r.hook).moduleCount(), 5);
        BuyCooldownV1 m = BuyCooldownV1(FoundationHookV2(r.hook).moduleAt(0).instance);
        vm.warp(m.nextBuyAt(ALICE));
        this.tradeExternal(r, true, false, 100_000 ether);
        vm.expectRevert();
        this.tradeExternal(r, true, false, 1 ether);
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE));
        vm.warp(m.nextBuyAt(ALICE));
        this.tradeExternal(r, true, true, 1 ether);
    }

    function testAllRulesWithSixDecimalQuoteAndFirstBuy() public {
        quote = new FoundationQuoteFixture(6);
        quote.mint(ALICE, 1_000_000e6);
        vm.prank(ALICE);
        quote.approve(address(factory), type(uint256).max);
        L.LaunchResultV2 memory r = this.launchRules(hex"0001020304", true, 1e6);
        assertGt(r.initialBuyTokenAmount, 0);
        BuyCooldownV1 m = BuyCooldownV1(FoundationHookV2(r.hook).moduleAt(0).instance);
        vm.warp(m.nextBuyAt(ALICE));
        this.tradeExternal(r, true, true, 1e6);
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE));
    }
}

contract TradingRulesRobinhoodForkTest is TradingRulesForkBase { }

contract TradingRulesEthereumForkTest is TradingRulesForkBase {
    function _configureNetwork() internal override {
        MANAGER = FoundationEthereumFixtureV3.MANAGER;
        POSM = FoundationEthereumFixtureV3.POSM;
        ROUTER = FoundationEthereumFixtureV3.ROUTER;
        expectedChainId = 1;
        expectedInfrastructureHashes = FoundationEthereumFixtureV3.hashes();
        snapshotBlock = 26_125_239;
        forkRpcEnvironment = "FOUNDATION_ETHEREUM_RPC_URL";
        forkBlockEnvironment = "FOUNDATION_ETHEREUM_FORK_BLOCK";
    }
}
