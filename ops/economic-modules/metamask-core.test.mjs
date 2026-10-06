import {test} from 'node:test';import assert from 'node:assert/strict';
import {decodeAbiParameters,decodeFunctionData,parseAbiParameters} from 'viem';
import {FAMILIES,ACCOUNT,BUY,FUNDING,configFor,caseSteps,swapData,routerAbi,assertEnvelope,digestRequest,simulationCheckpoint,isTransientBlockError} from './metamask-core.mjs';
test('all eleven families have bounded configurations and complete sell paths',()=>{assert.equal(FAMILIES.length,11);FAMILIES.forEach((_,i)=>{assert.match(configFor(i,ACCOUNT),/^0x[0-9a-f]+$/);assert.equal(caseSteps(i)[0],'launch');assert.ok(caseSteps(i).includes('sell'));});assert.throws(()=>configFor(11,ACCOUNT));});
test('funding, strategy size and approvals use small finite amounts',()=>{const v=decodeAbiParameters(parseAbiParameters('uint128,uint128,uint32,uint32,uint16,uint16'),configFor(1,ACCOUNT));assert.equal(v[1],100_000_000_000n);assert.equal(v[3],300);assert.equal(v[5],500);assert.ok(BUY*20n<=FUNDING);});
test('swap payload enforces the quoted minimum and a deadline',()=>{const quote='0x0000000000000000000000000000000000000001',token='0x0000000000000000000000000000000000000002';const key={currency0:quote,currency1:token,fee:0,tickSpacing:60,hooks:ACCOUNT};const data=swapData(key,quote,token,10n,8n,1000n);const decoded=decodeFunctionData({abi:routerAbi,data});assert.equal(decoded.args[2],1000n);const [actions,inputs]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),decoded.args[1][0]);assert.equal(actions,'0x060b0e');const [swap]=decodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'),inputs[0]);assert.equal(swap[3],8n);assert.throws(()=>swapData(key,quote,token,10n,0n,1000n));});
const req={from:ACCOUNT,to:ACCOUNT,data:'0x1234',value:'0x0',nonce:'0x3',gas:'0x100',maxFeePerGas:'0xa',chainId:'0x1'};
test('receipt cannot advance a step for a different transaction or inflated fee',()=>{assert.doesNotThrow(()=>assertEnvelope({...req,gas:'0xff',maxFeePerGas:'0x9'},req));for(const changed of [{value:'0x1'},{nonce:'0x4'},{chainId:'0x1237'},{data:'0xabcd'},{gas:'0x101'},{maxFeePerGas:'0xb'},{to:'0x0000000000000000000000000000000000000001'}])assert.throws(()=>assertEnvelope({...req,...changed},req));assert.equal(digestRequest(req),digestRequest({...req}));});
test('conditional modules retain their waits and reference checks',()=>{assert.ok(caseSteps(7).includes('cooldown'));assert.ok(caseSteps(0).indexOf('price-history')<caseSteps(0).indexOf('execute'));assert.ok(caseSteps(1).indexOf('sell-half')<caseSteps(1).indexOf('execute'));assert.ok(caseSteps(10).indexOf('reference-restored')<caseSteps(10).indexOf('sell'));});
test('simulation waits for the latest human transaction on the slower RPC',()=>{
 assert.equal(simulationCheckpoint([100n,105n],16n,80n),84n);
 assert.equal(simulationCheckpoint([100n,105n],16n,85n),null);
 assert.equal(simulationCheckpoint([101n,106n],16n,85n),85n);
 assert.equal(simulationCheckpoint([102n,103n],2n,100n),100n);
 assert.equal(simulationCheckpoint([1n,2n],16n),null);
 assert.throws(()=>simulationCheckpoint([],2n));
});
test('only missing-block errors receive a short retry, not contract reverts',()=>{
 assert.equal(isTransientBlockError({cause:{cause:{rpcMessage:'header not found'}}}),true);
 assert.equal(isTransientBlockError({name:'BlockNotFoundError'}),true);
 assert.equal(isTransientBlockError({rpcMessage:'execution reverted',data:'0x1234'}),false);
 const circular={};circular.cause=circular;assert.equal(isTransientBlockError(circular),false);
});
