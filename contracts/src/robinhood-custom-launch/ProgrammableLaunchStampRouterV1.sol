// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { IProgrammableCreate2GraphDeployerV1 } from "./interfaces/IProgrammableCreate2GraphDeployerV1.sol";
import { IProgrammableLaunchStampRouterV1 } from "./interfaces/IProgrammableLaunchStampRouterV1.sol";
import { IMemeLaunchV3 } from "./interfaces/IMemeLaunchV3.sol";

/// @title ProgrammableLaunchStampRouterV1
/// @notice Executes one authority-permitted launch and writes its provenance stamp atomically.
/// @dev A stamp proves origin through this exact Router. It is not an audit, safety, or tradability claim.
contract ProgrammableLaunchStampRouterV1 is IProgrammableLaunchStampRouterV1, EIP712, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 private constant MAX_CUSTOM_GRAPH_TARGETS = 16;
    uint64 private constant MAX_PERMIT_LIFETIME = 24 hours;
    uint8 private constant CLASSIC_TOKEN_RESULT_INDEX = 0;
    uint8 private constant CLASSIC_REWARD_VAULT_RESULT_INDEX = 1;
    uint8 private constant CLASSIC_POSITION_RECIPIENT_RESULT_INDEX = 2;
    uint8 private constant CLASSIC_INITIAL_BUY_CUSTODY_RESULT_INDEX = 3;
    uint8 private constant SHARED_INFRASTRUCTURE_RESULT_INDEX = type(uint8).max;
    string private constant EIP712_NAME = "ProgrammableLaunchStampRouter";
    string private constant EIP712_VERSION = "1";

    bytes32 private constant EXPECTED_GRAPH_OUTPUT_TYPEHASH = keccak256(
        "ProgrammableExpectedGraphOutputV1(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)"
    );
    bytes32 private constant COMPONENT_TYPEHASH = keccak256(
        "ProgrammableLaunchComponentV1(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 kind,uint8 scope)"
    );
    bytes32 private constant POOL_KEY_TYPEHASH = keccak256(
        "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
    );
    bytes32 private constant STAMP_REQUEST_TYPEHASH = keccak256(
        "ProgrammableStampRequestV1(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)"
    );
    bytes32 private constant EXPECTED_GRAPH_RESULT_TYPEHASH =
        keccak256("ProgrammableExpectedGraphResultV1(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)");
    bytes32 private constant CLASSIC_RESULT_ADDRESSES_TYPEHASH = keccak256(
        "ProgrammableClassicResultAddressesV1(address token,address rewardVault,address positionRecipient,address initialBuyCustody)"
    );
    bytes32 private constant CLASSIC_RESULT_AMOUNTS_TYPEHASH = keccak256(
        "ProgrammableClassicResultAmountsV1(uint256 positionTokenId,uint256 tokenLiquidityAmount,uint256 lockedTokenDust,uint256 initialBuyNativeAmount,uint256 initialBuyTokenAmount)"
    );
    bytes32 private constant CLASSIC_RESULT_TYPEHASH = keccak256(
        "ProgrammableClassicLaunchResultV1(bytes32 addressesHash,bytes32 amountsHash,bytes32 poolId,bytes32 launchHash)"
    );
    bytes32 private constant LAUNCH_PERMIT_TYPEHASH = keccak256(
        "ProgrammableLaunchPermitV1(uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)"
    );
    bytes32 private constant LAUNCH_STAMP_TYPEHASH = keccak256(
        "ProgrammableLaunchStampV1(uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId)"
    );

    uint8 private constant BIND_PERMIT_AUTHORITY = 1;
    uint8 private constant BIND_GRAPH_FACTORY = 2;
    uint8 private constant BIND_POOL_MANAGER = 3;
    uint8 private constant BIND_COLLISION = 4;
    uint8 private constant BIND_PERMIT_ENVELOPE = 5;
    uint8 private constant BIND_PERMIT_LIFETIME = 6;
    uint8 private constant BIND_OBSERVED_RESULT = 7;
    uint8 private constant BIND_CLASSIC_RESULT = 8;
    uint8 private constant BIND_CLASSIC_POOL_KEY = 9;
    uint8 private constant BIND_CLASSIC_OBSERVED_RESULT = 10;
    uint8 private constant BIND_CLASSIC_LAUNCHER = 11;
    uint8 private constant BIND_CLASSIC_EXPECTED_RESULT = 12;
    uint8 private constant BIND_CLASSIC_BINDINGS = 13;
    uint8 private constant BIND_CLASSIC_TOKEN_COMPONENT = 14;
    uint8 private constant BIND_CLASSIC_REWARD_COMPONENT = 15;
    uint8 private constant BIND_CLASSIC_POSITION_COMPONENT = 16;
    uint8 private constant BIND_CLASSIC_CUSTODY_COMPONENT = 17;
    uint8 private constant BIND_CLASSIC_HOOK_COMPONENT = 18;
    uint8 private constant BIND_CLASSIC_COMPONENT_INDEX = 19;
    uint8 private constant BIND_CLASSIC_COMPONENT_SET = 20;
    uint8 private constant BIND_GRAPH_AUTHORIZATION = 21;
    uint8 private constant BIND_EXPECTED_RESULT = 22;
    uint8 private constant BIND_EXPECTED_OUTPUT = 23;
    uint8 private constant BIND_DUPLICATE_OUTPUT = 24;
    uint8 private constant BIND_EXCLUSIVE_COMPONENT_SET = 25;
    uint8 private constant BIND_TOKEN_COMPONENT = 26;
    uint8 private constant BIND_HOOK_COMPONENT = 27;
    uint8 private constant BIND_COMPONENT_KIND = 28;
    uint8 private constant BIND_REQUIRED_COMPONENTS = 29;
    uint8 private constant BIND_POOL_KEY = 30;
    uint8 private constant BIND_POOL_UNINITIALIZED = 31;
    uint8 private constant BIND_RESULT_WRITE = 32;
    uint8 private constant BIND_MISSING_RESULT_COMPONENT = 33;

    uint8 private constant ARRAY_CLASSIC_COMPONENTS = 1;
    uint8 private constant ARRAY_GRAPH_TARGETS = 2;
    uint8 private constant ARRAY_GRAPH_OUTPUTS = 3;
    uint8 private constant ARRAY_GRAPH_COMPONENTS = 4;

    uint8 private constant RESULT_ENVELOPE = 1;
    uint8 private constant RESULT_DEPLOYMENT = 2;
    uint8 private constant RESULT_COMPONENT = 3;

    address public immutable PERMIT_AUTHORITY;
    bytes32 public immutable PERMIT_AUTHORITY_RUNTIME_CODE_HASH;
    IProgrammableCreate2GraphDeployerV1 public immutable GRAPH_FACTORY;
    bytes32 public immutable GRAPH_FACTORY_RUNTIME_CODE_HASH;
    IPoolManager public immutable POOL_MANAGER;
    bytes32 public immutable POOL_MANAGER_RUNTIME_CODE_HASH;
    uint256 public immutable CHAIN_ID;

    mapping(bytes32 launchId => StampRecordV1 record) private _launchStamp;
    mapping(address token => bytes32 launchId) public override launchIdByToken;
    mapping(address component => bytes32 launchId) public override launchIdByComponent;
    mapping(address component => bytes32 runtimeCodeHash) public override componentRuntimeCodeHash;
    mapping(address launchWallet => mapping(bytes32 nonce => bool used)) private _usedNonce;
    mapping(bytes32 permitDigest => bool used) private _usedPermitDigest;
    mapping(bytes32 poolLookupKey => bytes32 launchId) private _launchIdByPool;

    struct GraphExecutionV1 {
        address[] deployments;
        bytes32[] runtimeCodeHashes;
        bytes[] runtimeCodes;
        bytes32 graphDeploymentHash;
    }

    struct RouteExecutionV1 {
        bytes32 observedResultHash;
        address launcher;
        bytes32 launcherRuntimeCodeHash;
    }

    struct ValidatedMarketV1 {
        address hook;
        bytes32 poolId;
        bytes32 poolKeyHash;
        bytes32 componentSetHash;
    }

    error ComponentAlreadyStamped(address component, bytes32 launchId);
    error DuplicateOrUnsortedComponent(address previous, address current);
    error FactoryResultMismatch(uint8 field, uint256 index);
    error InvalidArrayLength(uint8 field, uint256 actual, uint256 expected);
    error InvalidBinding(uint8 field);
    error InvalidComponent(address component, bytes32 supplied, bytes32 actual);
    error InvalidPermitSignature();
    error LaunchAlreadyStamped(bytes32 launchId);
    error NonCanonicalRoutePayload();
    error NonceAlreadyUsed(address launchWallet, bytes32 nonce);
    error PermitAlreadyUsed(bytes32 permitDigest);
    error PermitOutsideValidityWindow(uint256 timestamp, uint256 validAfter, uint256 deadline);
    error PoolAlreadyStamped(address poolManager, bytes32 poolId, bytes32 launchId);
    error PoolAlreadyInitialized(address poolManager, bytes32 poolId);
    error ResidualLaunchValue(uint256 expected, uint256 actual);
    error UnauthorizedLaunchWallet(address caller, address launchWallet);
    error UnsupportedLaunchKind(LaunchKindV1 kind);

    constructor(address permitAuthority, IProgrammableCreate2GraphDeployerV1 graphFactory, IPoolManager poolManager)
        EIP712(EIP712_NAME, EIP712_VERSION)
    {
        _requireCode(BIND_PERMIT_AUTHORITY, permitAuthority);
        _requireCode(BIND_GRAPH_FACTORY, address(graphFactory));
        _requireCode(BIND_POOL_MANAGER, address(poolManager));
        if (
            permitAuthority == address(graphFactory) || permitAuthority == address(poolManager)
                || address(graphFactory) == address(poolManager)
        ) revert InvalidBinding(BIND_COLLISION);

        PERMIT_AUTHORITY = permitAuthority;
        PERMIT_AUTHORITY_RUNTIME_CODE_HASH = permitAuthority.codehash;
        GRAPH_FACTORY = graphFactory;
        GRAPH_FACTORY_RUNTIME_CODE_HASH = address(graphFactory).codehash;
        POOL_MANAGER = poolManager;
        POOL_MANAGER_RUNTIME_CODE_HASH = address(poolManager).codehash;
        CHAIN_ID = block.chainid;
    }

    /// @notice The Router's sole market-bearing entry point.
    function launchAndStampV1(
        LaunchPermitV1 calldata permit,
        StampRequestV1 calldata stampRequest,
        bytes calldata routePayload,
        bytes calldata signature
    ) external payable override nonReentrant returns (bytes32 stampHash) {
        uint256 preexistingBalance = address(this).balance - msg.value;
        _validatePermitEnvelope(permit, stampRequest, routePayload);
        bytes32 digest = permitDigest(permit);
        if (_usedPermitDigest[digest]) revert PermitAlreadyUsed(digest);
        if (_usedNonce[permit.launchWallet][permit.nonce]) {
            revert NonceAlreadyUsed(permit.launchWallet, permit.nonce);
        }
        if (!SignatureChecker.isValidERC1271SignatureNow(PERMIT_AUTHORITY, digest, signature)) {
            revert InvalidPermitSignature();
        }

        _usedPermitDigest[digest] = true;
        _usedNonce[permit.launchWallet][permit.nonce] = true;

        RouteExecutionV1 memory execution;
        if (permit.kind == LaunchKindV1.CustomGraph) {
            execution.observedResultHash = _executeCustomGraph(routePayload, stampRequest, permit);
            execution.launcher = address(GRAPH_FACTORY);
            execution.launcherRuntimeCodeHash = GRAPH_FACTORY_RUNTIME_CODE_HASH;
        } else if (permit.kind == LaunchKindV1.Classic) {
            execution = _executeClassic(routePayload, stampRequest, permit);
        } else {
            revert UnsupportedLaunchKind(permit.kind);
        }

        ValidatedMarketV1 memory market = _validateMarket(stampRequest);
        stampHash = _stampHash(permit, stampRequest.launchId, market.poolId, digest);
        _writeStamp(permit, stampRequest, market, execution, digest, stampHash);

        if (address(this).balance != preexistingBalance) {
            revert ResidualLaunchValue(preexistingBalance, address(this).balance);
        }
    }

    function permitDigest(LaunchPermitV1 calldata permit) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LAUNCH_PERMIT_TYPEHASH,
                    permit.chainId,
                    permit.router,
                    permit.launchWallet,
                    uint8(permit.kind),
                    permit.routePayloadHash,
                    permit.expectedResultHash,
                    permit.stampRequestHash,
                    permit.nonce,
                    permit.validAfter,
                    permit.deadline,
                    permit.value
                )
            )
        );
    }

    function computeStampRequestHash(StampRequestV1 calldata request) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                STAMP_REQUEST_TYPEHASH,
                request.launchId,
                request.token,
                request.tokenRuntimeCodeHash,
                computePoolKeyHash(request.poolKey),
                request.hookRuntimeCodeHash,
                computeComponentSetHash(request.components)
            )
        );
    }

    function computeComponentSetHash(ComponentV1[] calldata components) public pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](components.length);
        address previous;
        for (uint256 index; index < components.length; ++index) {
            ComponentV1 calldata component = components[index];
            if (component.account == address(0) || (index != 0 && component.account <= previous)) {
                revert DuplicateOrUnsortedComponent(previous, component.account);
            }
            previous = component.account;
            hashes[index] = keccak256(
                abi.encode(
                    COMPONENT_TYPEHASH,
                    component.resultIndex,
                    component.account,
                    component.runtimeCodeHash,
                    uint8(component.kind),
                    uint8(component.scope)
                )
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function computePoolKeyHash(PoolKey calldata poolKey) public pure returns (bytes32) {
        return _poolKeyHash(poolKey);
    }

    function launchIdByPool(address poolManager, bytes32 poolId) external view override returns (bytes32) {
        return _launchIdByPool[_poolLookupKey(poolManager, poolId)];
    }

    function launchStamp(bytes32 launchId) external view override returns (StampRecordV1 memory) {
        return _launchStamp[launchId];
    }

    function stampProof(address component) external view override returns (bytes32 launchId, bytes32 stampHash) {
        launchId = launchIdByComponent[component];
        if (launchId != bytes32(0)) stampHash = _launchStamp[launchId].stampHash;
    }

    function _validatePermitEnvelope(
        LaunchPermitV1 calldata permit,
        StampRequestV1 calldata stampRequest,
        bytes calldata routePayload
    ) private view {
        _requireRuntime(PERMIT_AUTHORITY, PERMIT_AUTHORITY_RUNTIME_CODE_HASH);
        _requireRuntime(address(GRAPH_FACTORY), GRAPH_FACTORY_RUNTIME_CODE_HASH);
        _requireRuntime(address(POOL_MANAGER), POOL_MANAGER_RUNTIME_CODE_HASH);
        if (msg.sender != permit.launchWallet || permit.launchWallet == address(0)) {
            revert UnauthorizedLaunchWallet(msg.sender, permit.launchWallet);
        }
        if (
            permit.chainId != CHAIN_ID || block.chainid != CHAIN_ID || permit.router != address(this)
                || permit.kind == LaunchKindV1.Invalid || permit.routePayloadHash != keccak256(routePayload)
                || permit.stampRequestHash != computeStampRequestHash(stampRequest) || permit.value != msg.value
                || permit.nonce == bytes32(0) || stampRequest.launchId == bytes32(0)
        ) revert InvalidBinding(BIND_PERMIT_ENVELOPE);
        if (
            block.timestamp < permit.validAfter || block.timestamp > permit.deadline
                || permit.validAfter > permit.deadline
        ) revert PermitOutsideValidityWindow(block.timestamp, permit.validAfter, permit.deadline);
        if (permit.deadline - permit.validAfter > MAX_PERMIT_LIFETIME) {
            revert InvalidBinding(BIND_PERMIT_LIFETIME);
        }
        if (_launchStamp[stampRequest.launchId].stampHash != bytes32(0)) {
            revert LaunchAlreadyStamped(stampRequest.launchId);
        }
        PoolId poolId = stampRequest.poolKey.toId();
        (uint160 sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(poolId);
        if (sqrtPriceX96 != 0) revert PoolAlreadyInitialized(address(POOL_MANAGER), PoolId.unwrap(poolId));
        bytes32 existingPoolLaunchId = _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), PoolId.unwrap(poolId))];
        if (existingPoolLaunchId != bytes32(0)) {
            revert PoolAlreadyStamped(address(POOL_MANAGER), PoolId.unwrap(poolId), existingPoolLaunchId);
        }
    }

    function _executeCustomGraph(
        bytes calldata routePayload,
        StampRequestV1 calldata stampRequest,
        LaunchPermitV1 calldata permit
    ) private returns (bytes32 observedResultHash) {
        CustomGraphRouteV1 memory route = _decodeCustomGraphRoute(routePayload);
        _validateCustomGraphShape(route, stampRequest, permit);
        IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory authorization =
            _authorization(route, permit.value);

        GraphExecutionV1 memory execution;
        (execution.deployments, execution.runtimeCodeHashes, execution.runtimeCodes, execution.graphDeploymentHash) =
            GRAPH_FACTORY.deployGraph{ value: permit.value }(authorization, route.targets);

        _validateGraphExecution(route, stampRequest, execution);
        observedResultHash = _expectedGraphResultHash(route.expectedOutputs, execution.graphDeploymentHash);
        if (observedResultHash != permit.expectedResultHash) revert InvalidBinding(BIND_OBSERVED_RESULT);
    }

    function _executeClassic(
        bytes calldata routePayload,
        StampRequestV1 calldata stampRequest,
        LaunchPermitV1 calldata permit
    ) private returns (RouteExecutionV1 memory execution) {
        ClassicRouteV1 memory route = _decodeClassicRoute(routePayload);
        IMemeLaunchV3 launcher = IMemeLaunchV3(route.launcher);
        _validateClassicRoute(launcher, route, stampRequest, permit);

        IMemeLaunchV3.LaunchResult memory result =
            launcher.launchFor{ value: permit.value }(permit.launchWallet, route.parameters);
        _validateClassicBindings(launcher, route.launcherRuntimeCodeHash, address(stampRequest.poolKey.hooks));
        if (keccak256(abi.encode(result)) != keccak256(abi.encode(route.expectedResult))) {
            revert InvalidBinding(BIND_CLASSIC_RESULT);
        }
        PoolKey memory launcherPoolKey = launcher.poolKey(result.token);
        if (_poolKeyHash(launcherPoolKey) != _poolKeyHash(stampRequest.poolKey)) {
            revert InvalidBinding(BIND_CLASSIC_POOL_KEY);
        }

        execution.observedResultHash = _classicResultHash(result);
        execution.launcher = route.launcher;
        execution.launcherRuntimeCodeHash = route.launcherRuntimeCodeHash;
        if (execution.observedResultHash != permit.expectedResultHash) {
            revert InvalidBinding(BIND_CLASSIC_OBSERVED_RESULT);
        }
    }

    function _validateClassicRoute(
        IMemeLaunchV3 launcher,
        ClassicRouteV1 memory route,
        StampRequestV1 calldata stampRequest,
        LaunchPermitV1 calldata permit
    ) private view {
        if (
            route.launcher == address(0) || route.launcherRuntimeCodeHash == bytes32(0)
                || route.launcher == address(GRAPH_FACTORY) || route.launcher == address(POOL_MANAGER)
                || route.launcher == PERMIT_AUTHORITY || route.launcher == address(this)
        ) revert InvalidBinding(BIND_CLASSIC_LAUNCHER);
        _validateClassicBindings(launcher, route.launcherRuntimeCodeHash, address(stampRequest.poolKey.hooks));

        IMemeLaunchV3.LaunchResult memory expected = route.expectedResult;
        bytes32 poolId = PoolId.unwrap(stampRequest.poolKey.toId());
        if (
            _classicResultHash(expected) != permit.expectedResultHash || expected.token != stampRequest.token
                || expected.token == address(0) || expected.rewardVault == address(0)
                || expected.positionRecipient == address(0) || expected.poolId != poolId
                || expected.initialBuyNativeAmount != permit.value || expected.initialBuyTokenAmount == 0
                || expected.launchHash == bytes32(0)
        ) revert InvalidBinding(BIND_CLASSIC_EXPECTED_RESULT);

        PoolKey memory launcherPoolKey = launcher.poolKey(expected.token);
        if (_poolKeyHash(launcherPoolKey) != _poolKeyHash(stampRequest.poolKey)) {
            revert InvalidBinding(BIND_CLASSIC_POOL_KEY);
        }
        _validateClassicComponents(stampRequest, expected);
    }

    function _validateClassicBindings(IMemeLaunchV3 launcher, bytes32 runtimeCodeHash, address hook) private view {
        _requireRuntime(address(launcher), runtimeCodeHash);
        if (
            launcher.ROUTER() != address(this) || address(launcher.poolManager()) != address(POOL_MANAGER)
                || launcher.feeHook() != hook
        ) revert InvalidBinding(BIND_CLASSIC_BINDINGS);
    }

    function _validateClassicComponents(
        StampRequestV1 calldata stampRequest,
        IMemeLaunchV3.LaunchResult memory expected
    ) private view {
        uint256 expectedLength = expected.initialBuyCustody == address(0) ? 4 : 5;
        if (stampRequest.components.length != expectedLength) {
            revert InvalidArrayLength(ARRAY_CLASSIC_COMPONENTS, stampRequest.components.length, expectedLength);
        }

        bool foundToken;
        bool foundRewardVault;
        bool foundPositionRecipient;
        bool foundCustody = expected.initialBuyCustody == address(0);
        bool foundHook;
        address hook = address(stampRequest.poolKey.hooks);
        for (uint256 index; index < stampRequest.components.length; ++index) {
            ComponentV1 calldata component = stampRequest.components[index];
            if (component.resultIndex == CLASSIC_TOKEN_RESULT_INDEX) {
                if (
                    foundToken || component.account != expected.token || component.kind != ComponentKindV1.Token
                        || component.scope != ComponentScopeV1.Exclusive
                        || component.runtimeCodeHash != stampRequest.tokenRuntimeCodeHash
                ) revert InvalidBinding(BIND_CLASSIC_TOKEN_COMPONENT);
                foundToken = true;
            } else if (component.resultIndex == CLASSIC_REWARD_VAULT_RESULT_INDEX) {
                if (!_validClassicExclusive(component, expected.rewardVault) || foundRewardVault) {
                    revert InvalidBinding(BIND_CLASSIC_REWARD_COMPONENT);
                }
                foundRewardVault = true;
            } else if (component.resultIndex == CLASSIC_POSITION_RECIPIENT_RESULT_INDEX) {
                if (!_validClassicExclusive(component, expected.positionRecipient) || foundPositionRecipient) {
                    revert InvalidBinding(BIND_CLASSIC_POSITION_COMPONENT);
                }
                foundPositionRecipient = true;
            } else if (component.resultIndex == CLASSIC_INITIAL_BUY_CUSTODY_RESULT_INDEX) {
                if (
                    expected.initialBuyCustody == address(0)
                        || !_validClassicExclusive(component, expected.initialBuyCustody) || foundCustody
                ) revert InvalidBinding(BIND_CLASSIC_CUSTODY_COMPONENT);
                foundCustody = true;
            } else if (component.resultIndex == SHARED_INFRASTRUCTURE_RESULT_INDEX) {
                if (
                    foundHook || component.account != hook || component.kind != ComponentKindV1.Hook
                        || component.scope != ComponentScopeV1.SharedInfrastructure
                        || component.runtimeCodeHash != stampRequest.hookRuntimeCodeHash
                ) revert InvalidBinding(BIND_CLASSIC_HOOK_COMPONENT);
                bytes32 exclusiveHookLaunchId = launchIdByComponent[component.account];
                if (exclusiveHookLaunchId != bytes32(0)) {
                    revert ComponentAlreadyStamped(component.account, exclusiveHookLaunchId);
                }
                foundHook = true;
            } else {
                revert InvalidBinding(BIND_CLASSIC_COMPONENT_INDEX);
            }

            if (component.scope == ComponentScopeV1.Exclusive) {
                bytes32 existingLaunchId = launchIdByComponent[component.account];
                if (existingLaunchId != bytes32(0)) {
                    revert ComponentAlreadyStamped(component.account, existingLaunchId);
                }
            }
        }
        if (!foundToken || !foundRewardVault || !foundPositionRecipient || !foundCustody || !foundHook) {
            revert InvalidBinding(BIND_CLASSIC_COMPONENT_SET);
        }
    }

    function _validClassicExclusive(ComponentV1 calldata component, address expectedAccount)
        private
        pure
        returns (bool)
    {
        return component.account == expectedAccount && component.runtimeCodeHash != bytes32(0)
            && component.kind == ComponentKindV1.Other && component.scope == ComponentScopeV1.Exclusive;
    }

    function _decodeCustomGraphRoute(bytes calldata routePayload)
        private
        pure
        returns (CustomGraphRouteV1 memory route)
    {
        route = abi.decode(routePayload, (CustomGraphRouteV1));
        if (keccak256(routePayload) != keccak256(abi.encode(route))) revert NonCanonicalRoutePayload();
    }

    function _decodeClassicRoute(bytes calldata routePayload) private pure returns (ClassicRouteV1 memory route) {
        route = abi.decode(routePayload, (ClassicRouteV1));
        if (keccak256(routePayload) != keccak256(abi.encode(route))) revert NonCanonicalRoutePayload();
    }

    function _authorization(CustomGraphRouteV1 memory route, uint256 value)
        private
        view
        returns (IProgrammableCreate2GraphDeployerV1.GraphAuthorization memory)
    {
        return IProgrammableCreate2GraphDeployerV1.GraphAuthorization({
            routeNamespace: route.routeNamespace,
            routeNonce: route.routeNonce,
            topologyHash: route.topologyHash,
            graphCommitment: route.graphCommitment,
            authorizedLauncher: address(this),
            totalValue: value
        });
    }

    function _validateCustomGraphShape(
        CustomGraphRouteV1 memory route,
        StampRequestV1 calldata stampRequest,
        LaunchPermitV1 calldata permit
    ) private view {
        uint256 length = route.targets.length;
        if (length == 0 || length > MAX_CUSTOM_GRAPH_TARGETS) {
            revert InvalidArrayLength(ARRAY_GRAPH_TARGETS, length, MAX_CUSTOM_GRAPH_TARGETS);
        }
        if (route.expectedOutputs.length != length) {
            revert InvalidArrayLength(ARRAY_GRAPH_OUTPUTS, route.expectedOutputs.length, length);
        }
        if (stampRequest.components.length != length) {
            revert InvalidArrayLength(ARRAY_GRAPH_COMPONENTS, stampRequest.components.length, length);
        }
        if (
            route.routeNamespace == bytes32(0) || route.routeNonce != permit.nonce || route.topologyHash == bytes32(0)
                || route.graphCommitment == bytes32(0) || route.expectedGraphDeploymentHash == bytes32(0)
        ) revert InvalidBinding(BIND_GRAPH_AUTHORIZATION);

        bytes32 expectedResultHash = _expectedGraphResultHash(route.expectedOutputs, route.expectedGraphDeploymentHash);
        if (expectedResultHash != permit.expectedResultHash) revert InvalidBinding(BIND_EXPECTED_RESULT);

        bool[] memory targetSeen = new bool[](length);
        bool foundToken;
        bool foundHook;
        address hook = address(stampRequest.poolKey.hooks);
        for (uint256 index; index < length; ++index) {
            ExpectedGraphOutputV1 memory output = route.expectedOutputs[index];
            if (
                output.targetIndex != index || output.targetIdHash != route.targets[index].targetIdHash
                    || output.account == address(0) || output.runtimeCodeHash == bytes32(0)
            ) revert InvalidBinding(BIND_EXPECTED_OUTPUT);
            for (uint256 prior; prior < index; ++prior) {
                if (route.expectedOutputs[prior].account == output.account) {
                    revert InvalidBinding(BIND_DUPLICATE_OUTPUT);
                }
            }

            ComponentV1 calldata component = stampRequest.components[index];
            uint256 targetIndex = component.resultIndex;
            if (
                targetIndex >= length || targetSeen[targetIndex] || component.scope != ComponentScopeV1.Exclusive
                    || component.account != route.expectedOutputs[targetIndex].account
                    || component.runtimeCodeHash != route.expectedOutputs[targetIndex].runtimeCodeHash
                    || component.account == address(GRAPH_FACTORY) || component.account == address(POOL_MANAGER)
            ) revert InvalidBinding(BIND_EXCLUSIVE_COMPONENT_SET);
            targetSeen[targetIndex] = true;
            bytes32 existingLaunchId = launchIdByComponent[component.account];
            if (existingLaunchId != bytes32(0)) revert ComponentAlreadyStamped(component.account, existingLaunchId);

            if (component.account == stampRequest.token) {
                if (
                    component.kind != ComponentKindV1.Token
                        || component.runtimeCodeHash != stampRequest.tokenRuntimeCodeHash
                ) revert InvalidBinding(BIND_TOKEN_COMPONENT);
                foundToken = true;
            } else if (component.account == hook) {
                if (
                    component.kind != ComponentKindV1.Hook
                        || component.runtimeCodeHash != stampRequest.hookRuntimeCodeHash
                ) revert InvalidBinding(BIND_HOOK_COMPONENT);
                foundHook = true;
            } else if (component.kind != ComponentKindV1.Other) {
                revert InvalidBinding(BIND_COMPONENT_KIND);
            }
        }
        if (!foundToken || !foundHook || stampRequest.token == hook) {
            revert InvalidBinding(BIND_REQUIRED_COMPONENTS);
        }
    }

    function _validateGraphExecution(
        CustomGraphRouteV1 memory route,
        StampRequestV1 calldata stampRequest,
        GraphExecutionV1 memory execution
    ) private view {
        uint256 length = route.expectedOutputs.length;
        if (
            execution.deployments.length != length || execution.runtimeCodeHashes.length != length
                || execution.runtimeCodes.length != length
                || execution.graphDeploymentHash != route.expectedGraphDeploymentHash
        ) revert FactoryResultMismatch(RESULT_ENVELOPE, 0);

        for (uint256 index; index < length; ++index) {
            ExpectedGraphOutputV1 memory expected = route.expectedOutputs[index];
            if (
                execution.deployments[index] != expected.account
                    || execution.runtimeCodeHashes[index] != expected.runtimeCodeHash
                    || keccak256(execution.runtimeCodes[index]) != expected.runtimeCodeHash
                    || expected.account.code.length == 0 || expected.account.codehash != expected.runtimeCodeHash
            ) revert FactoryResultMismatch(RESULT_DEPLOYMENT, index);

            ComponentV1 calldata component = _componentByResultIndex(stampRequest.components, uint8(index));
            if (component.account != expected.account || component.runtimeCodeHash != expected.runtimeCodeHash) {
                revert FactoryResultMismatch(RESULT_COMPONENT, index);
            }
        }
    }

    function _validateMarket(StampRequestV1 calldata request) private view returns (ValidatedMarketV1 memory market) {
        market.hook = address(request.poolKey.hooks);
        address currency0 = Currency.unwrap(request.poolKey.currency0);
        address currency1 = Currency.unwrap(request.poolKey.currency1);
        if (
            currency0 >= currency1 || request.token == address(0) || market.hook == address(0)
                || (request.token != currency0 && request.token != currency1)
        ) revert InvalidBinding(BIND_POOL_KEY);

        _requireRuntime(request.token, request.tokenRuntimeCodeHash);
        _requireRuntime(market.hook, request.hookRuntimeCodeHash);
        for (uint256 index; index < request.components.length; ++index) {
            _requireRuntime(request.components[index].account, request.components[index].runtimeCodeHash);
        }

        PoolId poolId = request.poolKey.toId();
        market.poolId = PoolId.unwrap(poolId);
        (uint160 sqrtPriceX96,,,) = POOL_MANAGER.getSlot0(poolId);
        if (sqrtPriceX96 == 0) revert InvalidBinding(BIND_POOL_UNINITIALIZED);
        bytes32 existingPoolLaunchId = _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), market.poolId)];
        if (existingPoolLaunchId != bytes32(0)) {
            revert PoolAlreadyStamped(address(POOL_MANAGER), market.poolId, existingPoolLaunchId);
        }
        bytes32 existingTokenLaunchId = launchIdByToken[request.token];
        if (existingTokenLaunchId != bytes32(0)) {
            revert ComponentAlreadyStamped(request.token, existingTokenLaunchId);
        }
        market.poolKeyHash = computePoolKeyHash(request.poolKey);
        market.componentSetHash = computeComponentSetHash(request.components);
    }

    function _stampHash(LaunchPermitV1 calldata permit, bytes32 launchId, bytes32 poolId, bytes32 digest)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                LAUNCH_STAMP_TYPEHASH,
                CHAIN_ID,
                address(this),
                launchId,
                permit.launchWallet,
                uint8(permit.kind),
                permit.routePayloadHash,
                permit.expectedResultHash,
                permit.stampRequestHash,
                digest,
                address(POOL_MANAGER),
                poolId
            )
        );
    }

    function _writeStamp(
        LaunchPermitV1 calldata permit,
        StampRequestV1 calldata request,
        ValidatedMarketV1 memory market,
        RouteExecutionV1 memory execution,
        bytes32 digest,
        bytes32 stampHash
    ) private {
        if (execution.observedResultHash != permit.expectedResultHash) {
            revert InvalidBinding(BIND_RESULT_WRITE);
        }
        _launchStamp[request.launchId] = StampRecordV1({
            kind: permit.kind,
            launchWallet: permit.launchWallet,
            token: request.token,
            hook: market.hook,
            poolManager: address(POOL_MANAGER),
            poolId: market.poolId,
            poolKeyHash: market.poolKeyHash,
            componentSetHash: market.componentSetHash,
            routePayloadHash: permit.routePayloadHash,
            routeLauncher: execution.launcher,
            routeLauncherRuntimeCodeHash: execution.launcherRuntimeCodeHash,
            expectedResultHash: permit.expectedResultHash,
            permitDigest: digest,
            stampHash: stampHash
        });
        launchIdByToken[request.token] = request.launchId;
        _launchIdByPool[_poolLookupKey(address(POOL_MANAGER), market.poolId)] = request.launchId;

        for (uint256 index; index < request.components.length; ++index) {
            ComponentV1 calldata component = request.components[index];
            if (component.scope == ComponentScopeV1.Exclusive) {
                launchIdByComponent[component.account] = request.launchId;
                componentRuntimeCodeHash[component.account] = component.runtimeCodeHash;
            }
            emit ProgrammableComponentStampedV1(
                request.launchId, component.account, component.kind, component.runtimeCodeHash
            );
        }
        emit ProgrammableLaunchRouteStampedV1(
            request.launchId, permit.kind, permit.routePayloadHash, permit.expectedResultHash, digest
        );
        emit ProgrammableLaunchStampedV1(
            request.launchId, request.token, market.hook, address(POOL_MANAGER), market.poolId, stampHash
        );
    }

    function _expectedGraphResultHash(ExpectedGraphOutputV1[] memory outputs, bytes32 graphDeploymentHash)
        private
        pure
        returns (bytes32)
    {
        bytes32[] memory outputHashes = new bytes32[](outputs.length);
        for (uint256 index; index < outputs.length; ++index) {
            ExpectedGraphOutputV1 memory output = outputs[index];
            outputHashes[index] = keccak256(
                abi.encode(
                    EXPECTED_GRAPH_OUTPUT_TYPEHASH,
                    output.targetIndex,
                    output.targetIdHash,
                    output.account,
                    output.runtimeCodeHash
                )
            );
        }
        return keccak256(
            abi.encode(EXPECTED_GRAPH_RESULT_TYPEHASH, keccak256(abi.encodePacked(outputHashes)), graphDeploymentHash)
        );
    }

    function _classicResultHash(IMemeLaunchV3.LaunchResult memory result) private pure returns (bytes32) {
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
            keccak256(abi.encode(CLASSIC_RESULT_TYPEHASH, addressesHash, amountsHash, result.poolId, result.launchHash));
    }

    function _poolKeyHash(PoolKey memory poolKey) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_KEY_TYPEHASH,
                Currency.unwrap(poolKey.currency0),
                Currency.unwrap(poolKey.currency1),
                poolKey.fee,
                poolKey.tickSpacing,
                address(poolKey.hooks)
            )
        );
    }

    function _componentByResultIndex(ComponentV1[] calldata components, uint8 resultIndex)
        private
        pure
        returns (ComponentV1 calldata component)
    {
        for (uint256 index; index < components.length; ++index) {
            if (components[index].resultIndex == resultIndex) return components[index];
        }
        revert InvalidBinding(BIND_MISSING_RESULT_COMPONENT);
    }

    function _requireCode(uint8 field, address account) private view {
        if (account == address(0) || account.code.length == 0) revert InvalidBinding(field);
    }

    function _requireRuntime(address account, bytes32 expected) private view {
        bytes32 actual = account.codehash;
        if (account.code.length == 0 || expected == bytes32(0) || actual != expected) {
            revert InvalidComponent(account, expected, actual);
        }
    }

    function _poolLookupKey(address poolManager, bytes32 poolId) private pure returns (bytes32) {
        return keccak256(abi.encode(poolManager, poolId));
    }
}
