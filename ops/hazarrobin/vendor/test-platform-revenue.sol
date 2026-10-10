// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice Separately provable canonical and additional platform credits with one fixed payout destination.
/// @dev No owner, upgrades, delegated spending or arbitrary recipient. Existing credits survive hook replacement.
contract TestPlatformRevenue {
    IPoolManager public immutable poolManager;
    address public immutable beneficiary;
    address public immutable graphFactory;
    address public hook;
    uint256 public canonicalPlatformBalance;
    uint256 public additionalPlatformBalance;
    error InvalidConfiguration();
    error InvalidClaim();
    error NotPoolManager();
    error NotHook();
    event Allocated(uint256 canonicalAmount,uint256 additionalAmount);
    event Claimed(address indexed beneficiary,bool canonical,uint256 amount);
    constructor(IPoolManager manager,address beneficiary_,address factory_) {
        if(address(manager).code.length==0||beneficiary_==address(0)||factory_.code.length==0)revert InvalidConfiguration();
        poolManager=manager;beneficiary=beneficiary_;graphFactory=factory_;
    }
    function initialize(address hook_) external {
        if(msg.sender!=graphFactory||hook!=address(0)||hook_.code.length==0)revert InvalidConfiguration();
        hook=hook_;
    }
    function balance() public view returns(uint256) {return poolManager.balanceOf(address(this),0);}
    function recordAllocation(uint256 canonicalAmount,uint256 additionalAmount) external {
        if(msg.sender!=hook)revert NotHook();
        if(balance()<canonicalPlatformBalance+additionalPlatformBalance+canonicalAmount+additionalAmount)revert InvalidConfiguration();
        canonicalPlatformBalance+=canonicalAmount;additionalPlatformBalance+=additionalAmount;
        emit Allocated(canonicalAmount,additionalAmount);
    }
    function unassignedBalance() public view returns(uint256){return balance()-canonicalPlatformBalance-additionalPlatformBalance;}
    function claimUnassigned(uint256 amount) external {if(amount==0||amount>unassignedBalance())revert InvalidClaim();poolManager.unlock(abi.encode(uint8(2),amount));}
    function claimCanonical(uint256 amount) external {_claim(true,amount);}
    function claimAdditional(uint256 amount) external {_claim(false,amount);}
    function _claim(bool canonical,uint256 amount) private {
        uint256 available=canonical?canonicalPlatformBalance:additionalPlatformBalance;
        if(amount==0||amount>available)revert InvalidClaim();
        if(canonical)canonicalPlatformBalance-=amount;else additionalPlatformBalance-=amount;
        poolManager.unlock(abi.encode(canonical?uint8(0):uint8(1),amount));
    }
    function unlockCallback(bytes calldata data) external returns(bytes memory) {
        if(msg.sender!=address(poolManager))revert NotPoolManager();
        (uint8 kind,uint256 amount)=abi.decode(data,(uint8,uint256));
        poolManager.burn(address(this),0,amount);
        poolManager.take(Currency.wrap(address(0)),beneficiary,amount);
        emit Claimed(beneficiary,kind==0,amount);
        return "";
    }
}
