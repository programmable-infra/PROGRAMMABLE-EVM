import {decodeAbiParameters,decodeEventLog,decodeFunctionData,encodeAbiParameters,encodeFunctionData,keccak256,parseAbiParameters,toHex} from 'viem';
import {recoverAuthorizationAddress} from 'viem/utils';
import {DelegationManager} from '@metamask/delegation-abis';
import {assertEnvelope,check} from './metamask-core.mjs';

// MetaMask Delegation Framework v1.3.0. Manager/implementation pins match
// ProtocolRevenueExecutionEnforcerV1; all three were read back on two Ethereum RPCs.
export const METAMASK_RECEIPT_PINS = {
 manager:{address:'0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',hash:'0x762a7ccac3fba1fce7751870298c097c0d050451d9b4a1f0935e65dc4078d1d3'},
 implementation:{address:'0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B',hash:'0x0b77e469f5603ed1e9ff0e7ee56238b61a8cf7cb3185b33e53e2eeaad50109ab'},
 balanceEnforcer:{address:'0xbD7B277507723490Cd50b12EaaFe87C616be6880',hash:'0x61f455a893e4dcb39599bfcd8f59000e438c52639b278b933e469610c7761b76'},
};
export const selfDelegationType=parseAbiParameters('(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const requireMatch=(value)=>check(value,'Die MetaMask-Transaktion stimmt nicht mit dem vorbereiteten Auftrag überein.');

// This only verifies a mined wallet envelope; it never creates or signs delegations.
export function assertWalletEnvelope(actual,expected){
 if(same(actual.to,expected.to)){assertEnvelope(actual,expected);return {kind:'direct'};}
 requireMatch(BigInt(expected.chainId)===1n&&BigInt(actual.chainId)===1n);
 requireMatch(same(actual.to,METAMASK_RECEIPT_PINS.manager.address)&&BigInt(actual.value)===0n);
 const data=actual.input??actual.data;
 const decoded=decodeFunctionData({abi:DelegationManager,data});
 requireMatch(decoded.functionName==='redeemDelegations');
 const [contexts,modes,executions]=decoded.args;
 requireMatch(contexts.length===1&&modes.length===1&&executions.length===1&&modes[0]===toHex(0n,{size:32}));
 requireMatch(encodeFunctionData({abi:DelegationManager,functionName:'redeemDelegations',args:decoded.args}).toLowerCase()===data.toLowerCase());
 const packed=executions[0];requireMatch(packed.length>=106);
 const inner={to:packed.slice(0,42),value:BigInt('0x'+packed.slice(42,106)),input:'0x'+packed.slice(106)};
 // Retain the reviewed account, nonce, chain, gas ceiling and exact target/value/calldata.
 assertEnvelope({...actual,...inner},expected);
 const [delegations]=decodeAbiParameters(selfDelegationType,contexts[0]);
 requireMatch(encodeAbiParameters(selfDelegationType,[delegations]).toLowerCase()===contexts[0].toLowerCase());
 requireMatch(delegations.length<=1);
 const pins=[METAMASK_RECEIPT_PINS.manager,METAMASK_RECEIPT_PINS.implementation];
 if(delegations.length){
  const d=delegations[0];
  requireMatch(same(d.delegate,expected.from)&&same(d.delegator,expected.from)&&d.authority==='0x'+'ff'.repeat(32));
  requireMatch(d.caveats.length<=1);
  for(const caveat of d.caveats){
   requireMatch(same(caveat.enforcer,METAMASK_RECEIPT_PINS.balanceEnforcer.address)&&caveat.args==='0x');
   // Only the wallet's native-balance guard, bounded by the requested native value.
   requireMatch(same(caveat.terms,'0x01'+expected.from.slice(2)+toHex(BigInt(expected.value),{size:32}).slice(2)));
   pins.push(METAMASK_RECEIPT_PINS.balanceEnforcer);
  }
 }
 const auth=actual.authorizationList??[];requireMatch(auth.length<=1);
 for(const a of auth){
  requireMatch(BigInt(a.chainId)===1n&&same(a.address,METAMASK_RECEIPT_PINS.implementation.address)&&BigInt(a.nonce)===BigInt(actual.nonce)+1n);
 }
 return {kind:'metamask-self-delegation',pins,permissionContext:contexts[0],hasDelegation:delegations.length===1};
}

export async function verifyWalletReceipt(client,actual,expected,receipt){
 const envelope=assertWalletEnvelope(actual,expected);
 if(envelope.kind==='direct')return envelope.kind;
 requireMatch(receipt.status==='success');
 const codes=await Promise.all(envelope.pins.map(pin=>client.getCode({address:pin.address,blockNumber:receipt.blockNumber})));
 requireMatch(codes.every((code,i)=>code&&keccak256(code)===envelope.pins[i].hash));
 const accountCode=await client.getCode({address:expected.from,blockNumber:receipt.blockNumber});
 requireMatch(same(accountCode,'0xef0100'+METAMASK_RECEIPT_PINS.implementation.address.slice(2)));
 for(const a of actual.authorizationList??[]){
  const recovered=await recoverAuthorizationAddress({authorization:{...a,chainId:Number(BigInt(a.chainId)),nonce:Number(BigInt(a.nonce)),yParity:Number(BigInt(a.yParity))}});
  requireMatch(same(recovered,expected.from));
 }
 if(envelope.hasDelegation){
  const events=receipt.logs.flatMap(log=>{
   if(!same(log.address,METAMASK_RECEIPT_PINS.manager.address))return [];
   try{const event=decodeEventLog({abi:DelegationManager,data:log.data,topics:log.topics});return event.eventName==='RedeemedDelegation'?[event.args]:[];}catch{return [];}
  });
  requireMatch(events.length===1&&same(events[0].rootDelegator,expected.from)&&same(events[0].redeemer,expected.from));
  requireMatch(encodeAbiParameters(selfDelegationType,[[events[0].delegation]]).toLowerCase()===envelope.permissionContext.toLowerCase());
 }
 return envelope.kind;
}
