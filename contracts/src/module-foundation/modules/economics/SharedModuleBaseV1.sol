// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";

interface ISharedLedgerV1 {
    function moduleShareBps(address module) external view returns (uint16);
    function moduleCredited(address module) external view returns (uint256);
    function moduleClaimed(address module) external view returns (uint256);
    function claimModule(uint256 amount) external;
}

interface ISharedRouterV1 {
    function msgSender() external view returns (address);
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface ISharedHostV1 {
    struct Module {
        address instance;
        bytes32 codeHash;
        bytes32 configurationHash;
        T.Descriptor descriptor;
    }
    function initializer() external view returns (address);
    function moduleCount() external view returns (uint256);
    function moduleAt(uint256 index) external view returns (Module memory);
}

library SharedBindingsV1 {
    struct Bindings {
        address manager;
        address router;
        address permit2;
        bytes32 managerHash;
        bytes32 routerHash;
        bytes32 permit2Hash;
    }
    error UnsupportedChain();

    function current() internal view returns (Bindings memory b) {
        b.permit2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
        if (block.chainid == 1) {
            b.manager = 0x000000000004444c5dc75cB358380D2e3dE08A90;
            b.router = 0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA;
            b.managerHash = 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
            b.routerHash = 0x70c9ea2b275087aea3d57ae48e2d30e272a07ff5b6c7974bd47c21478b37face;
            b.permit2Hash = 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131;
        } else if (block.chainid == 4663) {
            b.manager = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
            b.router = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
            b.managerHash = 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
            b.routerHash = 0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5;
            b.permit2Hash = 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca;
        } else {
            revert UnsupportedChain();
        }
    }
}

/// @dev The existing host, ledger and platform fee are unchanged. No module can access another budget.
abstract contract SharedModuleBaseV1 is IFoundationModuleV1 {
    using SafeERC20 for IERC20;
    error InvalidContext();
    error InvalidConfiguration();
    error OnlyHost();
    error UnsupportedRouter();
    error InvalidActor();
    error InvalidTransfer();
    error InvalidAction();

    T.ModuleContext internal _context;
    SharedBindingsV1.Bindings public bindings;
    bytes32 public configurationHash;

    constructor(T.ModuleContext memory c, bytes memory config, SharedBindingsV1.Bindings memory b) {
        if (
            c.host == address(0) || c.creator == address(0) || c.token == address(0) || c.quote == address(0)
                || c.token == c.quote || c.ledger == address(0) || c.poolId == 0
        ) revert InvalidContext();
        if (
            b.manager.code.length == 0 || b.manager.codehash != b.managerHash || b.router.code.length == 0
                || b.router.codehash != b.routerHash || b.permit2.code.length == 0
                || b.permit2.codehash != b.permit2Hash
        ) revert InvalidContext();
        _context = c;
        bindings = b;
        configurationHash = keccak256(config);
    }

    function context() external view returns (T.ModuleContext memory) {
        return _context;
    }
    modifier onlyHost() {
        if (msg.sender != _context.host) revert OnlyHost();
        _;
    }
    modifier onlySwap(T.SwapContext calldata s) {
        if (msg.sender != _context.host) revert OnlyHost();
        if (s.poolId != _context.poolId) revert InvalidContext();
        _;
    }

    /// @dev Authentic Universal Router initiator, not tx.origin or user-controlled hookData.
    /// A fee-funded module's own economic buy must not win its pool's rewards or games.
    function _actor(address router) internal view returns (address wallet) {
        if (router != bindings.router || router.codehash != bindings.routerHash) revert UnsupportedRouter();
        wallet = ISharedRouterV1(router).msgSender();
        if (wallet == address(0)) revert InvalidActor();
        ISharedHostV1 host = ISharedHostV1(_context.host);
        if (wallet == host.initializer()) return _context.creator;
        // The immutable ledger assigns positive shares only to installed budget modules.
        // A strategy with no share has no executable budget. This constant-cost lookup also
        // works for contract-wallet users when eight cold module records would exceed callback gas.
        if (ISharedLedgerV1(_context.ledger).moduleShareBps(wallet) != 0) return address(0);
    }

    function _available() internal view returns (uint256) {
        ISharedLedgerV1 l = ISharedLedgerV1(_context.ledger);
        return l.moduleCredited(address(this)) - l.moduleClaimed(address(this));
    }

    function _pay(address beneficiary, uint256 amount) internal {
        if (amount == 0) return;
        IERC20 quote = IERC20(_context.quote);
        uint256 beforeBalance = quote.balanceOf(beneficiary);
        uint256 beforeOwn = quote.balanceOf(address(this));
        quote.safeTransfer(beneficiary, amount);
        if (
            quote.balanceOf(beneficiary) != beforeBalance + amount
                || quote.balanceOf(address(this)) != beforeOwn - amount
        ) {
            revert InvalidTransfer();
        }
    }
}
