// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolDonateTest} from "@uniswap/v4-core/src/test/PoolDonateTest.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IV4Router} from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery-v211/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {FoundationTypesV1 as T} from "../../../src/module-foundation/FoundationTypesV1.sol";
import {FoundationTokenV1} from "../../../src/module-foundation/FoundationTokenV1.sol";
import {IFoundationModuleV1} from "../../../src/module-foundation/IFoundationModuleV1.sol";
import {
    TaxAutomationBaseV1 as Base
} from "../../../src/module-foundation/modules/tax-automation/TaxAutomationBaseV1.sol";
import {TaxToLiquidityV1} from "../../../src/module-foundation/modules/tax-automation/TaxToLiquidityV1.sol";
import {TaxBuybackBurnV1} from "../../../src/module-foundation/modules/tax-automation/TaxBuybackBurnV1.sol";
import {TaxLiquidityBurnV1} from "../../../src/module-foundation/modules/tax-automation/TaxLiquidityBurnV1.sol";
import {
    TaxToLiquidityFactoryV1
} from "../../../src/module-foundation/modules/tax-automation/TaxToLiquidityFactoryV1.sol";
import {
    TaxBuybackBurnFactoryV1
} from "../../../src/module-foundation/modules/tax-automation/TaxBuybackBurnFactoryV1.sol";
import {
    TaxLiquidityBurnFactoryV1
} from "../../../src/module-foundation/modules/tax-automation/TaxLiquidityBurnFactoryV1.sol";
import {
    FoundationAutomationHookV1 as Host
} from "../../../src/module-foundation/modules/tax-automation/FoundationAutomationHookV1.sol";
import {
    FoundationAutomationLedgerV1 as Ledger
} from "../../../src/module-foundation/modules/tax-automation/FoundationAutomationLedgerV1.sol";
import {
    FoundationAutomationHookDeployerV1 as Deployer
} from "../../../src/module-foundation/modules/tax-automation/FoundationAutomationHookDeployerV1.sol";
import {LaunchWalletCapV1} from "../../../src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapV1.sol";
import {
    LaunchWalletCapFactoryV1
} from "../../../src/module-foundation/modules/launch-wallet-cap/LaunchWalletCapFactoryV1.sol";
import {FoundationFactoryV3} from "../../../src/module-foundation/FoundationFactoryV3.sol";
import {FoundationHookDeployerV2} from "../../../src/module-foundation/FoundationHookDeployerV2.sol";
import {FoundationLaunchTypesV3 as P} from "../../../src/module-foundation/FoundationLaunchTypesV3.sol";
import {FoundationLaunchTypesV2 as L} from "../../../src/module-foundation/FoundationLaunchTypesV2.sol";
import {IFoundationUniversalRouterV2} from "../../../src/module-foundation/FoundationFactoryV2.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

interface IActualUniversalRouter {
    function execute(bytes calldata, bytes[] calldata, uint256) external payable;
}

contract TaxQuoteFixture is ERC20 {
    uint8 private _decimals;

    constructor(uint8 d) ERC20("Automation test quote", "QTST") {
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Real provider-observed Core/UR/Permit2 runtime, isolated fresh storage, no mocked AMM or broadcast.
contract TaxAutomationV1Test is Test {
    using stdStorage for StdStorage;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    address constant MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant POSM = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant ROUTER = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant ALICE = address(0xA11CE);
    IPoolManager manager = IPoolManager(MANAGER);
    TaxQuoteFixture quote;
    FoundationTokenV1 token;
    Host host;
    Ledger ledger;
    Deployer deployer;
    address[3] factories;
    Base[] modules;
    bool keepCreator;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_790_987_200);
        string memory fixture = vm.readFile("test/module-foundation/tax-automation/fixtures/robinhood-runtime.json");
        vm.etch(MANAGER, vm.parseJsonBytes(fixture, ".manager"));
        vm.etch(POSM, vm.parseJsonBytes(fixture, ".positions"));
        vm.etch(ROUTER, vm.parseJsonBytes(fixture, ".router"));
        vm.etch(PERMIT2, vm.parseJsonBytes(fixture, ".permit2"));
        assertEq(MANAGER.codehash, 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626);
        assertEq(POSM.codehash, 0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2);
        assertEq(ROUTER.codehash, 0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5);
        assertEq(PERMIT2.codehash, 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca);
        deployer = new Deployer();
        factories = [
            address(new TaxToLiquidityFactoryV1(manager)),
            address(new TaxBuybackBurnFactoryV1(manager)),
            address(new TaxLiquidityBurnFactoryV1(manager))
        ];
    }

    function _configuration(uint8 kind) internal pure returns (bytes memory) {
        return abi.encode(Base.Configuration(1e12, 1e20, 500, 60, kind == 0 ? 10000 : kind == 1 ? 0 : 5000));
    }

    function _selection(uint8 kind, uint16 share) internal view returns (T.ModuleSelection memory) {
        bytes32 id = keccak256(
            bytes(
                kind == 0
                    ? "programmable.foundation.tax-to-liquidity.v1"
                    : kind == 1
                        ? "programmable.foundation.tax-buyback-burn.v1"
                        : "programmable.foundation.tax-liquidity-burn.v1"
            )
        );
        bytes32 codeHash = kind == 0
            ? keccak256(type(TaxToLiquidityV1).runtimeCode)
            : kind == 1
                ? keccak256(type(TaxBuybackBurnV1).runtimeCode)
                : keccak256(type(TaxLiquidityBurnV1).runtimeCode);
        T.Descriptor memory d = T.Descriptor(id, 1, 7, 1, 100000, 650000, 1500000, true, bytes32(0));
        return T.ModuleSelection(
            factories[kind], factories[kind].codehash, codeHash, keccak256(abi.encode(d)), _configuration(kind), share
        );
    }

    function _init(uint8 kind, bool quote0, uint8 decimals_, bool cap, bool all) internal {
        quote = new TaxQuoteFixture(decimals_);
        T.Metadata memory metadata = T.Metadata("Automation test coin", "ATST", "", "ipfs://test", "", bytes(""));
        bytes32 initHash =
            keccak256(abi.encodePacked(type(FoundationTokenV1).creationCode, abi.encode(metadata, address(this))));
        bytes32 tokenSalt;
        for (uint256 i;; ++i) {
            tokenSalt = bytes32(i);
            if ((address(quote) < vm.computeCreate2Address(tokenSalt, initHash, address(this))) == quote0) break;
        }
        token = new FoundationTokenV1{salt: tokenSalt}(metadata, address(this));
        uint256 count = all ? 3 : 1;
        T.ModuleSelection[] memory choices = new T.ModuleSelection[](count + (cap ? 1 : 0));
        for (uint8 i; i < count; ++i) {
            choices[i] = _selection(all ? i : kind, all ? (i == 2 ? 4000 : 3000) : keepCreator ? 6000 : 10000);
        }
        if (cap) {
            LaunchWalletCapFactoryV1 f = new LaunchWalletCapFactoryV1();
            T.Descriptor memory d = T.Descriptor(
                keccak256("programmable.foundation.launch-wallet-cap.v1"),
                1,
                3,
                0,
                100000,
                100000,
                0,
                false,
                keccak256("programmable.foundation.launch-wallet-cap")
            );
            choices[count] = T.ModuleSelection(
                address(f),
                address(f).codehash,
                keccak256(type(LaunchWalletCapV1).runtimeCode),
                keccak256(abi.encode(d)),
                abi.encode(uint16(1), uint32(3)),
                0
            );
        }
        bytes32 hookHash =
            deployer.initCodeHash(manager, address(this), address(token), address(quote), ALICE, 0, 500, 500, choices);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        bytes32 salt;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            if (uint160(vm.computeCreate2Address(salt, hookHash, address(deployer))) & Hooks.ALL_HOOK_MASK == flags) {
                break;
            }
        }
        host = deployer.deploy(manager, address(token), address(quote), ALICE, 0, 500, 500, choices, salt);
        ledger = host.ledger();
        for (uint256 i; i < count; ++i) {
            modules.push(Base(host.moduleAt(i).instance));
        }
        manager.initialize(host.poolKey(), TickMath.getSqrtPriceAtTick(0));
        PoolModifyLiquidityTest seeder = new PoolModifyLiquidityTest(manager);
        quote.mint(address(this), 1e28);
        quote.mint(ALICE, 1e25);
        quote.approve(address(seeder), type(uint256).max);
        token.approve(address(seeder), type(uint256).max);
        seeder.modifyLiquidity(
            host.poolKey(),
            ModifyLiquidityParams(TickMath.minUsableTick(60), TickMath.maxUsableTick(60), int256(1e26), bytes32(0)),
            bytes("")
        );
    }

    function _trade(bool buy, bool exactIn, uint128 amount) internal {
        address input = buy ? address(quote) : address(token);
        address output = buy ? address(token) : address(quote);
        vm.startPrank(ALICE);
        IERC20(input).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2).approve(input, ROUTER, type(uint160).max, uint48(block.timestamp + 120));
        bytes[] memory params = new bytes[](3);
        params[0] = exactIn
            ? abi.encode(IV4Router.ExactInputSingleParams(host.poolKey(), input < output, amount, 1, 0, bytes("")))
            : abi.encode(
                IV4Router.ExactOutputSingleParams(host.poolKey(), input < output, amount, uint128(1e25), 0, bytes(""))
            );
        params[1] = abi.encode(Currency.wrap(input), exactIn ? uint256(amount) : 1e25);
        params[2] = abi.encode(Currency.wrap(output), exactIn ? uint256(1) : uint256(amount));
        bytes[] memory commands = new bytes[](1);
        commands[0] = abi.encode(
            abi.encodePacked(
                uint8(exactIn ? Actions.SWAP_EXACT_IN_SINGLE : Actions.SWAP_EXACT_OUT_SINGLE),
                uint8(Actions.SETTLE_ALL),
                uint8(Actions.TAKE_ALL)
            ),
            params
        );
        IActualUniversalRouter(ROUTER).execute(hex"10", commands, block.timestamp + 120);
        vm.stopPrank();
        _assertBacking();
    }

    function _warm() internal {
        _trade(true, true, 1e18);
        vm.warp(block.timestamp + 61);
    }

    function _assertBacking() internal view {
        assertEq(manager.balanceOf(address(ledger), uint256(uint160(address(quote)))), ledger.outstandingBacking());
        assertEq(manager.getNonzeroDeltaCount(), 0);
        assertFalse(manager.isUnlocked());
        assertEq(quote.balanceOf(ROUTER), 0);
        assertEq(token.balanceOf(ROUTER), 0);
    }

    function _verifyLifecycle(uint8 kind, bool quote0, uint8 decimals_) internal {
        _init(kind, quote0, decimals_, false, false);
        _warm();
        assertEq(modules[0].processCount(), 0, "cold oracle must not spend");
        uint256 supply = token.totalSupply();
        _trade(true, true, 1e18);
        assertGt(modules[0].processCount(), 0, "automatic processing must execute");
        if (kind != 1) assertGt(modules[0].liquidityAdded(), 0, "full range position grows");
        if (kind != 1) {
            assertEq(
                manager.getPositionLiquidity(
                    PoolId.wrap(host.poolId()),
                    keccak256(
                        abi.encodePacked(
                            address(modules[0]),
                            TickMath.minUsableTick(60),
                            TickMath.maxUsableTick(60),
                            modules[0].moduleId()
                        )
                    )
                ),
                modules[0].liquidityAdded(),
                "Core position must match reported permanently locked liquidity"
            );
        }
        if (kind != 0) {
            assertGt(modules[0].tokensBurned(), 0);
            assertEq(supply - token.totalSupply(), modules[0].tokensBurned());
        } else {
            assertEq(token.totalSupply(), supply);
        }
        uint256 firstCount = modules[0].processCount();
        _trade(false, true, 1e17);
        assertGt(modules[0].processCount(), firstCount, "sell fees must also process");
        _trade(true, false, 1e16);
        _trade(false, false, 1e15);
        uint256 amount = ledger.platformReceived() - ledger.platformClaimed();
        uint256 beforeQuote = quote.balanceOf(T.PLATFORM_RECIPIENT);
        ledger.claimPlatform();
        assertEq(quote.balanceOf(T.PLATFORM_RECIPIENT) - beforeQuote, amount);
        vm.expectRevert(Ledger.NoClaim.selector);
        ledger.claimCreator();
        _assertBacking();
    }

    function test_taxLiquidityQuote0() public {
        _verifyLifecycle(0, true, 18);
    }

    function test_buybackBurnQuote1() public {
        _verifyLifecycle(1, false, 18);
    }

    function test_combinedLiquidityBurnQuote0() public {
        _verifyLifecycle(2, true, 18);
    }

    function test_anyQuoteSixDecimalsAndReverseOrder() public {
        _verifyLifecycle(2, false, 6);
    }

    function test_threeModulesAndWalletLimitTogether() public {
        _init(0, true, 18, true, true);
        _warm();
        _trade(true, true, 1e18);
        for (uint256 i; i < 3; ++i) {
            assertGt(modules[i].processCount(), 0);
        }
        LaunchWalletCapV1 walletCap = LaunchWalletCapV1(host.moduleAt(3).instance);
        assertGt(walletCap.purchasedTokens(ALICE), 0);
        assertEq(walletCap.purchasedTokens(address(modules[0])), 0, "LP buys are not personal wallet purchases");
        vm.expectRevert();
        this.tradeExcess();
        _assertBacking();
    }

    function tradeExcess() external {
        _trade(true, false, uint128(1e23 + 1));
    }

    function test_priceShockDefersProcessingWithoutBlockingUserTrade() public {
        _init(2, true, 18, false, false);
        _warm();
        _trade(true, true, 4e24);
        uint256 count = modules[0].processCount();
        _trade(true, true, 4e24);
        assertEq(modules[0].processCount(), count, "out of TWAP guard must defer");
        assertGt(ledger.moduleCredited(address(modules[0])) - ledger.moduleClaimed(address(modules[0])), 0);
    }

    function test_processingIsAutomaticButActionRetryIsPermissionlessAndBounded() public {
        _init(1, true, 18, false, false);
        _warm();
        vm.prank(address(0xB0B));
        host.executeModuleAction(0, bytes(""));
        assertGt(modules[0].processCount(), 0);
        vm.expectRevert();
        host.executeModuleAction(0, abi.encode(address(0xB0B)));
        _assertBacking();
    }

    function test_unauthorizedCallsCannotTakeBudgetsOrUnlockPositions() public {
        _init(2, true, 18, false, false);
        _warm();
        _trade(true, true, 1e18);
        vm.expectRevert(Base.OnlyProcessor.selector);
        modules[0].process();
        vm.expectRevert(Base.OnlyProcessor.selector);
        modules[0].unlockCallback(bytes(""));
        vm.expectRevert(Ledger.Unauthorized.selector);
        ledger.claimModule(1);
        vm.expectRevert(Base.OnlyHost.selector);
        modules[0].onAction(ALICE, bytes(""));
        uint128 locked = modules[0].liquidityAdded();
        vm.expectRevert();
        host.executeModuleAction(0, abi.encode(int256(-1)));
        assertEq(modules[0].liquidityAdded(), locked);
        assertEq(quote.allowance(address(modules[0]), ROUTER), 0);
        assertEq(token.allowance(address(modules[0]), ROUTER), 0);
    }

    function test_invalidConfigurationAndFactoryHostSpoofingRevert() public {
        _init(0, true, 18, false, false);
        T.ModuleContext memory c = modules[0].context();
        vm.expectRevert(TaxToLiquidityFactoryV1.OnlyBoundHost.selector);
        TaxToLiquidityFactoryV1(factories[0]).createModule(c, _configuration(0));
        vm.expectRevert(Base.InvalidConfiguration.selector);
        new TaxLiquidityBurnV1(c, abi.encode(Base.Configuration(1, 2, 500, 29, 5000)), manager);
        vm.expectRevert(Base.InvalidConfiguration.selector);
        new TaxBuybackBurnV1(c, _configuration(0), manager);
        assertLt(address(deployer).code.length, 24576);
        assertLt(address(host).code.length, 24576);
    }

    function test_creatorRetainsOnlyTheUnallocatedTaxShare() public {
        keepCreator = true;
        _init(2, true, 18, false, false);
        _warm();
        _trade(true, true, 1e18);
        assertEq(ledger.creatorCredited(), ledger.creatorReceived() * 4000 / 10000);
        uint256 beforeBalance = quote.balanceOf(ALICE);
        uint256 amount = ledger.creatorCredited();
        vm.prank(address(0xB0B));
        ledger.claimCreator();
        assertEq(quote.balanceOf(ALICE) - beforeBalance, amount);
        _assertBacking();
    }

    function test_earnedPositionFeesCannotUnderflowOrStopCompounding() public {
        _init(0, true, 18, false, false);
        _warm();
        _trade(true, true, 1e18);
        uint256 count = modules[0].processCount();
        uint256 spent = modules[0].quoteProcessed();
        uint128 liquidity = modules[0].liquidityAdded();
        uint256 held = quote.balanceOf(address(modules[0]));
        PoolDonateTest donor = new PoolDonateTest(manager);
        quote.mint(address(this), 1e29);
        quote.approve(address(donor), 1e29);
        donor.donate(host.poolKey(), 1e29, 0, bytes(""));
        _trade(true, true, 1e16);
        assertEq(modules[0].processCount(), count + 1, "earned LP quote must not revert processing");
        assertGt(modules[0].liquidityAdded(), liquidity);
        assertGt(quote.balanceOf(address(modules[0])), held, "surplus earned quote waits for the next batch");
        assertLe(modules[0].quoteProcessed() - spent, 1e20, "principal stays within the batch cap");
        _assertBacking();
    }

    function testFuzz_batchCapAndBackingAcrossBuySizes(uint128 rawAmount) public {
        uint128 amount = uint128(bound(rawAmount, 1e15, 1e22));
        _init(2, true, 18, false, false);
        _warm();
        _trade(true, true, amount);
        assertGt(modules[0].processCount(), 0);
        assertLe(modules[0].quoteProcessed(), 1e20);
        assertGt(modules[0].tokensBurned(), 0);
        assertGt(modules[0].liquidityAdded(), 0);
        _assertBacking();
    }

    function test_measureUserSwapGasWithAllModules() public {
        _init(0, true, 18, true, true);
        uint256 gasBefore = gasleft();
        _trade(true, true, 1e18);
        emit log_named_uint("cold buy gas, all modules", gasBefore - gasleft());
        vm.warp(block.timestamp + 61);
        gasBefore = gasleft();
        _trade(true, true, 1e18);
        emit log_named_uint("warm automatic buy gas, all modules", gasBefore - gasleft());
        for (uint256 i; i < 3; ++i) {
            assertGt(modules[i].processCount(), 0);
        }
    }

    function test_atomicLaunchFactoryUsesNewHostAndOriginalUniswapPeriphery() public {
        // Constructor initialization of a fresh PositionManager, with provider-observed immutable bindings.
        stdstore.target(POSM).sig("nextTokenId()").checked_write(1);
        bytes32[5] memory hashes =
            [MANAGER.codehash, POSM.codehash, ROUTER.codehash, PERMIT2.codehash, address(deployer).codehash];
        FoundationFactoryV3 factory = new FoundationFactoryV3(
            manager,
            IPositionManager(POSM),
            IFoundationUniversalRouterV2(ROUTER),
            IAllowanceTransfer(PERMIT2),
            FoundationHookDeployerV2(address(deployer)),
            hashes
        );
        quote = new TaxQuoteFixture(18);
        quote.mint(ALICE, 1e25);
        P.LaunchParamsV3 memory p;
        p.metadata = T.Metadata("Atomic automation coin", "AAUTO", "", "ipfs://test", "", bytes(""));
        p.quote = address(quote);
        p.quoteDecimals = 18;
        p.initialTick = 120000;
        p.creatorBuyFeeBps = 500;
        p.creatorSellFeeBps = 500;
        p.initialBuyQuoteAmount = 1e16;
        p.initialBuyMinimumTokenAmount = 1;
        p.deadline = uint64(block.timestamp + 120);
        p.modules = new T.ModuleSelection[](1);
        p.modules[0] = _selection(2, 10000);
        for (uint256 i;; ++i) {
            p.tokenSalt = bytes32(i);
            if (address(quote) < factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata)) break;
        }
        address predicted = factory.predictTokenAddress(ALICE, p.tokenSalt, p.metadata);
        bytes32 hookHash = factory.hookInitCodeHash(ALICE, predicted, p);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
        for (uint256 i;; ++i) {
            p.hookSalt = bytes32(i);
            if (
                uint160(vm.computeCreate2Address(p.hookSalt, hookHash, address(deployer))) & Hooks.ALL_HOOK_MASK
                    == flags
            ) {
                break;
            }
        }
        vm.startPrank(ALICE);
        quote.approve(address(factory), type(uint256).max);
        L.LaunchResultV2 memory result = factory.launch(p);
        vm.stopPrank();
        token = FoundationTokenV1(result.token);
        host = Host(result.hook);
        ledger = host.ledger();
        modules.push(Base(host.moduleAt(0).instance));
        assertGt(token.balanceOf(ALICE), 0);
        assertEq(result.token, predicted);
        assertEq(IERC721(POSM).ownerOf(result.basePositionId), address(0xdEaD));
        vm.warp(block.timestamp + 61);
        _trade(true, true, 1e16);
        assertGt(modules[0].liquidityAdded(), 0);
        assertGt(modules[0].tokensBurned(), 0);
        assertEq(quote.balanceOf(address(factory)), 0);
        assertEq(quote.allowance(address(factory), PERMIT2), 0);
        _assertBacking();
    }
}
