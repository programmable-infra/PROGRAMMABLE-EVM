import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { normalizeBatchId, walletSendDefinitelyNotSubmitted, walletSendDuplicateBatchId, isTreasury, TREASURY, MAINNET_CHAIN_ID } from './logic.mjs';
const source = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
function body(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0);
  const end = source.slice(start + 1).search(/^(?:async )?function \w+\(/m);
  return source.slice(start, start + 1 + end);
}
const original = '0x1234', returned = '0xabcd';
function lock() { return {schema:'programmable.confirmed-claim-batch.v2', account:TREASURY.toLowerCase(), chainId:MAINNET_CHAIN_ID, batchId:original, batch:{id:original,version:'2.0.0',from:TREASURY,chainId:MAINNET_CHAIN_ID,atomicRequired:true,calls:[{to:TREASURY,data:'0x12345678',value:'0x0'}]},phase:'submitting',receipts:null,failureStatus:null,packetCursor:'last-claim'}; }
function runtime(overrides={}) {
  const context = vm.createContext({ normalizeBatchId, walletSendDefinitelyNotSubmitted, walletSendDuplicateBatchId, isTreasury, TREASURY, MAINNET_CHAIN_ID, MAX_BATCH_CALLS:64, CONFIRMED_BATCH_SCHEMA:'programmable.confirmed-claim-batch.v2', CONFIRMED_BATCH_STORAGE_KEY:'journal', ...overrides });
  for (const name of ['invalidConfirmedBatchLock','normalizeStoredBatch','normalizeStoredReceipt','loadConfirmedBatchLock','submitStoredBatchAndWait','resumeStoredBatch']) vm.runInContext(body(name),context);
  return context;
}
test('wallet replacement ID is persisted before polling while original calls and ID survive reload',async()=>{
  let stored=lock(),polled;
  const context=runtime({request:async method=>{assert.equal(method,'wallet_sendCalls');return{id:returned};},saveConfirmedBatchLock:(next,{expectedBatchId})=>{assert.equal(expectedBatchId,original);stored=next;return true;},waitForBatch:async next=>{assert.equal(stored,next);polled=next;return next;},window:{localStorage:{getItem:()=>JSON.stringify(stored)}}});
  await context.submitStoredBatchAndWait(stored);
  assert.equal(polled.batchId,returned);assert.equal(stored.requestId,original);assert.equal(stored.batch.id,original);
  const reloaded=context.loadConfirmedBatchLock();assert.equal(reloaded.batchId,returned);assert.equal(reloaded.requestId,original);assert.equal(reloaded.packetCursor,'last-claim');
});
test('historical same-ID journal loads and changed request binding fails closed',()=>{
  let stored=lock();const context=runtime({window:{localStorage:{getItem:()=>JSON.stringify(stored)}}});
  assert.equal(context.loadConfirmedBatchLock().batchId,original);
  stored={...stored,requestId:returned};assert.equal(context.loadConfirmedBatchLock().invalid,true);
});
test('failure to persist returned ID never proceeds to polling or clears the journal',async()=>{
  const context=runtime({request:async()=>({id:returned}),saveConfirmedBatchLock:()=>false,waitForBatch:()=>assert.fail('unsafe poll'),clearConfirmedBatchLock:()=>assert.fail('unsafe clear')});
  await assert.rejects(context.submitStoredBatchAndWait(lock()),/nicht sicher gespeichert/);
});
test('unknown send outcome retains the original journal without retry',async()=>{
  let calls=0;const context=runtime({request:async()=>{calls++;throw Error('transport lost');},saveConfirmedBatchLock:()=>assert.fail(),clearConfirmedBatchLock:()=>assert.fail()});
  await assert.rejects(context.submitStoredBatchAndWait(lock()),/transport lost/);assert.equal(calls,1);
});
test('resuming an unrecognized batch never sends again',async()=>{
  let message;const context=runtime({state:{},setError:m=>{message=m;},renderSummary(){},setStatus(){},withExistingClaimLease:fn=>fn(lock()),requireActiveRewardWallet:async()=>{},walletRecognizesStoredBatch:async()=>false,request:()=>assert.fail('must not send'),refreshClaims:()=>assert.fail('must remain locked')});
  await context.resumeStoredBatch();assert.match(message,/kein zweiter Claim/);
});
test('recognized pending batch only polls its saved wallet ID',async()=>{
  const pending={...lock(),phase:'pending',batchId:returned,requestId:original};let waited=false;
  const context=runtime({state:{},setError(){},renderSummary(){},setStatus(){},withExistingClaimLease:fn=>fn(pending),requireActiveRewardWallet:async()=>{},waitForBatch:async next=>{assert.equal(next.batchId,returned);waited=true;},request:()=>assert.fail('must not send'),refreshClaims:async()=>{}});
  await context.resumeStoredBatch();assert.equal(waited,true);
});
