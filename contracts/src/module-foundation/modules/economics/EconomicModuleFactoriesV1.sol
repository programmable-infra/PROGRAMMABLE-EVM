// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../IFoundationModuleV1.sol";
import { SharedBindingsV1 } from "./SharedModuleBaseV1.sol";
import { FeeStrategyV1 } from "./FeeStrategyV1.sol";
import { BuyerRewardsV1 } from "./BuyerRewardsV1.sol";
import { PoolGamesV1 } from "./PoolGamesV1.sol";
import { LinkedPoolV1 } from "./LinkedPoolV1.sol";

abstract contract EconomicFactoryV1 is IFoundationModuleFactoryV1 {
    error OnlyBoundHost();
    modifier bound(T.ModuleContext calldata c) {
        if (msg.sender != c.host) revert OnlyBoundHost();
        _;
    }
}

abstract contract FeeStrategyFactoryV1 is EconomicFactoryV1 {
    function kind() public pure virtual returns (FeeStrategyV1.Kind);

    function createModule(T.ModuleContext calldata c, bytes calldata config) external bound(c) returns (address) {
        return address(new FeeStrategyV1(c, config, SharedBindingsV1.current(), kind()));
    }
}

contract BuybackBurnFactoryV1 is FeeStrategyFactoryV1 {
    function kind() public pure override returns (FeeStrategyV1.Kind) {
        return FeeStrategyV1.Kind.BuybackBurn;
    }
}

contract DipBuybackFactoryV1 is FeeStrategyFactoryV1 {
    function kind() public pure override returns (FeeStrategyV1.Kind) {
        return FeeStrategyV1.Kind.DipBuyback;
    }
}

contract LPRewardsFactoryV1 is FeeStrategyFactoryV1 {
    function kind() public pure override returns (FeeStrategyV1.Kind) {
        return FeeStrategyV1.Kind.LPRewards;
    }
}

contract FullRangeLPFactoryV1 is FeeStrategyFactoryV1 {
    function kind() public pure override returns (FeeStrategyV1.Kind) {
        return FeeStrategyV1.Kind.FullRangeLP;
    }
}

abstract contract RewardFactoryV1 is EconomicFactoryV1 {
    function kind() public pure virtual returns (BuyerRewardsV1.Kind);

    function createModule(T.ModuleContext calldata c, bytes calldata config) external bound(c) returns (address) {
        return address(new BuyerRewardsV1(c, config, SharedBindingsV1.current(), kind()));
    }
}

contract BuyerRewardsFactoryV1 is RewardFactoryV1 {
    function kind() public pure override returns (BuyerRewardsV1.Kind) {
        return BuyerRewardsV1.Kind.BuyerRewards;
    }
}

contract NthBuyPotFactoryV1 is RewardFactoryV1 {
    function kind() public pure override returns (BuyerRewardsV1.Kind) {
        return BuyerRewardsV1.Kind.NthBuyPot;
    }
}

contract KingOfTheHillFactoryV1 is RewardFactoryV1 {
    function kind() public pure override returns (BuyerRewardsV1.Kind) {
        return BuyerRewardsV1.Kind.KingOfTheHill;
    }
}

abstract contract PoolGameFactoryV1 is EconomicFactoryV1 {
    function kind() public pure virtual returns (PoolGamesV1.Kind);

    function createModule(T.ModuleContext calldata c, bytes calldata config) external bound(c) returns (address) {
        return address(new PoolGamesV1(c, config, SharedBindingsV1.current(), kind()));
    }
}

contract HotPotatoFactoryV1 is PoolGameFactoryV1 {
    function kind() public pure override returns (PoolGamesV1.Kind) {
        return PoolGamesV1.Kind.HotPotato;
    }
}

contract PlagueFactoryV1 is PoolGameFactoryV1 {
    function kind() public pure override returns (PoolGamesV1.Kind) {
        return PoolGamesV1.Kind.Plague;
    }
}

abstract contract LinkedPoolFactoryV1 is EconomicFactoryV1 {
    function kind() public pure virtual returns (LinkedPoolV1.Kind);

    function createModule(T.ModuleContext calldata c, bytes calldata config) external bound(c) returns (address) {
        return address(new LinkedPoolV1(c, config, SharedBindingsV1.current(), kind()));
    }
}

contract ReactivePairFactoryV1 is LinkedPoolFactoryV1 {
    function kind() public pure override returns (LinkedPoolV1.Kind) {
        return LinkedPoolV1.Kind.ReactivePair;
    }
}

contract EntangledFactoryV1 is LinkedPoolFactoryV1 {
    function kind() public pure override returns (LinkedPoolV1.Kind) {
        return LinkedPoolV1.Kind.Entangled;
    }
}
