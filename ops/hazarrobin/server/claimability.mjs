import {encodeFunctionData,decodeFunctionResult,multicall3Abi} from 'viem';
import {MULTICALL,same,mapLimit,need} from './rpc.mjs';

const EMPTY_CLAIM = new Set(['0x9b0e91e1','0x8a860200']);

/** Read-only execution checks keep a broken token from blocking unrelated fees. */
export async function executableClaims(clients,claims,blockNumber){
  const available=[],blocked=[];
  const accept=(claim,success,data)=>{
    if(success)available.push(claim);
    else if(!EMPTY_CLAIM.has(data.slice(0,10)))blocked.push({claim,reason:'Der Vertrag lehnt die Auszahlung derzeit ab.'});
  };
  const permissionless=claims.filter(c=>c.permissionless),chunks=[];
  for(let i=0;i<permissionless.length;i+=30)chunks.push(permissionless.slice(i,i+30));
  await mapLimit(chunks,2,async chunk=>{
    const data=encodeFunctionData({abi:multicall3Abi,functionName:'aggregate3',args:[chunk.map(c=>({target:c.to,allowFailure:true,callData:c.data}))]});
    const replies=await Promise.all(clients.map(c=>c.call({to:MULTICALL,data,blockNumber})));
    need(replies[0].data&&replies.every(r=>same(r.data,replies[0].data)),'Die Auszahlungsprüfung stimmt nicht überein.');
    const results=decodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',data:replies[0].data});
    results.forEach((r,i)=>accept(chunk[i],r.success,r.returnData));
  });
  await mapLimit(claims.filter(c=>!c.permissionless),3,async claim=>{
    const replies=await Promise.allSettled(clients.map(c=>c.call({to:claim.to,data:claim.data,account:claim.recipient,blockNumber})));
    if(replies.every(r=>r.status==='fulfilled')){
      need(replies.every(r=>same(r.value.data,replies[0].value.data)),'Die Auszahlungsprüfung stimmt nicht überein.');
      available.push(claim);
    }else{
      need(replies.every(r=>r.status==='rejected'&&/revert/i.test(String(r.reason?.shortMessage??r.reason?.message))),
        'Eine Auszahlung konnte wegen eines Netzwerkfehlers nicht geprüft werden.');
      blocked.push({claim,reason:'Der Vertrag lehnt die Auszahlung derzeit ab.'});
    }
  });
  const order=new Map(claims.map((c,i)=>[c.id,i]));
  available.sort((a,b)=>order.get(a.id)-order.get(b.id));
  return {available,blocked};
}
