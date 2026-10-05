// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { FoundationFactoryV3EthereumNative } from "./FoundationFactoryV3EthereumNative.sol";
import { FoundationHookDeployerV2 } from "./FoundationHookDeployerV2.sol";
import { FoundationTokenV1 } from "./FoundationTokenV1.sol";
import { FoundationHookV2 } from "./FoundationHookV2.sol";
import { IFoundationUniversalRouterV2 } from "./FoundationFactoryV2.sol";
import { FoundationLaunchTypesV3 as P } from "./FoundationLaunchTypesV3.sol";
import { FoundationLaunchTypesV2 as L } from "./FoundationLaunchTypesV2.sol";
import { FoundationTypesV1 as T } from "./FoundationTypesV1.sol";

/// @notice Initializes fresh graph token and hook outputs using the same Module Mode settlement engine.
/// @dev A CustomGraph stamp is issued by the existing canonical Router, never by this initializer.
/// Its graph deployment and permit must be prepared and authorized before executing the Router.
contract FoundationEthereumGraphLaunchV1 is FoundationFactoryV3EthereumNative {
    bytes32 public constant GRAPH_MODE_ID = keccak256("programmable.module-foundation.ethereum-graph.v1");
    address public immutable GRAPH_FACTORY;
    address public LAUNCH_WALLET;
    address private immutable _wrappedEth;
    bytes32 private immutable _wrappedEthCodeHash;
    bytes32 public parametersHash;
    bool public initialized;
    bool private _initializing;
    FoundationTokenV1 private _graphToken;
    FoundationHookV2 private _graphHook;

    error GraphPredictionRequired();

    constructor(
        IPoolManager manager,
        IPositionManager positions,
        IFoundationUniversalRouterV2 router,
        IAllowanceTransfer permits,
        address graphFactory,
        bytes32[5] memory expectedCodeHashes
    )
        FoundationFactoryV3EthereumNative(
            manager, positions, router, permits, FoundationHookDeployerV2(graphFactory), expectedCodeHashes
        )
    {
        GRAPH_FACTORY = graphFactory;
        _wrappedEth = wrappedEth;
        _wrappedEthCodeHash = wrappedEthCodeHash;
        // The implementation itself cannot become a launch account.
        LAUNCH_WALLET = address(this);
        initialized = true;
    }

    /// @notice Called by the immutable proxy constructor while the graph creates its targets.
    function initializeGraphWallet(address launchWallet) external {
        if (
            msg.sender != GRAPH_FACTORY || LAUNCH_WALLET != address(0) || initialized || launchWallet == address(0)
                || launchWallet == GRAPH_FACTORY
        ) revert InvalidConfiguration();
        LAUNCH_WALLET = launchWallet;
        NATIVE_FUNDING_ID = keccak256("programmable.module-foundation.native-funding.v2");
        wrappedEth = _wrappedEth;
        wrappedEthCodeHash = _wrappedEthCodeHash;
    }

    /// @notice The Graph Factory calls this only after all graph constructors have completed.
    function initializeGraph(P.LaunchParamsV3 calldata p, address token, address hook, bytes calldata fundingPath)
        external
        payable
        nonReentrant
        returns (L.LaunchResultV2 memory result)
    {
        if (
            msg.sender != GRAPH_FACTORY || initialized || LAUNCH_WALLET == address(0) || token.code.length == 0
                || hook.code.length == 0 || token == hook || fundingPath.length == 0 || msg.value >> 127 != 0
        ) revert InvalidConfiguration();
        initialized = true;
        parametersHash = keccak256(abi.encode(p));
        _initializing = true;
        _graphToken = FoundationTokenV1(token);
        _graphHook = FoundationHookV2(hook);
        uint256 nativeBefore = address(this).balance - msg.value;
        result = _launch(p, fundingPath);
        uint256 refund = address(this).balance - nativeBefore;
        if (refund != 0) {
            (bool sent,) = LAUNCH_WALLET.call{ value: refund }("");
            if (!sent) revert InvalidSettlement();
        }
        _initializing = false;
    }

    function _launchCreator() internal view override returns (address) {
        if (!_initializing || msg.sender != GRAPH_FACTORY) revert InvalidConfiguration();
        return LAUNCH_WALLET;
    }

    function _createLaunchToken(P.LaunchParamsV3 calldata p) internal view override returns (FoundationTokenV1) {
        if (
            _graphToken.metadataHash() != keccak256(abi.encode(p.metadata))
                || _graphToken.totalSupply() != T.TOKEN_SUPPLY || _graphToken.balanceOf(address(this)) != T.TOKEN_SUPPLY
        ) {
            revert InvalidConfiguration();
        }
        return _graphToken;
    }

    function _createLaunchHook(P.LaunchParamsV3 calldata p, address token)
        internal
        view
        override
        returns (FoundationHookV2)
    {
        FoundationHookV2 hook = _graphHook;
        if (
            address(hook.poolManager()) != address(poolManager) || hook.initializer() != address(this)
                || hook.token() != token || hook.quote() != p.quote || hook.creator() != LAUNCH_WALLET
                || hook.initialTick() != p.initialTick || hook.creatorBuyFeeBps() != p.creatorBuyFeeBps
                || hook.creatorSellFeeBps() != p.creatorSellFeeBps
                || hook.compositionHash() != keccak256(abi.encode(T.ABI_ID, p.modules))
        ) revert InvalidConfiguration();
        return hook;
    }

    // Direct-factory predictions have different CREATE2 salts and cannot authorize graph targets.
    function predictTokenAddress(address, bytes32, T.Metadata calldata) public pure override returns (address) {
        revert GraphPredictionRequired();
    }

    function hookInitCodeHash(address, address, P.LaunchParamsV3 calldata) public pure override returns (bytes32) {
        revert GraphPredictionRequired();
    }

    function predictHookAddress(address, address, P.LaunchParamsV3 calldata) external pure override returns (address) {
        revert GraphPredictionRequired();
    }
}
