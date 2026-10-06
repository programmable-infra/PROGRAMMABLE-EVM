// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBaseV3 } from "./FoundationDirectionalFeesV3.t.sol";
import { FoundationEthereumFixtureV3 } from "./FoundationEthereumV3.t.sol";
import { FoundationQuoteFixture } from "./FoundationFixturesV1.sol";
import { EconomicReleaseFixtureV1 } from "./EconomicReleaseFixtureV1.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { FoundationLaunchTypesV3 as P } from "../../src/module-foundation/FoundationLaunchTypesV3.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import { FoundationHookV2 } from "../../src/module-foundation/FoundationHookV2.sol";
import { FoundationHookV1 } from "../../src/module-foundation/FoundationHookV1.sol";
import { FoundationFactoryV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";
import { FoundationFactoryV3 } from "../../src/module-foundation/FoundationFactoryV3.sol";
import { FoundationHookDeployerV2 } from "../../src/module-foundation/FoundationHookDeployerV2.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { IFoundationModuleV1, IFoundationModuleFactoryV1 } from "../../src/module-foundation/IFoundationModuleV1.sol";
import { FeeStrategyV1 } from "../../src/module-foundation/modules/economics/FeeStrategyV1.sol";
import { BuyerRewardsV1 } from "../../src/module-foundation/modules/economics/BuyerRewardsV1.sol";
import { PoolGamesV1 } from "../../src/module-foundation/modules/economics/PoolGamesV1.sol";
import { LinkedPoolV1 } from "../../src/module-foundation/modules/economics/LinkedPoolV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IFoundationUniversalRouterV2 } from "../../src/module-foundation/FoundationFactoryV2.sol";

interface VmColdStorage {
    function cool(address target) external;
}

abstract contract EconomicModulesForkBase is FoundationForkBaseV3 {
    using StateLibrary for IPoolManager;

    function _selection(uint8 kind, address referenceHost, uint16 share) internal returns (T.ModuleSelection memory) {
        string[11] memory names = [
            "BuybackBurnFactoryV1",
            "DipBuybackFactoryV1",
            "LPRewardsFactoryV1",
            "FullRangeLPFactoryV1",
            "BuyerRewardsFactoryV1",
            "NthBuyPotFactoryV1",
            "KingOfTheHillFactoryV1",
            "HotPotatoFactoryV1",
            "PlagueFactoryV1",
            "ReactivePairFactoryV1",
            "EntangledFactoryV1"
        ];
        address released = EconomicReleaseFixtureV1.factory(vm, kind);
        IFoundationModuleFactoryV1 f = IFoundationModuleFactoryV1(
            released == address(0) ? deployCode(string.concat("EconomicModuleFactoriesV1.sol:", names[kind])) : released
        );
        bytes memory config;
        if (kind < 4) {
            config = abi.encode(
                uint128(1),
                uint128(quote.decimals() == 6 ? 10_000 : 0.01 ether),
                uint32(30),
                uint32(300),
                uint16(500),
                uint16(kind == 1 ? 500 : 0)
            );
        } else if (kind < 7) {
            config = abi.encode(
                uint128(1), uint16(kind == 4 ? 100 : 0), uint32(kind == 5 ? 2 : 0), uint32(kind == 6 ? 300 : 0)
            );
        } else if (kind < 9) {
            config = abi.encode(uint128(1), uint32(kind == 7 ? 60 : 0));
        } else if (kind == 9) {
            config = abi.encode(referenceHost, uint16(100), uint16(10), uint16(500), uint16(0));
        } else {
            config = abi.encode(referenceHost, uint16(0), uint16(0), uint16(0), uint16(100));
        }
        T.ModuleContext memory c =
            T.ModuleContext(address(this), address(1), address(quote), ALICE, address(3), bytes32(uint256(1)));
        address sample = f.createModule(c, config);
        T.ModuleSelection memory selection = T.ModuleSelection(
            address(f),
            address(f).codehash,
            sample.codehash,
            keccak256(abi.encode(IFoundationModuleV1(sample).descriptor())),
            config,
            share
        );
        EconomicReleaseFixtureV1.verify(vm, kind, selection);
        return selection;
    }

    function _launchModules(bytes memory kinds, bool quoteFirst, uint128 initial, address referenceHost)
        internal
        returns (L.LaunchResultV2 memory r)
    {
        P.LaunchParamsV3 memory p = _params(quoteFirst, 1000, 1000, 0, initial);
        if (quote.decimals() == 6) p.initialTick = quoteFirst ? int24(276_300) : int24(-276_300);
        p.modules = new T.ModuleSelection[](kinds.length);
        uint16 count;
        for (uint256 i; i < kinds.length; ++i) {
            if (uint8(kinds[i]) < 7) ++count;
        }
        for (uint256 i; i < kinds.length; ++i) {
            p.modules[i] = _selection(uint8(kinds[i]), referenceHost, uint8(kinds[i]) < 7 ? uint16(10_000 / count) : 0);
        }
        _mine(p);
        return _launch(p);
    }

    function _module(L.LaunchResultV2 memory r, uint256 i) internal view returns (address) {
        return FoundationHookV2(r.hook).moduleAt(i).instance;
    }

    /// @dev A quote priced at $3,000 gives $4,997.25 FDV at this 60-aligned tick.
    /// This is a deterministic valuation fixture, not a live USD price assertion.
    /// Amount fields have no package defaults: use explicit, finite test amounts.
    function _normalLaunch(uint8 kind, bool quoteFirst, address referenceHost)
        internal
        returns (L.LaunchResultV2 memory r)
    {
        P.LaunchParamsV3 memory p = _params(quoteFirst, kind < 7 ? 1000 : 0, kind < 7 ? 1000 : 0, 0, 0);
        p.initialTick = quoteFirst ? int24(202_140) : int24(-202_140);
        if (kind != type(uint8).max) {
            p.modules = new T.ModuleSelection[](1);
            p.modules[0] = _selection(kind, referenceHost, kind < 7 ? 10_000 : 0);
            if (kind < 4) {
                p.modules[0].configuration = abi.encode(
                    uint128(0.000_001 ether),
                    uint128(0.000_01 ether),
                    uint32(300),
                    uint32(300),
                    uint16(500),
                    uint16(kind == 1 ? 500 : 0)
                );
            } else if (kind < 7) {
                p.modules[0].configuration = abi.encode(
                    uint128(0.000_01 ether),
                    uint16(kind == 4 ? 100 : 0),
                    uint32(kind == 5 ? 10 : 0),
                    uint32(kind == 6 ? 3600 : 0)
                );
            } else if (kind < 9) {
                p.modules[0].configuration =
                    abi.encode(uint128(kind == 7 ? 0.000_01 ether : 1 ether), uint32(kind == 7 ? 60 : 0));
            } else {
                p.modules[0].configuration = abi.encode(
                    referenceHost,
                    uint16(kind == 9 ? 100 : 0),
                    uint16(kind == 9 ? 10 : 0),
                    uint16(kind == 9 ? 500 : 0),
                    uint16(kind == 10 ? 1000 : 0)
                );
            }
        }
        _mine(p);
        r = _launch(p);
        assertEq(r.creatorQuotePrincipal, 0);
        assertEq(r.initialBuyTokenAmount, 0);
        assertGt(r.baseTokenPrincipal, 0);
        (uint160 sqrt,,,) = manager.getSlot0(PoolId.wrap(r.poolId));
        uint256 square = uint256(sqrt) * sqrt;
        uint256 quoteValue = quoteFirst
            ? FullMath.mulDiv(T.TOKEN_SUPPLY, 1 << 192, square)
            : FullMath.mulDiv(T.TOKEN_SUPPLY, square, 1 << 192);
        uint256 dollars = quoteValue * 3000 / 1 ether;
        assertGe(dollars, 4984);
        assertLe(dollars, 5016);
    }

    function normalTradeExternal(L.LaunchResultV2 memory r, address actor, bool buy, uint128 amount)
        external
        returns (uint256 received)
    {
        FoundationHookV2 hook = FoundationHookV2(r.hook);
        address input = buy ? address(quote) : r.token;
        address output = buy ? r.token : address(quote);
        uint256 beforeInput = IERC20(input).balanceOf(actor);
        uint256 beforeOutput = IERC20(output).balanceOf(actor);
        vm.startPrank(actor);
        IERC20(input).approve(PERMIT2, amount);
        permits.approve(input, ROUTER, amount, uint48(block.timestamp + 120));
        bytes[] memory params = new bytes[](3);
        params[0] =
            abi.encode(IV4Router.ExactInputSingleParams(hook.poolKey(), input < output, amount, 1, 0, bytes("")));
        params[1] = abi.encode(Currency.wrap(input), uint256(amount));
        params[2] = abi.encode(Currency.wrap(output), uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)),
            params
        );
        IFoundationUniversalRouterV2(ROUTER).execute(hex"10", inputs, block.timestamp + 120);
        vm.stopPrank();
        assertEq(beforeInput - IERC20(input).balanceOf(actor), amount);
        received = IERC20(output).balanceOf(actor) - beforeOutput;
        assertGt(received, 0);
        _assertClean(r);
    }

    function _normalPay(L.LaunchResultV2 memory r) internal {
        BuyerRewardsV1 m = BuyerRewardsV1(_module(r, 0));
        address[] memory recipients = new address[](2);
        recipients[0] = ALICE;
        recipients[1] = BOB;
        uint256 aliceBefore = quote.balanceOf(ALICE);
        uint256 bobBefore = quote.balanceOf(BOB);
        uint256 aliceOwed = m.owed(ALICE);
        uint256 bobOwed = m.owed(BOB);
        assertGt(aliceOwed + bobOwed, 0);
        bytes memory action = abi.encodePacked(m.PAY(), abi.encode(recipients));
        vm.prank(address(0xCA401));
        FoundationHookV2(r.hook).executeModuleAction(0, action);
        assertEq(quote.balanceOf(ALICE), aliceBefore + aliceOwed);
        assertEq(quote.balanceOf(BOB), bobBefore + bobOwed);
        assertEq(m.totalOwed(), 0);
        uint256 paid = m.totalPaid();
        FoundationHookV2(r.hook).executeModuleAction(0, action);
        assertEq(m.totalPaid(), paid);
        assertEq(quote.balanceOf(ALICE), aliceBefore + aliceOwed);
        assertEq(quote.balanceOf(BOB), bobBefore + bobOwed);
        assertEq(m.reserve() + m.totalOwed() + m.totalPaid(), m.accountedCredits());
    }

    function _normalScenario(uint8 kind) internal {
        for (uint256 order; order < 2; ++order) {
            uint256 snapshot = vm.snapshotState();
            bool quoteFirst = order == 0;
            quote.mint(BOB, 1 ether);
            L.LaunchResultV2 memory ref;
            if (kind >= 9) {
                ref = _normalLaunch(type(uint8).max, quoteFirst, address(0));
                this.normalTradeExternal(ref, ALICE, true, 0.001 ether);
            }
            L.LaunchResultV2 memory r = _normalLaunch(kind, quoteFirst, ref.hook);
            if (kind == 8) {
                vm.expectRevert();
                this.normalTradeExternal(r, BOB, true, 0.001 ether);
            }
            if (kind >= 9) {
                L.LaunchResultV2 memory unrelated = _normalLaunch(type(uint8).max, quoteFirst, address(0));
                LinkedPoolV1 linked = LinkedPoolV1(_module(r, 0));
                uint256 cap = linked.currentCap();
                this.normalTradeExternal(unrelated, ALICE, true, 0.2 ether);
                if (kind == 9) {
                    assertEq(linked.currentCap(), cap);
                    vm.expectRevert();
                    this.normalTradeExternal(r, ALICE, true, 0.1 ether);
                } else {
                    assertFalse(linked.unlockReached());
                    vm.expectRevert();
                    this.normalTradeExternal(r, ALICE, true, 0.001 ether);
                }
                this.normalTradeExternal(ref, ALICE, true, 0.2 ether);
                if (kind == 9) assertGt(linked.currentCap(), cap);
                else assertTrue(linked.unlockReached());
            }
            this.normalTradeExternal(r, ALICE, true, kind == 1 ? 0.2 ether : 0.001 ether);
            if (kind < 4) {
                FeeStrategyV1 m = FeeStrategyV1(_module(r, 0));
                if (kind != 2) {
                    vm.expectRevert();
                    this.normalExecuteExternal(r);
                }
                vm.warp(block.timestamp + 301);
                if (kind == 1) {
                    vm.expectRevert();
                    this.normalExecuteExternal(r);
                    this.normalTradeExternal(r, ALICE, false, uint128(IERC20(r.token).balanceOf(ALICE)));
                }
                _execute(r, 0);
                assertGt(m.totalQuoteUsed(), 0);
                assertLe(m.totalQuoteUsed(), 0.000_01 ether);
                if (kind < 2) assertGt(m.totalBurned(), 0);
                if (kind == 3) assertGt(m.lockedLiquidity(), 0);
                vm.expectRevert();
                this.normalExecuteExternal(r);
            } else if (kind == 5) {
                BuyerRewardsV1 m = BuyerRewardsV1(_module(r, 0));
                assertEq(m.everyN(), 10);
                this.normalTradeExternal(r, BOB, true, 0.001 ether);
                assertEq(m.qualifyingBuys(), 1);
                uint256 buyBlock = block.number;
                for (uint256 i = 2; i <= 10; ++i) {
                    vm.roll(buyBlock + i);
                    this.normalTradeExternal(r, i == 10 ? BOB : ALICE, true, 0.001 ether);
                }
                assertEq(m.qualifyingBuys(), 10);
                assertEq(m.owed(ALICE), 0);
                assertGt(m.owed(BOB), 0);
                _normalPay(r);
            } else if (kind == 6) {
                BuyerRewardsV1 m = BuyerRewardsV1(_module(r, 0));
                assertEq(m.king(), ALICE);
                uint256 aliceOwed = m.owed(ALICE);
                this.normalTradeExternal(r, BOB, true, 0.002 ether);
                assertEq(m.king(), BOB);
                assertGt(m.owed(ALICE), aliceOwed);
                uint256 bobOwed = m.owed(BOB);
                this.normalTradeExternal(r, ALICE, true, 0.000_02 ether);
                assertEq(m.king(), BOB);
                assertGt(m.owed(BOB), bobOwed);
                this.normalTradeExternal(r, BOB, false, uint128(IERC20(r.token).balanceOf(BOB)));
                assertEq(m.king(), address(0));
                _normalPay(r);
            } else if (kind == 4) {
                _normalPay(r);
            } else if (kind == 7) {
                uint128 aliceTokens = uint128(IERC20(r.token).balanceOf(ALICE));
                vm.expectRevert();
                this.normalTradeExternal(r, ALICE, false, aliceTokens);
                this.normalTradeExternal(r, BOB, true, 0.001 ether);
                this.normalTradeExternal(r, ALICE, false, uint128(IERC20(r.token).balanceOf(ALICE)));
                vm.warp(PoolGamesV1(_module(r, 0)).pausedUntil());
                this.normalTradeExternal(r, BOB, false, uint128(IERC20(r.token).balanceOf(BOB)));
            } else if (kind == 8) {
                vm.prank(ALICE);
                IERC20(r.token).transfer(BOB, 1 ether);
                this.normalTradeExternal(r, BOB, true, 0.001 ether);
                this.normalTradeExternal(r, BOB, false, uint128(IERC20(r.token).balanceOf(BOB)));
            } else if (kind >= 9) {
                this.normalTradeExternal(ref, ALICE, false, uint128(IERC20(ref.token).balanceOf(ALICE)));
                if (kind == 10) {
                    assertTrue(LinkedPoolV1(_module(r, 0)).unlocked());
                    this.normalTradeExternal(r, ALICE, true, 0.001 ether);
                }
            }
            uint256 remaining = IERC20(r.token).balanceOf(ALICE);
            if (remaining > 0) this.normalTradeExternal(r, ALICE, false, uint128(remaining));
            assertEq(IERC20(r.token).balanceOf(ALICE), 0);
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function normalExecuteExternal(L.LaunchResultV2 memory r) external {
        _execute(r, 0);
    }

    function testNormalValuationBuybackBurn() public {
        _normalScenario(0);
    }

    function testNormalValuationDipBuyback() public {
        _normalScenario(1);
    }

    function testNormalValuationLPRewards() public {
        _normalScenario(2);
    }

    function testNormalValuationFullRangeLP() public {
        _normalScenario(3);
    }

    function testNormalValuationBuyerRewards() public {
        _normalScenario(4);
    }

    function testNormalValuationNthBuyPot() public {
        _normalScenario(5);
    }

    function testNormalValuationKingOfTheHill() public {
        _normalScenario(6);
    }

    function testNormalValuationHotPotato() public {
        _normalScenario(7);
    }

    function testNormalValuationPlague() public {
        _normalScenario(8);
    }

    function testNormalValuationReactivePair() public {
        _normalScenario(9);
    }

    function testNormalValuationEntangled() public {
        _normalScenario(10);
    }

    function _execute(L.LaunchResultV2 memory r, uint256 i) internal {
        FoundationHookV2(r.hook).executeModuleAction(i, abi.encodePacked(bytes4(keccak256("execute()"))));
    }

    function _zeroFundingLaunch(uint8 kind) internal {
        for (uint256 ordering; ordering < 2; ++ordering) {
            uint256 snapshot = vm.snapshotState();
            bool quoteFirst = ordering == 0;
            L.LaunchResultV2 memory referencePool;
            if (kind >= 9) referencePool = _launchModules(hex"", quoteFirst, 1 ether, address(0));
            // An empty quote balance and no allowance prove this launch needs neither a
            // first buy nor creator-funded liquidity. Gas is not modeled by prank calls.
            vm.startPrank(ALICE);
            quote.approve(address(factory), 0);
            quote.transfer(BOB, quote.balanceOf(ALICE));
            vm.stopPrank();
            L.LaunchResultV2 memory r = _launchModules(abi.encodePacked(kind), quoteFirst, 0, referencePool.hook);
            assertEq(quote.balanceOf(ALICE), 0);
            assertEq(quote.allowance(ALICE, address(factory)), 0);
            assertEq(r.initialBuyTokenAmount, 0);
            assertEq(IERC20(r.token).balanceOf(ALICE), 0);
            assertEq(r.creatorQuotePrincipal, 0);
            assertEq(r.creatorPositionId, 0);
            assertEq(r.actualQuoteRefund, 0);
            assertGt(r.basePositionId, 0);
            assertGt(r.baseTokenPrincipal, 0);
            assertEq(IERC721(address(positions)).ownerOf(r.basePositionId), DEAD);
            assertEq(FoundationHookV2(r.hook).moduleCount(), 1);
            assertEq(FoundationLedgerV1(r.ledger).creatorReceived(), 0);
            quote.mint(ALICE, 2000 ether);
            if (kind == 10) {
                vm.expectRevert();
                this.tradeExternal(r, true, true, 1 ether);
                _trade(referencePool, true, true, 1000 ether);
            }
            _trade(r, true, true, 1 ether);
            assertGt(IERC20(r.token).balanceOf(ALICE), 0);
            if (kind == 7) vm.warp(PoolGamesV1(_module(r, 0)).pausedUntil());
            _trade(r, false, true, IERC20(r.token).balanceOf(ALICE));
            assertEq(IERC20(r.token).balanceOf(ALICE), 0);
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function testZeroFundingBuybackBurn() public {
        _zeroFundingLaunch(0);
    }

    function testZeroFundingDipBuyback() public {
        _zeroFundingLaunch(1);
    }

    function testZeroFundingLPRewards() public {
        _zeroFundingLaunch(2);
    }

    function testZeroFundingFullRangeLP() public {
        _zeroFundingLaunch(3);
    }

    function testZeroFundingBuyerRewards() public {
        _zeroFundingLaunch(4);
    }

    function testZeroFundingNthBuyPot() public {
        _zeroFundingLaunch(5);
    }

    function testZeroFundingKingOfTheHill() public {
        _zeroFundingLaunch(6);
    }

    function testZeroFundingHotPotato() public {
        _zeroFundingLaunch(7);
    }

    function testZeroFundingPlague() public {
        _zeroFundingLaunch(8);
    }

    function testZeroFundingReactivePair() public {
        _zeroFundingLaunch(9);
    }

    function testZeroFundingEntangled() public {
        _zeroFundingLaunch(10);
    }

    function testEightModuleCompositionWithColdStorage() public {
        P.LaunchParamsV3 memory p = _params(true, 1000, 1000, 0, 1 ether);
        p.modules = new T.ModuleSelection[](8);
        p.modules[0] = _selection(8, address(0), 0);
        p.modules[1] = _selection(7, address(0), 0);
        for (uint8 i; i < 4; ++i) {
            p.modules[i + 2] = _selection(i, address(0), 2500);
        }
        for (uint256 i; i < 2; ++i) {
            string memory name = i == 0 ? "GrowingBuyLimitFactoryV1" : "BuyWindowFactoryV1";
            IFoundationModuleFactoryV1 f = IFoundationModuleFactoryV1(deployCode(string.concat(name, ".sol:", name)));
            bytes memory config = i == 0
                ? abi.encode(uint16(100), uint16(500), uint32(600))
                : abi.encode(uint8(block.timestamp / 1 hours % 24), uint8(4));
            T.ModuleContext memory c =
                T.ModuleContext(address(this), address(1), address(quote), ALICE, address(3), bytes32(uint256(1)));
            address sample = f.createModule(c, config);
            p.modules[i + 6] = T.ModuleSelection(
                address(f),
                address(f).codehash,
                sample.codehash,
                keccak256(abi.encode(IFoundationModuleV1(sample).descriptor())),
                config,
                0
            );
        }
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        vm.warp(block.timestamp + 300);
        VmColdStorage(address(vm)).cool(r.hook);
        for (uint256 i; i < 8; ++i) {
            VmColdStorage(address(vm)).cool(_module(r, i));
        }
        VmColdStorage(address(vm)).cool(r.hook);
        _trade(r, true, true, 0.1 ether);
        _execute(r, 2);
        assertGt(FeeStrategyV1(_module(r, 2)).totalBurned(), 0);
    }

    function testBuybackBurnQuoteFirst() public {
        _buyback(true, false);
    }

    function testBuybackBurnTokenFirst() public {
        _buyback(false, false);
    }

    function testBuybackBurnSixDecimalQuote() public {
        _buyback(true, true);
    }

    function _buyback(bool quoteFirst, bool sixDecimals) private {
        if (sixDecimals) {
            quote = new FoundationQuoteFixture(6);
            quote.mint(ALICE, 1_000_000e6);
            vm.prank(ALICE);
            quote.approve(address(factory), type(uint256).max);
        }
        L.LaunchResultV2 memory r = _launchModules(hex"00", quoteFirst, sixDecimals ? 1e6 : 1 ether, address(0));
        FeeStrategyV1 m = FeeStrategyV1(_module(r, 0));
        vm.expectRevert();
        FoundationHookV2(r.hook).executeModuleAction(0, abi.encodePacked(bytes4(keccak256("execute()"))));
        vm.warp(block.timestamp + 300);
        uint256 supply = IERC20(r.token).totalSupply();
        uint256 platform = FoundationLedgerV1(r.ledger).platformReceived();
        _execute(r, 0);
        assertGt(m.totalBurned(), 0);
        assertEq(IERC20(r.token).totalSupply(), supply - m.totalBurned());
        assertGt(FoundationLedgerV1(r.ledger).platformReceived(), platform);
        assertEq(FoundationLedgerV1(r.ledger).platformClaimed(), 0);
        assertEq(quote.allowance(address(m), PERMIT2), 0);
        assertEq(IERC20(r.token).balanceOf(address(m)), 0);
        assertEq(FoundationLedgerV1(r.ledger).moduleClaimed(address(m)), m.totalQuoteUsed());
        vm.expectRevert();
        FoundationHookV2(r.hook).executeModuleAction(0, abi.encodePacked(bytes4(keccak256("execute()"))));
    }

    function testDipBuybackWaitsForDrop() public {
        L.LaunchResultV2 memory r = _launchModules(hex"01", true, 1000 ether, address(0));
        FeeStrategyV1 m = FeeStrategyV1(_module(r, 0));
        vm.warp(block.timestamp + 300);
        vm.expectRevert();
        FoundationHookV2(r.hook).executeModuleAction(0, abi.encodePacked(bytes4(keccak256("execute()"))));
        _trade(r, false, true, IERC20(r.token).balanceOf(ALICE));
        _execute(r, 0);
        assertGt(m.totalBurned(), 0);
    }

    function testLPRewardsDonateOnlyAssignedBudget() public {
        L.LaunchResultV2 memory r = _launchModules(hex"02", true, 1 ether, address(0));
        FeeStrategyV1 m = FeeStrategyV1(_module(r, 0));
        uint128 liquidity = manager.getLiquidity(PoolId.wrap(r.poolId));
        (uint256 g0, uint256 g1) = manager.getFeeGrowthGlobals(PoolId.wrap(r.poolId));
        _execute(r, 0);
        (uint256 h0, uint256 h1) = manager.getFeeGrowthGlobals(PoolId.wrap(r.poolId));
        assertTrue(h0 > g0 || h1 > g1);
        assertEq(manager.getLiquidity(PoolId.wrap(r.poolId)), liquidity);
        assertEq(m.totalQuoteUsed(), 0.01 ether);
        assertEq(m.lockedLiquidity(), 0);
    }

    function testFullRangeLPQuoteFirst() public {
        _fullRange(true);
    }

    function testFullRangeLPTokenFirst() public {
        _fullRange(false);
    }

    function _fullRange(bool quoteFirst) private {
        L.LaunchResultV2 memory r = _launchModules(hex"03", quoteFirst, 1 ether, address(0));
        FeeStrategyV1 m = FeeStrategyV1(_module(r, 0));
        vm.warp(block.timestamp + 300);
        uint128 liquidity = manager.getLiquidity(PoolId.wrap(r.poolId));
        _execute(r, 0);
        assertGt(m.lockedLiquidity(), 0);
        assertEq(manager.getLiquidity(PoolId.wrap(r.poolId)), liquidity + m.lockedLiquidity());
        vm.warp(m.nextExecutionAt());
        _execute(r, 0);
        assertEq(quote.balanceOf(address(m)), m.quoteInventory());
        assertEq(IERC20(r.token).balanceOf(address(m)), m.tokenInventory());
        // Unsolicited transfers must not alter the next batch size or be mistaken for accounted inventory.
        quote.mint(address(m), 1_000_000 ether);
        vm.warp(m.nextExecutionAt());
        _execute(r, 0);
        assertEq(quote.balanceOf(address(m)), m.quoteInventory() + 1_000_000 ether);
    }

    function testRewardsPotKingComposeWithBuyback() public {
        L.LaunchResultV2 memory r = _launchModules(hex"00040506", true, 1 ether, address(0));
        BuyerRewardsV1 reward = BuyerRewardsV1(_module(r, 1));
        BuyerRewardsV1 pot = BuyerRewardsV1(_module(r, 2));
        BuyerRewardsV1 king = BuyerRewardsV1(_module(r, 3));
        assertGt(reward.owed(ALICE), 0);
        assertEq(pot.qualifyingBuys(), 1);
        assertEq(king.king(), ALICE);
        vm.warp(block.timestamp + 300);
        vm.roll(block.number + 1);
        _execute(r, 0);
        assertEq(pot.qualifyingBuys(), 1);
        assertEq(king.king(), ALICE);
        _trade(r, true, true, 1 ether);
        assertEq(pot.qualifyingBuys(), 2);
        assertGt(pot.owed(ALICE), 0);
        address[] memory recipients = new address[](1);
        recipients[0] = ALICE;
        for (uint256 i = 1; i < 4; ++i) {
            BuyerRewardsV1 m = BuyerRewardsV1(_module(r, i));
            uint256 owedBefore = m.owed(ALICE);
            uint256 balance = quote.balanceOf(ALICE);
            vm.prank(BOB);
            FoundationHookV2(r.hook).executeModuleAction(i, abi.encodePacked(m.PAY(), abi.encode(recipients)));
            assertEq(quote.balanceOf(ALICE), balance + owedBefore);
            assertEq(m.owed(ALICE), 0);
            assertEq(m.reserve() + m.totalOwed() + m.totalPaid(), m.accountedCredits());
        }
    }

    function testHotPotatoFirstBuyAndTimedSell() public {
        L.LaunchResultV2 memory r = _launchModules(hex"07", true, 1 ether, address(0));
        PoolGamesV1 m = PoolGamesV1(_module(r, 0));
        assertEq(m.lastBuyer(), ALICE);
        vm.expectRevert();
        this.tradeExternal(r, false, true, 1 ether);
        vm.warp(m.pausedUntil());
        _trade(r, false, true, IERC20(r.token).balanceOf(ALICE));
    }

    function testPlagueCreatorCanSeedAndSell() public {
        L.LaunchResultV2 memory r = _launchModules(hex"08", true, 1 ether, address(0));
        assertGt(IERC20(r.token).balanceOf(ALICE), 0);
        _trade(r, false, true, IERC20(r.token).balanceOf(ALICE));
    }

    function testReactivePairReadsReferenceAndKeepsSellsOpen() public {
        L.LaunchResultV2 memory ref = _launchModules(hex"", true, 1 ether, address(0));
        L.LaunchResultV2 memory r = _launchModules(hex"09", true, 1 ether, ref.hook);
        LinkedPoolV1 m = LinkedPoolV1(_module(r, 0));
        uint256 beforeCap = m.currentCap();
        _trade(ref, true, true, 1000 ether);
        assertGt(m.currentCap(), beforeCap);
        assertLe(m.currentCap(), T.TOKEN_SUPPLY * 500 / 10_000);
        _trade(r, false, true, IERC20(r.token).balanceOf(ALICE));
    }

    function testEntangledOpensOnceAndDoesNotRelock() public {
        L.LaunchResultV2 memory ref = _launchModules(hex"", true, 1 ether, address(0));
        L.LaunchResultV2 memory r = _launchModules(hex"0a", true, 0, ref.hook);
        LinkedPoolV1 m = LinkedPoolV1(_module(r, 0));
        vm.expectRevert();
        this.tradeExternal(r, true, true, 1 ether);
        _trade(ref, true, true, 1000 ether);
        _trade(r, true, true, 1 ether);
        assertTrue(m.unlocked());
        _trade(ref, false, true, IERC20(ref.token).balanceOf(ALICE));
        _trade(r, true, true, 1 ether);
        _trade(r, false, true, IERC20(r.token).balanceOf(ALICE));
    }
}

contract EconomicModulesRobinhoodForkTest is EconomicModulesForkBase {
    bool private _legacyHost;

    function setUp() public override {
        super.setUp();
        string memory file = vm.envOr("ECONOMIC_HOST_MANIFEST", string(""));
        if (bytes(file).length == 0) return;
        string memory json = vm.readFile(file);
        address target = vm.parseJsonAddress(json, ".chains.c4663.hostFactory");
        assertEq(target.codehash, vm.parseJsonBytes32(json, ".chains.c4663.hostFactoryCodeHash"));
        factory = FoundationFactoryV3(target);
        deployer = FoundationHookDeployerV2(address(FoundationFactoryV2(target).hookDeployer()));
        _legacyHost = true;
        vm.prank(ALICE);
        quote.approve(target, type(uint256).max);
    }

    function _legacyParams(P.LaunchParamsV3 memory p) private pure returns (T.LaunchParams memory) {
        require(p.creatorBuyFeeBps == p.creatorSellFeeBps, "Legacy host uses symmetric fees");
        return T.LaunchParams({
            metadata: p.metadata,
            tokenSalt: p.tokenSalt,
            hookSalt: p.hookSalt,
            quote: p.quote,
            quoteDecimals: p.quoteDecimals,
            initialTick: p.initialTick,
            creatorFeeBps: p.creatorBuyFeeBps,
            additionalQuoteAmount: p.additionalQuoteAmount,
            initialBuyQuoteAmount: p.initialBuyQuoteAmount,
            initialBuyMinimumTokenAmount: p.initialBuyMinimumTokenAmount,
            deadline: p.deadline,
            modules: p.modules
        });
    }

    function _mine(P.LaunchParamsV3 memory p) internal view override {
        if (!_legacyHost) return super._mine(p);
        FoundationFactoryV2 legacy = FoundationFactoryV2(address(factory));
        address token = legacy.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        bytes32 initHash = legacy.hookInitCodeHash(ALICE, token, _legacyParams(p));
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        for (uint256 i;; ++i) {
            p.hookSalt = bytes32(i);
            address predicted = vm.computeCreate2Address(p.hookSalt, initHash, address(deployer));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags) return;
        }
    }

    function _launch(P.LaunchParamsV3 memory p) internal override returns (L.LaunchResultV2 memory) {
        if (!_legacyHost) return super._launch(p);
        vm.prank(ALICE);
        return FoundationFactoryV2(address(factory)).launch(_legacyParams(p));
    }

    function _creatorFee(FoundationHookV2 hook, bool buy) internal view override returns (uint16) {
        return _legacyHost ? FoundationHookV1(address(hook)).creatorFeeBps() : super._creatorFee(hook, buy);
    }
}

contract EconomicModulesEthereumForkTest is EconomicModulesForkBase {
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
