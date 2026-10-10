import {describe,it,expect} from 'vitest';
import {encodeFunctionResult,multicall3Abi} from 'viem';
import {executableClaims} from './claimability.mjs';

const claims=[1,2].map(n=>({id:String(n),to:`0x${String(n).padStart(40,'0')}`,data:'0x1150e874',permissionless:true}));
const client=results=>({call:async()=>({data:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result:results})})});
describe('claim execution checks',()=>{
  it('keeps unrelated claims available when one token refuses its payout',async()=>{
    const c=client([{success:true,returnData:'0x'},{success:false,returnData:'0x90bfb865'}]);
    const r=await executableClaims([c,c],claims,1n);
    expect(r.available.map(c=>c.id)).toEqual(['1']);expect(r.blocked.map(c=>c.claim.id)).toEqual(['2']);
  });
  it('omits amounts already claimed without turning them into blocked funds',async()=>{
    const c=client([{success:false,returnData:'0x9b0e91e1'},{success:false,returnData:'0x8a860200'}]);
    const r=await executableClaims([c,c],claims,1n);expect(r).toEqual({available:[],blocked:[]});
  });
  it('stops when providers disagree about a payout',async()=>{
    const good=client([{success:true,returnData:'0x'}]),bad=client([{success:false,returnData:'0x90bfb865'}]);
    await expect(executableClaims([good,bad],claims.slice(0,1),1n)).rejects.toThrow('stimmt nicht');
  });
});
