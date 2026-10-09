// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { Test } from "forge-std/Test.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { ProgrammableLaunchStampRouter24hV1 as ProgrammableLaunchStampRouterV1 } from "../../src/robinhood-custom-launch/ProgrammableLaunchStampRouter24hV1.sol";
import {
    IProgrammableCreate2GraphDeployerV1
} from "../../src/robinhood-custom-launch/interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import {
    IProgrammableLaunchStampRouterV1
} from "../../src/robinhood-custom-launch/interfaces/IProgrammableLaunchStampRouterV1.sol";
import { IMemeLaunchV3 } from "../../src/robinhood-custom-launch/interfaces/IMemeLaunchV3.sol";

contract StampMock1271Authority is IERC1271 {
    mapping(bytes32 digest => bool valid) internal validDigest;

    function setValid(bytes32 digest, bool valid) external {
        validDigest[digest] = valid;
    }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        if (validDigest[digest] && keccak256(signature) == keccak256(hex"c0ffee")) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }
}

contract StampMockPoolState {
    mapping(bytes32 slot => bytes32 value) internal slots;

    function setSlot(bytes32 slot, bytes32 value) external {
        slots[slot] = value;
    }

    function extsload(bytes32 slot) external view returns (bytes32) {
        return slots[slot];
    }
}

contract StampMockGraphFactory is IProgrammableCreate2GraphDeployerV1 {
    StampMockPoolState internal immutable manager;
    address[] internal configuredDeployments;
    bytes32 internal configuredPoolSlot;
    bytes32 internal configuredGraphDeploymentHash;
    bool public consumed;

    constructor(StampMockPoolState manager_) {
        manager = manager_;
    }

    function configure(address[] memory deployments, bytes32 poolSlot, bytes32 graphDeploymentHash) external {
        delete configuredDeployments;
        for (uint256 index; index < deployments.length; ++index) {
            configuredDeployments.push(deployments[index]);
        }
        configuredPoolSlot = poolSlot;
        configuredGraphDeploymentHash = graphDeploymentHash;
    }

    function deployGraph(GraphAuthorization calldata authorization, Target[] calldata targets)
        external
        payable
        returns (
            address[] memory deployments,
            bytes32[] memory runtimeCodeHashes,
            bytes[] memory runtimeCodes,
            bytes32 graphDeploymentHash
        )
    {
        require(msg.sender == authorization.authorizedLauncher, "launcher");
        require(msg.value == authorization.totalValue, "value");
        require(targets.length == configuredDeployments.length, "length");
        consumed = true;
        manager.setSlot(configuredPoolSlot, bytes32(uint256(1 << 96)));

        deployments = new address[](configuredDeployments.length);
        runtimeCodeHashes = new bytes32[](configuredDeployments.length);
        runtimeCodes = new bytes[](configuredDeployments.length);
        for (uint256 index; index < configuredDeployments.length; ++index) {
            address deployment = configuredDeployments[index];
            deployments[index] = deployment;
            runtimeCodeHashes[index] = deployment.codehash;
            runtimeCodes[index] = deployment.code;
        }
        graphDeploymentHash = configuredGraphDeploymentHash;
    }
}

contract StampMockToken {
    function tokenMarker() external pure returns (bytes32) {
        return keccak256("token");
    }
}

contract StampMockHook {
    function hookMarker() external pure returns (bytes32) {
        return keccak256("hook");
    }
}

contract StampMockOther {
    function otherMarker() external pure returns (bytes32) {
        return keccak256("other");
    }
}

contract StampForceEther {
    constructor() payable { }

    function force(address payable target) external {
        selfdestruct(target);
    }
}

contract StampMockClassicLauncher is IMemeLaunchV3 {
    address public immutable override ROUTER;
    IPoolManager public immutable override poolManager;
    address public immutable override feeHook;
    StampMockPoolState internal immutable manager;
    PoolKey internal configuredPoolKey;
    LaunchResult internal configuredResult;
    bytes32 internal configuredPoolSlot;

    constructor(address router_, StampMockPoolState manager_, address feeHook_) {
        ROUTER = router_;
        poolManager = IPoolManager(address(manager_));
        manager = manager_;
        feeHook = feeHook_;
    }

    function configure(PoolKey memory key, LaunchResult memory result, bytes32 poolSlot) external {
        configuredPoolKey = key;
        configuredResult = result;
        configuredPoolSlot = poolSlot;
    }

    function poolKey(address token_) external view returns (PoolKey memory) {
        require(token_ == configuredResult.token, "token");
        return configuredPoolKey;
    }

    function launchFor(address launchWallet, LaunchParameters calldata)
        external
        payable
        returns (LaunchResult memory result)
    {
        require(msg.sender == ROUTER, "router");
        require(launchWallet != address(0), "wallet");
        require(msg.value == configuredResult.initialBuyNativeAmount, "value");
        manager.setSlot(configuredPoolSlot, bytes32(uint256(1 << 96)));
        return configuredResult;
    }
}

    contract ProgrammableLaunchStampRouter24hV1Test is Test {
        using PoolIdLibrary for PoolKey;

        bytes32 internal constant EXPECTED_OUTPUT_TYPEHASH = keccak256(
            "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"
        );
        bytes32 internal constant EXPECTED_RESULT_TYPEHASH =
            keccak256("ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)");
        bytes32 internal constant STAMP_TYPEHASH = keccak256(
            "ProgrammableLaunchStampV1(uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId)"
        );
        bytes32 internal constant CLASSIC_RESULT_ADDRESSES_TYPEHASH = keccak256(
            "ProgrammableClassicResultAddressesV1(address token,address rewardVault,address positionRecipient,address initialBuyCustody)"
        );
        bytes32 internal constant CLASSIC_RESULT_AMOUNTS_TYPEHASH = keccak256(
            "ProgrammableClassicResultAmountsV1(uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount)"
        );
        bytes32 internal constant CLASSIC_RESULT_TYPEHASH = keccak256(
            "ProgrammableClassicLaunchResultV1(bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash)"
        );
        bytes32 internal constant GRAPH_DEPLOYMENT_HASH = keccak256("graph-deployment");
        bytes32 internal constant LAUNCH_ID = keccak256("launch-id");
        bytes32 internal constant NONCE = keccak256("nonce");
        bytes32 internal constant POOLS_SLOT = bytes32(uint256(6));

        address internal launchWallet = makeAddr("launch-wallet");
        StampMock1271Authority internal authority;
        StampMockPoolState internal poolManager;
        StampMockGraphFactory internal graphFactory;
        StampMockToken internal token;
        StampMockHook internal hook;
        ProgrammableLaunchStampRouterV1 internal router;
        PoolKey internal poolKey;
        bytes32 internal poolStateSlot;

        function setUp() public {
            authority = new StampMock1271Authority();
            poolManager = new StampMockPoolState();
            graphFactory = new StampMockGraphFactory(poolManager);
            token = new StampMockToken();
            hook = new StampMockHook();
            router = new ProgrammableLaunchStampRouterV1(
                address(authority),
                IProgrammableCreate2GraphDeployerV1(address(graphFactory)),
                IPoolManager(address(poolManager))
            );
            poolKey = PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(address(token)),
                fee: 0,
                tickSpacing: 200,
                hooks: IHooks(address(hook))
            });
            poolStateSlot = keccak256(abi.encodePacked(PoolId.unwrap(poolKey.toId()), POOLS_SLOT));
            address[] memory deployments = new address[](2);
            deployments[0] = address(token);
            deployments[1] = address(hook);
            graphFactory.configure(deployments, poolStateSlot, GRAPH_DEPLOYMENT_HASH);
        }

        function test_customGraphHappyPathWritesExactStamp() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);

            vm.prank(launchWallet);
            bytes32 stampHash = router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");

            IProgrammableLaunchStampRouterV1.StampRecordV1 memory record = router.launchStamp(LAUNCH_ID);
            bytes32 poolId = PoolId.unwrap(poolKey.toId());
            bytes32 expectedStampHash = _expectedStampHash(permit, LAUNCH_ID, digest);
            assertEq(stampHash, expectedStampHash);
            assertEq(record.stampHash, expectedStampHash);
            assertEq(uint8(record.kind), uint8(IProgrammableLaunchStampRouterV1.LaunchKindV1.CustomGraph));
            assertEq(record.token, address(token));
            assertEq(record.hook, address(hook));
            assertEq(record.routeLauncher, address(graphFactory));
            assertEq(record.routeLauncherRuntimeCodeHash, address(graphFactory).codehash);
            assertEq(router.launchIdByToken(address(token)), LAUNCH_ID);
            assertEq(router.launchIdByComponent(address(token)), LAUNCH_ID);
            assertEq(router.launchIdByComponent(address(hook)), LAUNCH_ID);
            assertEq(router.launchIdByPool(address(poolManager), poolId), LAUNCH_ID);
            (bytes32 proofLaunchId, bytes32 proofStampHash) = router.stampProof(address(token));
            assertEq(proofLaunchId, LAUNCH_ID);
            assertEq(proofStampHash, expectedStampHash);
            assertTrue(graphFactory.consumed());
            assertEq(address(router).balance, 0);
            assertNotEq(expectedStampHash, _expectedStampHash(permit, keccak256("different-launch-id"), digest));
        }

        function test_classicSharedHookIsRecordedButNeverGloballyAssigned() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload,
                StampMockClassicLauncher launcher
            ) = _classicRequest();
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);

            vm.prank(launchWallet);
            bytes32 stampHash = router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");

            IProgrammableLaunchStampRouterV1.StampRecordV1 memory record = router.launchStamp(stampRequest.launchId);
            IProgrammableLaunchStampRouterV1.ClassicRouteV1 memory route =
                abi.decode(routePayload, (IProgrammableLaunchStampRouterV1.ClassicRouteV1));
            assertEq(uint8(record.kind), uint8(IProgrammableLaunchStampRouterV1.LaunchKindV1.Classic));
            assertEq(record.routeLauncher, address(launcher));
            assertEq(record.routeLauncherRuntimeCodeHash, address(launcher).codehash);
            assertEq(record.hook, address(hook));
            assertEq(record.stampHash, stampHash);
            assertEq(router.launchIdByComponent(route.expectedResult.token), stampRequest.launchId);
            assertEq(router.launchIdByComponent(route.expectedResult.rewardVault), stampRequest.launchId);
            assertEq(router.launchIdByComponent(route.expectedResult.positionRecipient), stampRequest.launchId);
            assertEq(router.launchIdByComponent(address(hook)), bytes32(0));
            assertEq(router.componentRuntimeCodeHash(address(hook)), bytes32(0));
            (bytes32 hookLaunchId, bytes32 hookStampHash) = router.stampProof(address(hook));
            assertEq(hookLaunchId, bytes32(0));
            assertEq(hookStampHash, bytes32(0));
        }

        function test_classicCannotRelabelHookAlreadyAssignedExclusivelyByCustomGraph() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory customPermit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory customStamp,
                bytes memory customPayload
            ) = _request(LAUNCH_ID, NONCE);
            bytes32 digest = router.permitDigest(customPermit);
            authority.setValid(digest, true);
            vm.prank(launchWallet);
            router.launchAndStampV1(customPermit, customStamp, customPayload, hex"c0ffee");

            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory classicPermit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory classicStamp,
                bytes memory classicPayload,
                StampMockClassicLauncher classicLauncher
            ) = _classicRequest();
            assertNotEq(address(classicLauncher), address(0));
            digest = router.permitDigest(classicPermit);
            authority.setValid(digest, true);
            vm.prank(launchWallet);
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV1.ComponentAlreadyStamped.selector, address(hook), LAUNCH_ID
                )
            );
            router.launchAndStampV1(classicPermit, classicStamp, classicPayload, hex"c0ffee");
        }

        function test_invalid1271SignatureRollsBackWithoutConsumingGraph() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);

            vm.prank(launchWallet);
            vm.expectRevert(ProgrammableLaunchStampRouterV1.InvalidPermitSignature.selector);
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertFalse(graphFactory.consumed());
            assertEq(router.launchIdByToken(address(token)), bytes32(0));
        }

        function test_authorityRuntimeDriftRejectsBeforePermitOrFactoryConsumption() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);
            vm.etch(address(authority), hex"00");

            vm.prank(launchWallet);
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV1.InvalidComponent.selector,
                    address(authority),
                    router.PERMIT_AUTHORITY_RUNTIME_CODE_HASH(),
                    keccak256(hex"00")
                )
            );
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertFalse(graphFactory.consumed());
            assertEq(router.launchIdByToken(address(token)), bytes32(0));
        }

        function test_nonceReplayAcrossDifferentUninitializedPoolRejectsBeforeFactory() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);
            vm.prank(launchWallet);
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");

            (permit, stampRequest, routePayload) = _request(keccak256("second-launch-id"), NONCE);
            stampRequest.poolKey.fee = 100;
            permit.stampRequestHash = router.computeStampRequestHash(stampRequest);
            digest = router.permitDigest(permit);
            authority.setValid(digest, true);
            vm.prank(launchWallet);
            vm.expectRevert(
                abi.encodeWithSelector(ProgrammableLaunchStampRouterV1.NonceAlreadyUsed.selector, launchWallet, NONCE)
            );
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertEq(router.launchIdByToken(address(token)), LAUNCH_ID);
        }

        function test_extraComponentCannotBeStamped() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            StampMockOther extra = new StampMockOther();
            IProgrammableLaunchStampRouterV1.ComponentV1[] memory expanded =
                new IProgrammableLaunchStampRouterV1.ComponentV1[](3);
            expanded[0] = stampRequest.components[0];
            expanded[1] = stampRequest.components[1];
            expanded[2] = IProgrammableLaunchStampRouterV1.ComponentV1({
                resultIndex: 2,
                account: address(extra),
                runtimeCodeHash: address(extra).codehash,
                kind: IProgrammableLaunchStampRouterV1.ComponentKindV1.Other,
                scope: IProgrammableLaunchStampRouterV1.ComponentScopeV1.Exclusive
            });
            _sortComponents(expanded);
            stampRequest.components = expanded;
            permit.stampRequestHash = router.computeStampRequestHash(stampRequest);
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);

            vm.prank(launchWallet);
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV1.InvalidArrayLength.selector, uint8(4), uint256(3), uint256(2)
                )
            );
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertFalse(graphFactory.consumed());
        }

        function test_forcedEtherRemainsIsolatedAcrossSuccessfulLaunch() public {
            vm.deal(address(this), 1 ether);
            StampForceEther force = new StampForceEther{ value: 7 wei }();
            force.force(payable(address(router)));
            assertEq(address(router).balance, 7 wei);
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);
            vm.prank(launchWallet);
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertEq(address(router).balance, 7 wei);
        }

        function test_preinitializedPoolRejectsBeforeFactoryAndSamePermitCanThenSucceed() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);
            poolManager.setSlot(poolStateSlot, bytes32(uint256(1)));

            vm.prank(launchWallet);
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV1.PoolAlreadyInitialized.selector,
                    address(poolManager),
                    PoolId.unwrap(poolKey.toId())
                )
            );
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertFalse(graphFactory.consumed());

            poolManager.setSlot(poolStateSlot, bytes32(0));
            vm.prank(launchWallet);
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertTrue(graphFactory.consumed());
        }

        function test_postInitializationValidationFailureRollsBackFactoryPoolAndPermit() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);
            address[] memory deployments = new address[](2);
            deployments[0] = address(token);
            deployments[1] = address(hook);
            graphFactory.configure(deployments, poolStateSlot, keccak256("wrong-result"));

            vm.prank(launchWallet);
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchStampRouterV1.FactoryResultMismatch.selector, uint8(1), uint256(0)
                )
            );
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertFalse(graphFactory.consumed());
            assertEq(poolManager.extsload(poolStateSlot), bytes32(0));
            assertEq(router.launchIdByToken(address(token)), bytes32(0));

            graphFactory.configure(deployments, poolStateSlot, GRAPH_DEPLOYMENT_HASH);
            vm.prank(launchWallet);
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
            assertTrue(graphFactory.consumed());
        }

        function test_exactOneHourPermitSucceeds() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            assertEq(permit.deadline - permit.validAfter, 1 hours);
            bytes32 digest = router.permitDigest(permit);
            authority.setValid(digest, true);
            vm.prank(launchWallet);
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
        }

        function test_permitCanExecuteAfterTwentyThreeHours() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            permit.deadline = permit.validAfter + 24 hours;
            authority.setValid(router.permitDigest(permit), true);
            vm.warp(permit.deadline - 1);
            vm.prank(launchWallet);
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
        }

        function test_permitLifetimeOverTwentyFourHoursRejects() public {
            (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            ) = _request(LAUNCH_ID, NONCE);
            permit.deadline = permit.validAfter + 24 hours + 1;
            permit.stampRequestHash = router.computeStampRequestHash(stampRequest);

            vm.prank(launchWallet);
            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV1.InvalidBinding.selector, uint8(6)));
            router.launchAndStampV1(permit, stampRequest, routePayload, hex"c0ffee");
        }

        function test_constructorRejectsEOAAuthority() public {
            vm.expectRevert(abi.encodeWithSelector(ProgrammableLaunchStampRouterV1.InvalidBinding.selector, uint8(1)));
            new ProgrammableLaunchStampRouterV1(
                makeAddr("eoa"),
                IProgrammableCreate2GraphDeployerV1(address(graphFactory)),
                IPoolManager(address(poolManager))
            );
        }

        function test_noReceiveOrFallback() public {
            vm.deal(address(this), 1 ether);
            (bool receiveSuccess,) = address(router).call{ value: 1 wei }("");
            assertFalse(receiveSuccess);
            (bool fallbackSuccess,) = address(router).call(hex"deadbeef");
            assertFalse(fallbackSuccess);
        }

        function _classicRequest()
            internal
            returns (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload,
                StampMockClassicLauncher launcher
            )
        {
            StampMockToken classicToken = new StampMockToken();
            StampMockOther rewardVault = new StampMockOther();
            StampMockOther positionRecipient = new StampMockOther();
            launcher = new StampMockClassicLauncher(address(router), poolManager, address(hook));
            PoolKey memory classicPoolKey = PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(address(classicToken)),
                fee: 0,
                tickSpacing: 200,
                hooks: IHooks(address(hook))
            });
            bytes32 classicPoolStateSlot = keccak256(abi.encodePacked(PoolId.unwrap(classicPoolKey.toId()), POOLS_SLOT));

            IMemeLaunchV3.LaunchResult memory expected = IMemeLaunchV3.LaunchResult({
                token: address(classicToken),
                rewardVault: address(rewardVault),
                positionRecipient: address(positionRecipient),
                positionTokenId: 1,
                tokenLiquidityAmount: 2,
                lockedTokenDust: 3,
                initialBuyNativeAmount: 0,
                initialBuyTokenAmount: 4,
                initialBuyCustody: address(0),
                poolId: PoolId.unwrap(classicPoolKey.toId()),
                launchHash: keccak256("classic-launch-hash")
            });
            launcher.configure(classicPoolKey, expected, classicPoolStateSlot);

            IProgrammableLaunchStampRouterV1.ClassicRouteV1 memory route;
            route.launcher = address(launcher);
            route.launcherRuntimeCodeHash = address(launcher).codehash;
            route.parameters.name = "Classic";
            route.parameters.symbol = "CLS";
            route.parameters.creatorSalt = keccak256("classic-salt");
            route.expectedResult = expected;
            routePayload = abi.encode(route);

            stampRequest.launchId = keccak256("classic-launch-id");
            stampRequest.token = address(classicToken);
            stampRequest.tokenRuntimeCodeHash = address(classicToken).codehash;
            stampRequest.poolKey = classicPoolKey;
            stampRequest.hookRuntimeCodeHash = address(hook).codehash;
            stampRequest.components = new IProgrammableLaunchStampRouterV1.ComponentV1[](4);
            stampRequest.components[0] = IProgrammableLaunchStampRouterV1.ComponentV1({
                resultIndex: 0,
                account: address(classicToken),
                runtimeCodeHash: address(classicToken).codehash,
                kind: IProgrammableLaunchStampRouterV1.ComponentKindV1.Token,
                scope: IProgrammableLaunchStampRouterV1.ComponentScopeV1.Exclusive
            });
            stampRequest.components[1] = IProgrammableLaunchStampRouterV1.ComponentV1({
                resultIndex: 1,
                account: address(rewardVault),
                runtimeCodeHash: address(rewardVault).codehash,
                kind: IProgrammableLaunchStampRouterV1.ComponentKindV1.Other,
                scope: IProgrammableLaunchStampRouterV1.ComponentScopeV1.Exclusive
            });
            stampRequest.components[2] = IProgrammableLaunchStampRouterV1.ComponentV1({
                resultIndex: 2,
                account: address(positionRecipient),
                runtimeCodeHash: address(positionRecipient).codehash,
                kind: IProgrammableLaunchStampRouterV1.ComponentKindV1.Other,
                scope: IProgrammableLaunchStampRouterV1.ComponentScopeV1.Exclusive
            });
            stampRequest.components[3] = IProgrammableLaunchStampRouterV1.ComponentV1({
                resultIndex: type(uint8).max,
                account: address(hook),
                runtimeCodeHash: address(hook).codehash,
                kind: IProgrammableLaunchStampRouterV1.ComponentKindV1.Hook,
                scope: IProgrammableLaunchStampRouterV1.ComponentScopeV1.SharedInfrastructure
            });
            _sortComponents(stampRequest.components);

            permit = IProgrammableLaunchStampRouterV1.LaunchPermitV1({
                chainId: block.chainid,
                router: address(router),
                launchWallet: launchWallet,
                kind: IProgrammableLaunchStampRouterV1.LaunchKindV1.Classic,
                routePayloadHash: keccak256(routePayload),
                expectedResultHash: _classicResultHash(expected),
                stampRequestHash: router.computeStampRequestHash(stampRequest),
                nonce: keccak256("classic-nonce"),
                validAfter: uint64(block.timestamp),
                deadline: uint64(block.timestamp + 1 hours),
                value: 0
            });
        }

        function _sortComponents(IProgrammableLaunchStampRouterV1.ComponentV1[] memory components) internal pure {
            for (uint256 index = 1; index < components.length; ++index) {
                for (
                    uint256 cursor = index;
                    cursor != 0 && components[cursor].account < components[cursor - 1].account;

                ) {
                    IProgrammableLaunchStampRouterV1.ComponentV1 memory swapValue = components[cursor - 1];
                    components[cursor - 1] = components[cursor];
                    components[cursor] = swapValue;
                    unchecked {
                        --cursor;
                    }
                }
            }
        }

        function _request(bytes32 launchId, bytes32 nonce)
            internal
            view
            returns (
                IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
                IProgrammableLaunchStampRouterV1.StampRequestV1 memory stampRequest,
                bytes memory routePayload
            )
        {
            IProgrammableLaunchStampRouterV1.CustomGraphRouteV1 memory route;
            route.routeNamespace = keccak256("route-namespace");
            route.routeNonce = nonce;
            route.topologyHash = keccak256("topology");
            route.graphCommitment = keccak256("graph-commitment");
            route.expectedGraphDeploymentHash = GRAPH_DEPLOYMENT_HASH;
            route.targets = new IProgrammableCreate2GraphDeployerV1.Target[](2);
            route.targets[0] = IProgrammableCreate2GraphDeployerV1.Target({
                targetIdHash: keccak256("token-target"),
                applicantSalt: keccak256("token-salt"),
                deploymentValue: 0,
                initializerValue: 0,
                initCode: type(StampMockToken).creationCode,
                initializerCalldata: ""
            });
            route.targets[1] = IProgrammableCreate2GraphDeployerV1.Target({
                targetIdHash: keccak256("hook-target"),
                applicantSalt: keccak256("hook-salt"),
                deploymentValue: 0,
                initializerValue: 0,
                initCode: type(StampMockHook).creationCode,
                initializerCalldata: ""
            });
            route.expectedOutputs = new IProgrammableLaunchStampRouterV1.ExpectedGraphOutputV1[](2);
            route.expectedOutputs[0] = IProgrammableLaunchStampRouterV1.ExpectedGraphOutputV1({
                targetIndex: 0,
                targetIdHash: route.targets[0].targetIdHash,
                account: address(token),
                runtimeCodeHash: address(token).codehash
            });
            route.expectedOutputs[1] = IProgrammableLaunchStampRouterV1.ExpectedGraphOutputV1({
                targetIndex: 1,
                targetIdHash: route.targets[1].targetIdHash,
                account: address(hook),
                runtimeCodeHash: address(hook).codehash
            });
            routePayload = abi.encode(route);

            stampRequest.launchId = launchId;
            stampRequest.token = address(token);
            stampRequest.tokenRuntimeCodeHash = address(token).codehash;
            stampRequest.poolKey = poolKey;
            stampRequest.hookRuntimeCodeHash = address(hook).codehash;
            stampRequest.components = new IProgrammableLaunchStampRouterV1.ComponentV1[](2);
            IProgrammableLaunchStampRouterV1.ComponentV1 memory tokenComponent = IProgrammableLaunchStampRouterV1.ComponentV1({
                resultIndex: 0,
                account: address(token),
                runtimeCodeHash: address(token).codehash,
                kind: IProgrammableLaunchStampRouterV1.ComponentKindV1.Token,
                scope: IProgrammableLaunchStampRouterV1.ComponentScopeV1.Exclusive
            });
            IProgrammableLaunchStampRouterV1.ComponentV1 memory hookComponent = IProgrammableLaunchStampRouterV1.ComponentV1({
                resultIndex: 1,
                account: address(hook),
                runtimeCodeHash: address(hook).codehash,
                kind: IProgrammableLaunchStampRouterV1.ComponentKindV1.Hook,
                scope: IProgrammableLaunchStampRouterV1.ComponentScopeV1.Exclusive
            });
            if (address(token) < address(hook)) {
                stampRequest.components[0] = tokenComponent;
                stampRequest.components[1] = hookComponent;
            } else {
                stampRequest.components[0] = hookComponent;
                stampRequest.components[1] = tokenComponent;
            }

            permit = IProgrammableLaunchStampRouterV1.LaunchPermitV1({
                chainId: block.chainid,
                router: address(router),
                launchWallet: launchWallet,
                kind: IProgrammableLaunchStampRouterV1.LaunchKindV1.CustomGraph,
                routePayloadHash: keccak256(routePayload),
                expectedResultHash: _expectedResultHash(route.expectedOutputs, route.expectedGraphDeploymentHash),
                stampRequestHash: router.computeStampRequestHash(stampRequest),
                nonce: nonce,
                validAfter: uint64(block.timestamp),
                deadline: uint64(block.timestamp + 1 hours),
                value: 0
            });
        }

        function _expectedResultHash(
            IProgrammableLaunchStampRouterV1.ExpectedGraphOutputV1[] memory outputs,
            bytes32 graphDeploymentHash
        ) internal pure returns (bytes32) {
            bytes32[] memory hashes = new bytes32[](outputs.length);
            for (uint256 index; index < outputs.length; ++index) {
                hashes[index] = keccak256(
                    abi.encode(
                        EXPECTED_OUTPUT_TYPEHASH,
                        outputs[index].targetIndex,
                        outputs[index].targetIdHash,
                        outputs[index].account,
                        outputs[index].runtimeCodeHash
                    )
                );
            }
            return
                keccak256(
                    abi.encode(EXPECTED_RESULT_TYPEHASH, keccak256(abi.encodePacked(hashes)), graphDeploymentHash)
                );
        }

        function _classicResultHash(IMemeLaunchV3.LaunchResult memory result) internal pure returns (bytes32) {
            bytes32 addressesHash = keccak256(
                abi.encode(
                    CLASSIC_RESULT_ADDRESSES_TYPEHASH,
                    result.token,
                    result.rewardVault,
                    result.positionRecipient,
                    result.initialBuyCustody
                )
            );
            bytes32 amountsHash = keccak256(
                abi.encode(
                    CLASSIC_RESULT_AMOUNTS_TYPEHASH,
                    result.positionTokenId,
                    result.tokenLiquidityAmount,
                    result.lockedTokenDust,
                    result.initialBuyNativeAmount,
                    result.initialBuyTokenAmount
                )
            );
            return
                keccak256(
                    abi.encode(CLASSIC_RESULT_TYPEHASH, addressesHash, amountsHash, result.poolId, result.launchHash)
                );
        }

        function _expectedStampHash(
            IProgrammableLaunchStampRouterV1.LaunchPermitV1 memory permit,
            bytes32 launchId,
            bytes32 digest
        ) internal view returns (bytes32) {
            return keccak256(
                abi.encode(
                    STAMP_TYPEHASH,
                    block.chainid,
                    address(router),
                    launchId,
                    launchWallet,
                    uint8(permit.kind),
                    permit.routePayloadHash,
                    permit.expectedResultHash,
                    permit.stampRequestHash,
                    digest,
                    address(poolManager),
                    PoolId.unwrap(poolKey.toId())
                )
            );
        }
    }
