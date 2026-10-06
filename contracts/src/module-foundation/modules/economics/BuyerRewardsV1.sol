// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { SharedModuleBaseV1, SharedBindingsV1, ISharedLedgerV1 } from "./SharedModuleBaseV1.sol";
import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleV1 } from "../../IFoundationModuleV1.sol";

/// @notice Separately funded buyer rewards, deterministic Nth-buy pot or a continuing King-of-the-Hill crown.
/// @dev Accounting in the swap; permissionless payment afterward to the recorded beneficiary only.
contract BuyerRewardsV1 is SharedModuleBaseV1 {
    enum Kind {
        BuyerRewards,
        NthBuyPot,
        KingOfTheHill
    }
    Kind public kind;
    uint128 public minimumBuy;
    uint16 public rewardBps;
    uint32 public everyN;
    uint32 public crownDecaySeconds;
    uint256 public accountedCredits;
    uint256 public reserve;
    uint256 public totalOwed;
    uint256 public totalPaid;
    mapping(address => uint256) public owed;
    uint256 public qualifyingBuys;
    uint256 public lastQualifyingBlock;
    address public king;
    uint256 public crownBuy;
    uint256 public crownedAt;
    bytes4 public constant PAY = bytes4(keccak256("pay(address[])"));

    event RewardAccrued(address indexed beneficiary, uint256 amount);
    event RewardPaid(address indexed beneficiary, uint256 amount);
    event CrownChanged(address indexed king, uint256 qualifyingBuy);

    constructor(T.ModuleContext memory c, bytes memory config, SharedBindingsV1.Bindings memory b, Kind k)
        SharedModuleBaseV1(c, config, b)
    {
        if (config.length != 128) revert InvalidConfiguration();
        (minimumBuy, rewardBps, everyN, crownDecaySeconds) = abi.decode(config, (uint128, uint16, uint32, uint32));
        if (minimumBuy == 0 || rewardBps > 1000 || everyN > 1_000_000 || crownDecaySeconds > 30 days) {
            revert InvalidConfiguration();
        }
        if (k == Kind.BuyerRewards && (rewardBps == 0 || everyN != 0 || crownDecaySeconds != 0)) {
            revert InvalidConfiguration();
        }
        if (k == Kind.NthBuyPot && (everyN < 2 || rewardBps != 0 || crownDecaySeconds != 0)) {
            revert InvalidConfiguration();
        }
        if (k == Kind.KingOfTheHill && (crownDecaySeconds < 60 || rewardBps != 0 || everyN != 0)) {
            revert InvalidConfiguration();
        }
        kind = k;
    }

    function descriptor() external view returns (T.Descriptor memory) {
        bytes32 id = kind == Kind.BuyerRewards
            ? keccak256("programmable.foundation.buyer-rewards.v1")
            : kind == Kind.NthBuyPot
                ? keccak256("programmable.foundation.nth-buy-pot.v1")
                : keccak256("programmable.foundation.king-of-the-hill.v1");
        return T.Descriptor(id, 1, T.AFTER_SWAP | T.ACTION, T.OWN_QUOTE_BUDGET, 0, 240_000, 1_500_000, false, id);
    }

    function onBeforeSwap(T.SwapContext calldata s) external view onlySwap(s) returns (bytes4) {
        return IFoundationModuleV1.onBeforeSwap.selector;
    }

    function onAfterSwap(T.SwapContext calldata s) external onlySwap(s) returns (bytes4) {
        uint256 credits = ISharedLedgerV1(_context.ledger).moduleCredited(address(this));
        uint256 added = credits - accountedCredits;
        accountedCredits = credits;
        if (kind == Kind.KingOfTheHill && king != address(0)) _award(king, added);
        else reserve += added;

        // Unknown routers may trade freely but cannot claim a reward or crown. Only an authenticated
        // sale can relinquish a crown; this is a pool game, not a global proof of uninterrupted holding.
        if (s.router != bindings.router) return IFoundationModuleV1.onAfterSwap.selector;
        address wallet = _actor(s.router);
        if (wallet == address(0)) return IFoundationModuleV1.onAfterSwap.selector;
        if (!s.buy) {
            if (kind == Kind.KingOfTheHill && king == wallet) {
                king = address(0);
                crownBuy = 0;
                emit CrownChanged(address(0), 0);
            }
            return IFoundationModuleV1.onAfterSwap.selector;
        }
        if (s.grossQuote < minimumBuy) return IFoundationModuleV1.onAfterSwap.selector;
        if (kind == Kind.BuyerRewards) {
            uint256 amount = FullMath.mulDiv(s.grossQuote, rewardBps, 10_000);
            if (amount > reserve) amount = reserve;
            reserve -= amount;
            _award(wallet, amount);
        } else if (kind == Kind.NthBuyPot) {
            if (block.number == lastQualifyingBlock) return IFoundationModuleV1.onAfterSwap.selector;
            lastQualifyingBlock = block.number;
            if (++qualifyingBuys % everyN == 0) {
                uint256 amount = reserve;
                reserve = 0;
                _award(wallet, amount);
            }
        } else if (s.grossQuote > crownThreshold() || king == address(0)) {
            king = wallet;
            crownBuy = s.grossQuote;
            crownedAt = block.timestamp;
            uint256 amount = reserve;
            reserve = 0;
            _award(wallet, amount);
            emit CrownChanged(wallet, s.grossQuote);
        }
        return IFoundationModuleV1.onAfterSwap.selector;
    }

    function crownThreshold() public view returns (uint256) {
        if (king == address(0)) return minimumBuy;
        uint256 elapsed = block.timestamp - crownedAt;
        if (elapsed >= crownDecaySeconds) return minimumBuy;
        return minimumBuy + FullMath.mulDiv(crownBuy - minimumBuy, crownDecaySeconds - elapsed, crownDecaySeconds);
    }

    function onAction(address, bytes calldata data) external onlyHost returns (bytes4) {
        if (data.length < 4 || bytes4(data[:4]) != PAY) revert InvalidAction();
        address[] memory beneficiaries = abi.decode(data[4:], (address[]));
        if (beneficiaries.length == 0 || beneficiaries.length > 16) revert InvalidAction();
        for (uint256 i; i < beneficiaries.length; ++i) {
            address beneficiary = beneficiaries[i];
            uint256 amount = owed[beneficiary];
            if (amount == 0) continue;
            // The ledger settles int128 per withdrawal. Larger balances are paid over multiple calls.
            if (amount > uint256(uint128(type(int128).max))) amount = uint256(uint128(type(int128).max));
            owed[beneficiary] -= amount;
            totalOwed -= amount;
            totalPaid += amount;
            ISharedLedgerV1(_context.ledger).claimModule(amount);
            _pay(beneficiary, amount);
            emit RewardPaid(beneficiary, amount);
        }
        return IFoundationModuleV1.onAction.selector;
    }

    function _award(address beneficiary, uint256 amount) private {
        if (amount == 0) return;
        owed[beneficiary] += amount;
        totalOwed += amount;
        emit RewardAccrued(beneficiary, amount);
    }
}
