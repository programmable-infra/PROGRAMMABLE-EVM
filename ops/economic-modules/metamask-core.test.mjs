import {test} from 'node:test';import assert from 'node:assert/strict';
import {decodeAbiParameters,decodeFunctionData,parseAbiParameters} from 'viem';
import {FAMILIES,ACCOUNT,BUY,FUNDING,configFor,caseSteps,swapData,routerAbi,assertEnvelope,digestRequest,simulationCheckpoint,isTransientBlockError,nthPotRecovery,boundedGasFees,launchGasBudget,MAXIMUM_GAS_DEBIT} from './metamask-core.mjs';
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
test('two trades counted in one block get one bounded recovery, never a false payout pass',()=>{
 const sameBlock={owed:0n,qualifyingBuys:1n,everyN:2n};
 assert.equal(nthPotRecovery(sameBlock,0),'qualifying-buy');
 assert.equal(nthPotRecovery(sameBlock,1),'stop');
 assert.equal(nthPotRecovery({...sameBlock,qualifyingBuys:2n},0),'stop');
 assert.equal(nthPotRecovery({...sameBlock,everyN:3n},0),'stop');
 assert.equal(nthPotRecovery({...sameBlock,owed:3_000_000_000_000n,qualifyingBuys:2n},1),'payout');
});
test('gas buffer cannot increase the debit cap or create an underpriced request',()=>{
 const within=boundedGasFees(12_000_000n,300_000_000n,1_000_000n);
 assert.equal(within.affordable,true);assert.ok(within.maximumGasWei<=MAXIMUM_GAS_DEBIT);
 assert.ok(within.maxFeePerGas<601_000_000n);assert.ok(within.maxFeePerGas>=301_000_000n);
 const tooHigh=boundedGasFees(12_000_000n,490_000_000n,1_000_000n);
 assert.equal(tooHigh.affordable,false);assert.ok(tooHigh.maximumGasWei<=MAXIMUM_GAS_DEBIT);
 assert.equal(boundedGasFees(21_000n,2_100_000_000n,1n).affordable,false);
 assert.throws(()=>boundedGasFees(0n,1n,1n));
});

test('one-use gas approval only matches its exact account, chain, module and launch salt',()=>{
 const scope={account:ACCOUNT,chainId:1,family:'buyback-burn',stage:'launch',role:'step',salt:'0x'+'36'.repeat(32)};
 const approval={...scope,id:'one-test-launch',limitWei:'12000000000000000'};
 const resolve=(context=scope,used={},history=[],approvals=[approval])=>launchGasBudget(approvals,used,history,context);
 assert.deepEqual(resolve(),{limitWei:12_000_000_000_000_000n,approvalId:approval.id});
 for(const changed of [{account:'0x'+'11'.repeat(20)},{chainId:4663},{family:'dip-buyback'},{stage:'buy'},{role:'approval'},{salt:'0x'+'37'.repeat(32)},{salt:undefined}])
  assert.equal(resolve({...scope,...changed}).limitWei,MAXIMUM_GAS_DEBIT);
 for(const field of ['account','chainId','family','salt','stage','role','id','limitWei']){
  const invalid={...approval};delete invalid[field];
  assert.equal(resolve(scope,{},[],[invalid]).limitWei,MAXIMUM_GAS_DEBIT);
 }
 const used=JSON.parse(JSON.stringify({[approval.id]:{hash:'0xconfirmed'}}));
 assert.equal(resolve(scope,used).limitWei,MAXIMUM_GAS_DEBIT);
 assert.equal(resolve(scope,{},[{...scope,gasApprovalId:approval.id}]).limitWei,MAXIMUM_GAS_DEBIT);
 const legacyHistory={chainId:1,family:scope.family,stage:'launch',role:'step'};
 assert.equal(resolve(scope,{},[legacyHistory]).limitWei,MAXIMUM_GAS_DEBIT);
 assert.equal(resolve(scope,{},[],[]).limitWei,MAXIMUM_GAS_DEBIT);
});
test('explicit one-launch budget retains the gas-price ceiling and never leaks to default fees',()=>{
 const approved=boundedGasFees(11_513_911n,800_000_000n,100_000n,12_000_000_000_000_000n);
 assert.equal(approved.affordable,true);
 assert.ok(approved.maximumGasWei<=12_000_000_000_000_000n);
 assert.equal(boundedGasFees(11_513_911n,800_000_000n,100_000n).affordable,false);
 assert.equal(boundedGasFees(21_000n,2_100_000_000n,1n,12_000_000_000_000_000n).affordable,false);
 assert.throws(()=>boundedGasFees(1n,1n,1n,0n));
});
