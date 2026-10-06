// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBaseV3 } from "./FoundationDirectionalFeesV3.t.sol";
import { FoundationEthereumFixtureV3 } from "./FoundationEthereumV3.t.sol";
import { FoundationQuoteFixture } from "./FoundationFixturesV1.sol";
import { FoundationTypesV1 as T } from "../../src/module-foundation/FoundationTypesV1.sol";
import { FoundationLaunchTypesV3 as P } from "../../src/module-foundation/FoundationLaunchTypesV3.sol";
import { FoundationLaunchTypesV2 as L } from "../../src/module-foundation/FoundationLaunchTypesV2.sol";
import { FoundationHookV2 } from "../../src/module-foundation/FoundationHookV2.sol";
import { FoundationLedgerV1 } from "../../src/module-foundation/FoundationLedgerV1.sol";
import { IFoundationModuleV1, IFoundationModuleFactoryV1 } from "../../src/module-foundation/IFoundationModuleV1.sol";
import { FeeStrategyV1 } from "../../src/module-foundation/modules/economics/FeeStrategyV1.sol";
import { BuyerRewardsV1 } from "../../src/module-foundation/modules/economics/BuyerRewardsV1.sol";
import { PoolGamesV1 } from "../../src/module-foundation/modules/economics/PoolGamesV1.sol";
import { LinkedPoolV1 } from "../../src/module-foundation/modules/economics/LinkedPoolV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";

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
        IFoundationModuleFactoryV1 f =
            IFoundationModuleFactoryV1(deployCode(string.concat("EconomicModuleFactoriesV1.sol:", names[kind])));
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
        return T.ModuleSelection(
            address(f),
            address(f).codehash,
            sample.codehash,
            keccak256(abi.encode(IFoundationModuleV1(sample).descriptor())),
            config,
            share
        );
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

    function _execute(L.LaunchResultV2 memory r, uint256 i) internal {
        FoundationHookV2(r.hook).executeModuleAction(i, abi.encodePacked(bytes4(keccak256("execute()"))));
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

contract EconomicModulesRobinhoodForkTest is EconomicModulesForkBase { }

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
