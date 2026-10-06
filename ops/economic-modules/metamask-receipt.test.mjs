import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeFunctionData,toHex} from 'viem';
import {DelegationManager} from '@metamask/delegation-abis';
import {assertWalletEnvelope,verifyWalletReceipt,METAMASK_RECEIPT_PINS as pins,selfDelegationType} from './metamask-receipt.mjs';
const account='0x'+'11'.repeat(20),target='0x'+'22'.repeat(20),other='0x'+'33'.repeat(20);
const expected={from:account,to:target,nonce:'0x1d',chainId:'0x1',value:'0x0',gas:'0x100000',maxFeePerGas:'0x100',data:'0x12345678'};
const delegation={delegate:account,delegator:account,authority:'0x'+'ff'.repeat(32),caveats:[{enforcer:pins.balanceEnforcer.address,terms:'0x01'+account.slice(2)+'00'.repeat(32),args:'0x'}],salt:1n,signature:'0x'+'01'.repeat(65)};
const payoutToken='0x'+'44'.repeat(20);
const payoutConstraints={erc20Increase:{token:payoutToken,recipient:account,maximumAmount:100n}};
const payoutGuard={enforcer:pins.erc20BalanceEnforcer.address,terms:'0x00'+payoutToken.slice(2)+account.slice(2)+toHex(90n,{size:32}).slice(2),args:'0x'};
const execution=target+toHex(0n,{size:32}).slice(2)+expected.data.slice(2);
function wrapped({delegations=[delegation],contexts,modes=[toHex(0n,{size:32})],executions=[execution],...changes}={}){
 const permissionContexts=contexts??[encodeAbiParameters(selfDelegationType,[delegations])];
 const data=encodeFunctionData({abi:DelegationManager,functionName:'redeemDelegations',args:[permissionContexts,modes,executions]});
 return {...expected,to:pins.manager.address,data,...changes};
}
test('direct requests remain strict and exact self-delegated requests are recognized',()=>{
 assert.equal(assertWalletEnvelope(expected,expected).kind,'direct');
 assert.equal(assertWalletEnvelope(wrapped(),expected).kind,'metamask-self-delegation');
 assert.equal(assertWalletEnvelope(wrapped({delegations:[]}),expected).kind,'metamask-self-delegation');
});
test('only the reviewed target, value and complete calldata may be executed',()=>{
 for(const executions of [[other+execution.slice(42)],[target+toHex(1n,{size:32}).slice(2)+expected.data.slice(2)],[execution+'00'],[execution.replace('12345678','87654321')]])assert.throws(()=>assertWalletEnvelope(wrapped({executions}),expected));
 assert.throws(()=>assertWalletEnvelope({...wrapped(),data:wrapped().data+'00'},expected));
});
test('additional calls, batch and failure-tolerant modes cannot advance the journal',()=>{
 const context=encodeAbiParameters(selfDelegationType,[[delegation]]),mode=toHex(0n,{size:32});
 assert.throws(()=>assertWalletEnvelope(wrapped({contexts:[context,context],modes:[mode,mode],executions:[execution,execution]}),expected));
 for(const modes of [['0x01'+'00'.repeat(31)],['0x0001'+'00'.repeat(30)]])assert.throws(()=>assertWalletEnvelope(wrapped({modes}),expected));
});
test('only self authority and the bounded native balance guard are supported',()=>{
 for(const changed of [{delegate:other},{delegator:other},{authority:toHex(1n,{size:32})},{caveats:[{...delegation.caveats[0],enforcer:other}]},{caveats:[{...delegation.caveats[0],terms:'0x01'+account.slice(2)+toHex(1n,{size:32}).slice(2)}]},{caveats:[{...delegation.caveats[0],args:'0x1234'}]}])assert.throws(()=>assertWalletEnvelope(wrapped({delegations:[{...delegation,...changed}]}),expected));
 assert.throws(()=>assertWalletEnvelope(wrapped({delegations:[delegation,delegation]}),expected));
});
test('wrapped requests retain sender, nonce, chain, gas and fee limits',()=>{
 for(const changes of [{from:other},{nonce:'0x1e'},{chainId:'0x1237'},{to:other},{value:'0x1'},{gas:'0x100001'},{maxFeePerGas:'0x101'}])assert.throws(()=>assertWalletEnvelope(wrapped(changes),expected));
});
test('a prepared payout admits its pinned increase guard alongside the native guard',()=>{
 const tx=wrapped({delegations:[{...delegation,caveats:[...delegation.caveats,payoutGuard]}]});
 assert.throws(()=>assertWalletEnvelope(tx,expected));
 const envelope=assertWalletEnvelope(tx,expected,payoutConstraints);
 assert.equal(envelope.kind,'metamask-self-delegation');
 assert.ok(envelope.pins.includes(pins.erc20BalanceEnforcer));
});
test('payout guards reject debits, other assets, recipients, amounts, arguments and duplicates',()=>{
 for(const changed of [
  {terms:'0x01'+payoutGuard.terms.slice(4)},
  {terms:'0x00'+other.slice(2)+payoutGuard.terms.slice(44)},
  {terms:'0x00'+payoutToken.slice(2)+other.slice(2)+toHex(90n,{size:32}).slice(2)},
  {terms:'0x00'+payoutToken.slice(2)+account.slice(2)+toHex(101n,{size:32}).slice(2)},
  {terms:'0x00'+payoutToken.slice(2)+account.slice(2)+toHex(0n,{size:32}).slice(2)},
  {terms:payoutGuard.terms+'00'},{args:'0x1234'},{enforcer:other},
 ])assert.throws(()=>assertWalletEnvelope(wrapped({delegations:[{...delegation,caveats:[{...payoutGuard,...changed}]}]}),expected,payoutConstraints));
 assert.throws(()=>assertWalletEnvelope(wrapped({delegations:[{...delegation,caveats:[payoutGuard,payoutGuard]}]}),expected,payoutConstraints));
 assert.throws(()=>assertWalletEnvelope(wrapped({delegations:[{...delegation,caveats:[...delegation.caveats,payoutGuard,payoutGuard]}]}),expected,payoutConstraints));
 assert.throws(()=>assertWalletEnvelope(wrapped({delegations:[{...delegation,caveats:[payoutGuard]}]}),expected,{erc20Increase:{...payoutConstraints.erc20Increase,recipient:other}}));
});
test('payout receipt verification also reads and pins the token balance enforcer runtime',async()=>{
 const addresses=[],tx=wrapped({delegations:[{...delegation,caveats:[...delegation.caveats,payoutGuard]}]});
 await assert.rejects(verifyWalletReceipt({getCode:async({address})=>{addresses.push(address);return '0x1234';}},tx,expected,{status:'success',blockNumber:1n,logs:[]},payoutConstraints));
 assert.ok(addresses.includes(pins.erc20BalanceEnforcer.address));
});
test('additional or different EIP-7702 authorizations are rejected',()=>{
 const authorization={address:pins.implementation.address,chainId:1,nonce:30};
 assert.equal(assertWalletEnvelope(wrapped({authorizationList:[authorization]}),expected).kind,'metamask-self-delegation');
 for(const list of [[authorization,authorization],[{...authorization,address:other}],[{...authorization,chainId:0}],[{...authorization,nonce:31}]])assert.throws(()=>assertWalletEnvelope(wrapped({authorizationList:list}),expected));
});
test('receipt verification refuses failed receipts and unpinned deployed code',async()=>{
 await assert.rejects(verifyWalletReceipt({},wrapped(),expected,{status:'reverted'}));
 await assert.rejects(verifyWalletReceipt({getCode:async()=> '0x1234'},wrapped(),expected,{status:'success',blockNumber:1n,logs:[]}));
});
