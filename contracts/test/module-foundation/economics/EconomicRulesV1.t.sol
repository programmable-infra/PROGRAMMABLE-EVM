// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { FoundationTypesV1 as T } from "../../../src/module-foundation/FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../../src/module-foundation/IFoundationModuleV1.sol";
import {
    SharedModuleBaseV1,
    SharedBindingsV1,
    ISharedHostV1
} from "../../../src/module-foundation/modules/economics/SharedModuleBaseV1.sol";
import { BuyerRewardsV1 } from "../../../src/module-foundation/modules/economics/BuyerRewardsV1.sol";
import { PoolGamesV1 } from "../../../src/module-foundation/modules/economics/PoolGamesV1.sol";
import { PoolPriceWindowV1 } from "../../../src/module-foundation/modules/economics/PoolPriceWindowV1.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract EconomyTokenFixture is ERC20 {
    bool public fail;
    constructor() ERC20("Fixture", "FIX") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFail(bool value) external {
        fail = value;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(!fail, "transfer failed");
        super._update(from, to, amount);
    }
}

contract EconomyLedgerFixture {
    EconomyTokenFixture public quote;
    mapping(address => uint256) public moduleCredited;
    mapping(address => uint256) public moduleClaimed;
    mapping(address => uint16) public moduleShareBps;

    function setShare(address module, uint16 share) external {
        moduleShareBps[module] = share;
    }

    constructor(EconomyTokenFixture q) {
        quote = q;
    }

    function accrue(address m, uint256 amount) external {
        moduleCredited[m] += amount;
        quote.mint(address(this), amount);
    }

    function claimModule(uint256 amount) external {
        require(moduleClaimed[msg.sender] + amount <= moduleCredited[msg.sender], "unbacked");
        moduleClaimed[msg.sender] += amount;
        quote.transfer(msg.sender, amount);
    }
}

contract EconomyRouterFixture {
    address public msgSender;

    function setActor(address actor) external {
        msgSender = actor;
    }
}

contract EconomyManagerFixture {
    mapping(bytes32 => bytes32) public values;

    function setTick(bytes32 pool, int24 tick) external {
        values[keccak256(abi.encode(pool, uint256(6)))] = bytes32((uint256(uint24(tick)) << 160) | uint256(1 << 96));
    }

    function extsload(bytes32 slot) external view returns (bytes32) {
        return values[slot];
    }
}

contract EconomyHostFixture {
    address public initializer = address(0xFACADE);
    address[] public modules;

    function add(address m) external {
        modules.push(m);
    }

    function moduleCount() external view returns (uint256) {
        return modules.length;
    }

    function moduleAt(uint256 i) external view returns (ISharedHostV1.Module memory m) {
        m.instance = modules[i];
    }

    function beforeSwap(IFoundationModuleV1 m, T.SwapContext memory s) external {
        m.onBeforeSwap(s);
    }

    function afterSwap(IFoundationModuleV1 m, T.SwapContext memory s) external {
        m.onAfterSwap(s);
    }

    function action(IFoundationModuleV1 m, bytes memory d) external {
        m.onAction(msg.sender, d);
    }
}

contract PriceWindowFixture is PoolPriceWindowV1 {
    function observe(EconomyManagerFixture manager, bytes32 pool) external {
        _beforePrice(IPoolManager(address(manager)), pool);
    }

    function afterPrice(EconomyManagerFixture manager, bytes32 pool) external {
        _afterPrice(IPoolManager(address(manager)), pool);
    }
}

contract EconomicRulesV1Test is Test {
    EconomyTokenFixture token;
    EconomyTokenFixture quote;
    EconomyLedgerFixture ledger;
    EconomyHostFixture host;
    EconomyRouterFixture router;
    EconomyManagerFixture manager;
    SharedBindingsV1.Bindings b;
    T.ModuleContext c;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    bytes32 constant POOL = bytes32(uint256(1));

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(50);
        token = new EconomyTokenFixture();
        quote = new EconomyTokenFixture();
        ledger = new EconomyLedgerFixture(quote);
        host = new EconomyHostFixture();
        router = new EconomyRouterFixture();
        manager = new EconomyManagerFixture();
        b = SharedBindingsV1.Bindings(
            address(manager),
            address(router),
            address(quote),
            address(manager).codehash,
            address(router).codehash,
            address(quote).codehash
        );
        c = T.ModuleContext(address(host), address(token), address(quote), ALICE, address(ledger), POOL);
    }

    function _reward(BuyerRewardsV1.Kind kind) internal returns (BuyerRewardsV1 m) {
        m = new BuyerRewardsV1(
            c,
            abi.encode(
                uint128(100),
                uint16(kind == BuyerRewardsV1.Kind.BuyerRewards ? 100 : 0),
                uint32(kind == BuyerRewardsV1.Kind.NthBuyPot ? 3 : 0),
                uint32(kind == BuyerRewardsV1.Kind.KingOfTheHill ? 300 : 0)
            ),
            b,
            kind
        );
        host.add(address(m));
    }

    function _swap(bool buy, uint256 amount) internal view returns (T.SwapContext memory) {
        return T.SwapContext(POOL, address(router), buy, true, amount, amount, 1, 1);
    }

    function _buy(BuyerRewardsV1 m, address actor, uint256 amount, uint256 fee) internal {
        router.setActor(actor);
        ledger.accrue(address(m), fee);
        host.afterSwap(m, _swap(true, amount));
    }

    function _pay(BuyerRewardsV1 m, address who) internal {
        address[] memory recipients = new address[](1);
        recipients[0] = who;
        host.action(m, abi.encodePacked(bytes4(keccak256("pay(address[])")), abi.encode(recipients)));
    }

    function testBuyerRewardBudgetAndPermissionlessPayment() public {
        BuyerRewardsV1 m = _reward(BuyerRewardsV1.Kind.BuyerRewards);
        _buy(m, ALICE, 10_000, 70);
        assertEq(m.owed(ALICE), 70);
        assertEq(m.reserve(), 0);
        vm.prank(BOB);
        _pay(m, ALICE);
        assertEq(quote.balanceOf(ALICE), 70);
        assertEq(quote.balanceOf(BOB), 0);
        _pay(m, ALICE);
        assertEq(quote.balanceOf(ALICE), 70);
    }

    function testFuzzRewardsNeverExceedBacking(uint128 fee, uint128 gross) public {
        BuyerRewardsV1 m = _reward(BuyerRewardsV1.Kind.BuyerRewards);
        _buy(m, ALICE, gross, fee);
        assertEq(m.reserve() + m.totalOwed() + m.totalPaid(), ledger.moduleCredited(address(m)));
        _pay(m, ALICE);
        assertEq(m.reserve() + m.totalOwed() + m.totalPaid(), ledger.moduleCredited(address(m)));
        assertLe(m.totalPaid(), fee);
    }

    function testPaymentFailureRollsBackEntitlementAndLedger() public {
        BuyerRewardsV1 m = _reward(BuyerRewardsV1.Kind.BuyerRewards);
        _buy(m, ALICE, 10_000, 70);
        quote.setFail(true);
        vm.expectRevert();
        _pay(m, ALICE);
        assertEq(m.owed(ALICE), 70);
        assertEq(ledger.moduleClaimed(address(m)), 0);
    }

    function testNthPotQualifiesOncePerBlockAndPaysThirdBuyer() public {
        BuyerRewardsV1 m = _reward(BuyerRewardsV1.Kind.NthBuyPot);
        _buy(m, ALICE, 100, 10);
        _buy(m, BOB, 100, 20);
        assertEq(m.qualifyingBuys(), 1);
        vm.roll(51);
        _buy(m, ALICE, 99, 30);
        assertEq(m.qualifyingBuys(), 1);
        _buy(m, ALICE, 100, 40);
        vm.roll(52);
        _buy(m, BOB, 100, 50);
        assertEq(m.owed(BOB), 150);
        assertEq(m.owed(ALICE), 0);
        assertEq(m.reserve(), 0);
        _pay(m, BOB);
        assertEq(quote.balanceOf(BOB), 150);
    }

    function testInternalFeeStrategyCannotWinOrAdvancePot() public {
        BuyerRewardsV1 m = _reward(BuyerRewardsV1.Kind.NthBuyPot);
        host.add(address(0xFEE));
        ledger.setShare(address(0xFEE), 1000);
        _buy(m, address(0xFEE), 1000, 10);
        assertEq(m.qualifyingBuys(), 0);
        assertEq(m.reserve(), 10);
        _buy(m, host.initializer(), 1000, 10);
        assertEq(m.qualifyingBuys(), 1);
    }

    function testKingEarnsBeforeChallengerAndLosesCrownOnSale() public {
        BuyerRewardsV1 m = _reward(BuyerRewardsV1.Kind.KingOfTheHill);
        _buy(m, ALICE, 500, 10);
        assertEq(m.king(), ALICE);
        _buy(m, BOB, 501, 20);
        assertEq(m.king(), BOB);
        assertEq(m.owed(ALICE), 30);
        vm.warp(block.timestamp + 300);
        assertEq(m.crownThreshold(), 100);
        _buy(m, ALICE, 101, 30);
        assertEq(m.king(), ALICE);
        assertEq(m.owed(BOB), 30);
        router.setActor(ALICE);
        host.afterSwap(m, _swap(false, 100));
        assertEq(m.king(), address(0));
    }

    function testUnauthorizedCallbacksAndMalformedActions() public {
        BuyerRewardsV1 m = _reward(BuyerRewardsV1.Kind.BuyerRewards);
        vm.expectRevert(SharedModuleBaseV1.OnlyHost.selector);
        m.onAfterSwap(_swap(true, 1000));
        T.SwapContext memory s = _swap(true, 1000);
        s.poolId = bytes32(uint256(2));
        vm.expectRevert(SharedModuleBaseV1.InvalidContext.selector);
        host.afterSwap(m, s);
        vm.expectRevert();
        host.action(m, hex"12345678");
    }

    function testHotPotatoChangesBuyerAndAlwaysExpires() public {
        PoolGamesV1 m = new PoolGamesV1(c, abi.encode(uint128(100), uint32(60)), b, PoolGamesV1.Kind.HotPotato);
        router.setActor(ALICE);
        host.afterSwap(m, _swap(true, 100));
        vm.expectRevert();
        host.beforeSwap(m, _swap(false, 100));
        router.setActor(BOB);
        host.beforeSwap(m, _swap(false, 100));
        host.afterSwap(m, _swap(true, 100));
        router.setActor(ALICE);
        host.beforeSwap(m, _swap(false, 100));
        router.setActor(BOB);
        vm.warp(m.pausedUntil());
        host.beforeSwap(m, _swap(false, 100));
    }

    function testHotPotatoRejectsUnboundedPauseAndUnsupportedSellRouter() public {
        vm.expectRevert();
        new PoolGamesV1(c, abi.encode(uint128(100), uint32(0)), b, PoolGamesV1.Kind.HotPotato);
        PoolGamesV1 m = new PoolGamesV1(c, abi.encode(uint128(100), uint32(60)), b, PoolGamesV1.Kind.HotPotato);
        router.setActor(ALICE);
        host.afterSwap(m, _swap(true, 100));
        T.SwapContext memory s = _swap(false, 100);
        s.router = address(0xBAD);
        vm.expectRevert(SharedModuleBaseV1.UnsupportedRouter.selector);
        host.beforeSwap(m, s);
        vm.warp(m.pausedUntil());
        host.beforeSwap(m, s);
    }

    function testPlagueRequiresExistingTokensButAlwaysAllowsSelling() public {
        PoolGamesV1 m = new PoolGamesV1(c, abi.encode(uint128(100), uint32(0)), b, PoolGamesV1.Kind.Plague);
        router.setActor(ALICE);
        host.beforeSwap(m, _swap(true, 100));
        router.setActor(BOB);
        vm.expectRevert();
        host.beforeSwap(m, _swap(true, 100));
        host.beforeSwap(m, _swap(false, 100));
        token.mint(BOB, 100);
        host.beforeSwap(m, _swap(true, 100));
        vm.prank(BOB);
        token.transfer(ALICE, 1);
        vm.expectRevert();
        host.beforeSwap(m, _swap(true, 100));
    }

    function testPriceWindowNeedsHistoryAndWeightsTimeNotTradeCount() public {
        PriceWindowFixture m = new PriceWindowFixture();
        manager.setTick(POOL, 100);
        m.observe(manager, POOL);
        vm.expectRevert(PoolPriceWindowV1.PriceUnavailable.selector);
        m.averageTick(300);
        vm.warp(block.timestamp + 200);
        m.observe(manager, POOL);
        manager.setTick(POOL, 400);
        m.afterPrice(manager, POOL);
        // Many transactions at the same timestamp cannot create historical time.
        for (uint256 i; i < 20; ++i) {
            m.observe(manager, POOL);
        }
        vm.warp(block.timestamp + 100);
        assertEq(m.averageTick(300), 200);
    }

    function testPriceWindowRetainsFullWindowAfterRingWrap() public {
        PriceWindowFixture m = new PriceWindowFixture();
        manager.setTick(POOL, -101);
        m.observe(manager, POOL);
        uint256 start = block.timestamp;
        for (uint256 i; i < 32; ++i) {
            vm.warp(start + (i + 1) * 60);
            m.observe(manager, POOL);
            m.afterPrice(manager, POOL);
        }
        assertEq(m.averageTick(600), -101);
    }
}
