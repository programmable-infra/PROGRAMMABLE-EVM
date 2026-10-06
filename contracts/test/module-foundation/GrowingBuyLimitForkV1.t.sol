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
import { IFoundationModuleFactoryV1 } from "../../src/module-foundation/IFoundationModuleV1.sol";
import { GrowingBuyLimitV1 } from "../../src/module-foundation/modules/growing-buy-limit/GrowingBuyLimitV1.sol";
import {
    GrowingBuyLimitFactoryV1
} from "../../src/module-foundation/modules/growing-buy-limit/GrowingBuyLimitFactoryV1.sol";
import { LaunchWalletCapV1 } from "../../src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GrowingWalletCapFactoryFixture is IFoundationModuleFactoryV1 {
    address private router;

    constructor(address router_) {
        router = router_;
    }

    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        require(msg.sender == c.host);
        return address(new LaunchWalletCapV1(c, configuration, router, router.codehash));
    }
}

abstract contract GrowingBuyLimitForkBase is FoundationForkBaseV3 {
    function _growingSelection() internal returns (T.ModuleSelection memory) {
        GrowingBuyLimitFactoryV1 f = new GrowingBuyLimitFactoryV1();
        T.ModuleContext memory c =
            T.ModuleContext(address(this), address(1), address(2), ALICE, address(3), bytes32(uint256(1)));
        bytes memory config = abi.encode(uint16(50), uint16(500), uint32(600));
        GrowingBuyLimitV1 sample = new GrowingBuyLimitV1(c, config);
        return T.ModuleSelection(
            address(f),
            address(f).codehash,
            address(sample).codehash,
            keccak256(abi.encode(sample.descriptor())),
            config,
            0
        );
    }

    function _walletSelection() internal returns (T.ModuleSelection memory) {
        GrowingWalletCapFactoryFixture f = new GrowingWalletCapFactoryFixture(ROUTER);
        T.ModuleContext memory c =
            T.ModuleContext(address(this), address(1), address(2), ALICE, address(3), bytes32(uint256(1)));
        bytes memory config = abi.encode(uint16(200), uint32(60));
        LaunchWalletCapV1 sample = new LaunchWalletCapV1(c, config, ROUTER, ROUTER.codehash);
        return T.ModuleSelection(
            address(f),
            address(f).codehash,
            address(sample).codehash,
            keccak256(abi.encode(sample.descriptor())),
            config,
            0
        );
    }

    function test_growingLimitQuoteFirstLifecycle() public {
        _lifecycle(true);
    }

    function test_growingLimitTokenFirstLifecycle() public {
        _lifecycle(false);
    }

    function _lifecycle(bool quoteFirst) internal {
        P.LaunchParamsV3 memory p = _params(quoteFirst, 100, 300, 0, 0);
        p.modules = new T.ModuleSelection[](1);
        p.modules[0] = _growingSelection();
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        GrowingBuyLimitV1 instance = GrowingBuyLimitV1(FoundationHookV2(r.hook).moduleAt(0).instance);
        uint256 limit = instance.currentTokenLimit();
        this.tradeExternal(r, true, false, limit);
        uint256 balance = IERC20(r.token).balanceOf(ALICE);
        uint256 fees = FoundationLedgerV1(r.ledger).platformReceived();
        vm.expectRevert();
        this.tradeExternal(r, true, false, limit + 1);
        vm.expectRevert();
        this.tradeExternal(r, true, true, 100 ether);
        assertEq(IERC20(r.token).balanceOf(ALICE), balance);
        assertEq(FoundationLedgerV1(r.ledger).platformReceived(), fees);
        vm.warp(instance.startsAt() + 300);
        this.tradeExternal(r, true, false, limit * 2);
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE));
        assertEq(IERC20(r.token).balanceOf(ALICE), 0);
    }

    function test_growingLimitCombinesWithWalletCap() public {
        P.LaunchParamsV3 memory p = _params(true, 100, 300, 0, 0);
        p.modules = new T.ModuleSelection[](2);
        p.modules[0] = _growingSelection();
        p.modules[1] = _walletSelection();
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        FoundationHookV2 host = FoundationHookV2(r.hook);
        GrowingBuyLimitV1 growing = GrowingBuyLimitV1(host.moduleAt(0).instance);
        LaunchWalletCapV1 wallet = LaunchWalletCapV1(host.moduleAt(1).instance);
        uint256 first = growing.currentTokenLimit();
        this.tradeExternal(r, true, false, first);
        vm.warp(growing.startsAt() + 300);
        this.tradeExternal(r, true, false, first * 2);
        assertEq(wallet.purchasedTokens(ALICE), first * 3);
        vm.expectRevert();
        this.tradeExternal(r, true, false, first * 2);
        this.tradeExternal(r, false, true, first * 3);
        assertEq(wallet.purchasedTokens(ALICE), first * 3);
    }

    function test_growingLimitWithSixDecimalQuoteAndFirstBuy() public {
        quote = new FoundationQuoteFixture(6);
        quote.mint(ALICE, 1_000_000e6);
        vm.prank(ALICE);
        quote.approve(address(factory), type(uint256).max);
        P.LaunchParamsV3 memory p = _params(true, 100, 300, 0, 1e6);
        // 10^12 token raw units per quote raw unit, at launch. About one token per quote token.
        p.initialTick = 276_300;
        p.modules = new T.ModuleSelection[](1);
        p.modules[0] = _growingSelection();
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        assertGt(r.initialBuyTokenAmount, 0);
        this.tradeExternal(r, true, true, 1e6);
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE));
    }
}

contract GrowingBuyLimitRobinhoodForkTest is GrowingBuyLimitForkBase { }

contract GrowingBuyLimitEthereumForkTest is GrowingBuyLimitForkBase {
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
