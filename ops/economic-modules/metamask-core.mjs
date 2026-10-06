import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, parseAbiParameters, toHex } from 'viem';
export const FAMILIES = ['buyback-burn','dip-buyback','lp-rewards','full-range-lp','buyer-rewards','nth-buy-pot','king-of-the-hill','hot-potato','plague','reactive-pair','entangled'];
export const ACCOUNT = getAddress('0x9e1339Eaed0EfF31Eda7D714A341Eb09a7e4513e');
export const BUY = 10_000_000_000_000n;
export const FUNDING = 250_000_000_000_000n;
export const MAXIMUM_GAS_DEBIT = 5_000_000_000_000_000n;
export function launchGasBudget(approvals, used, history, scope) {
 const fallback = {limitWei: MAXIMUM_GAS_DEBIT, approvalId: null};
 if (scope.stage !== 'launch' || scope.role !== 'step') return fallback;
 const approval = (approvals ?? []).find(a =>
  typeof a.id === 'string' && a.id.length > 0 && !used?.[a.id] &&
  a.chainId === scope.chainId && a.family === scope.family &&
  a.stage === 'launch' && a.role === 'step' &&
  /^0x[0-9a-f]{40}$/i.test(a.account) && a.account.toLowerCase() === scope.account.toLowerCase() &&
  /^0x[0-9a-f]{64}$/i.test(a.salt) && a.salt.toLowerCase() === scope.salt?.toLowerCase() &&
  /^[0-9]+$/.test(a.limitWei) && BigInt(a.limitWei) > MAXIMUM_GAS_DEBIT);
 if (!approval || history.some(entry => entry.gasApprovalId === approval.id ||
  (entry.chainId === scope.chainId && entry.family === scope.family && entry.stage === 'launch' &&
   entry.role === 'step' && (!entry.salt || entry.salt.toLowerCase() === scope.salt.toLowerCase())))) return fallback;
 return {limitWei: BigInt(approval.limitWei), approvalId: approval.id};
}
export function boundedGasFees(gas, baseFee, priority, maximumDebit = MAXIMUM_GAS_DEBIT) {
 if (gas <= 0n || baseFee < 0n || priority < 0n || maximumDebit <= 0n) throw Error('Invalid gas quote');
 const maxPriorityFeePerGas = priority > 100_000_000n ? 100_000_000n : priority;
 const budgetPrice = maximumDebit / gas;
 const priceCap = budgetPrice < 2_000_000_000n ? budgetPrice : 2_000_000_000n;
 const suggested = baseFee * 2n + maxPriorityFeePerGas;
 const maxFeePerGas = suggested < priceCap ? suggested : priceCap;
 return { maxFeePerGas, maxPriorityFeePerGas, affordable: maxFeePerGas >= baseFee + maxPriorityFeePerGas,
  maximumGasWei: gas * maxFeePerGas, currentGasWei: gas * (baseFee + maxPriorityFeePerGas) };
}
export const tokenAbi = parseAbi(['function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)','function balanceOf(address) view returns (uint256)','function totalSupply() view returns (uint256)','function deposit() payable']);
export const permitAbi = parseAbi(['function approve(address,address,uint160,uint48)','function allowance(address,address,address) view returns (uint160 amount,uint48 expiration,uint48 nonce)']);
export const hostAbi = parseAbi([
 'struct Descriptor { bytes32 moduleId; uint16 abiVersion; uint8 phases; uint8 resources; uint32 beforeGas; uint32 afterGas; uint32 actionGas; bool failOpenAfter; bytes32 exclusiveGroup; }',
 'struct Module { address instance; bytes32 codeHash; bytes32 configurationHash; Descriptor descriptor; }',
 'function moduleAt(uint256) view returns (Module)','function moduleCount() view returns (uint256)','function executeModuleAction(uint256,bytes)',
 'function poolKey() view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))',
]);
export const moduleAbi = parseAbi(['function executableBudget() view returns (uint256)','function totalQuoteUsed() view returns (uint256)','function totalBurned() view returns (uint256)','function lockedLiquidity() view returns (uint128)','function totalPaid() view returns (uint256)','function owed(address) view returns (uint256)','function pausedUntil() view returns (uint256)','function qualifyingBuys() view returns (uint256)','function lastQualifyingBlock() view returns (uint256)','function everyN() view returns (uint32)','function unlocked() view returns (bool)','function unlockReached() view returns (bool)','function currentCap() view returns (uint256)','function king() view returns (address)','function crownThreshold() view returns (uint256)']);
export const routerAbi = parseAbi(['function execute(bytes,bytes[],uint256) payable']);
export function configFor(kind, reference) {
 if (!Number.isInteger(kind) || kind<0 || kind>=FAMILIES.length) throw Error('Unknown module');
 if(kind<4) return encodeAbiParameters(parseAbiParameters('uint128,uint128,uint32,uint32,uint16,uint16'),[1n,100_000_000_000n,30,300,500,kind===1?500:0]);
 if(kind<7) return encodeAbiParameters(parseAbiParameters('uint128,uint16,uint32,uint32'),[1n,kind===4?100:0,kind===5?2:0,kind===6?60:0]);
 if(kind<9) return encodeAbiParameters(parseAbiParameters('uint128,uint32'),[1n,kind===7?30:0]);
 return encodeAbiParameters(parseAbiParameters('address,uint16,uint16,uint16,uint16'),[getAddress(reference),kind===9?5000:0,kind===9?100:0,kind===9?10000:0,kind===10?100:0]);
}
export function caseSteps(kind) {
 const steps=['launch','buy'];
 if(kind<4) steps.push('price-history');
 if(kind===1) steps.push('sell-half');
 if(kind<4) steps.push('execute');
 if(kind===5||kind===6) steps.push('buy-again');
 if(kind>=4&&kind<=6) steps.push('payout');
 if(kind===7) steps.push('cooldown');
 if(kind===9||kind===10) return ['launch','reference-before','reference-buy','reference-after','buy','reference-sell','reference-restored','sell'];
 steps.push('sell');
 if(kind===6) steps.push('payout-after-sale');
 return steps;
}
export function swapData(key, input, output, amount, minOut, deadline, account=ACCOUNT) {
 if(amount<=0n || minOut<=0n || minOut>=(1n<<128n)) throw Error('Invalid bounded swap');
 const actions=[encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)'),[{poolKey:key,zeroForOne:input.toLowerCase()===key.currency0.toLowerCase(),amountIn:amount,amountOutMinimum:minOut,minHopPriceX36:0n,hookData:'0x'}]),encodeAbiParameters(parseAbiParameters('address,uint256,bool'),[input,amount,true]),encodeAbiParameters(parseAbiParameters('address,address,uint256'),[output,account,0n])];
 return encodeFunctionData({abi:routerAbi,functionName:'execute',args:['0x10',[encodeAbiParameters(parseAbiParameters('bytes,bytes[]'),['0x060b0e',actions])],deadline]});
}
export function assertEnvelope(actual, expected) {
 for(const key of ['from','to']) if(actual[key]?.toLowerCase()!==expected[key]?.toLowerCase()) throw Error('Transaction address mismatch');
 if((actual.input??actual.data)?.toLowerCase()!==expected.data.toLowerCase() || BigInt(actual.value)!==BigInt(expected.value) || BigInt(actual.nonce)!==BigInt(expected.nonce)) throw Error('Transaction content mismatch');
 if(actual.chainId!==undefined && BigInt(actual.chainId)!==BigInt(expected.chainId)) throw Error('Transaction chain mismatch');
 if(BigInt(actual.gas)>BigInt(expected.gas)) throw Error('Transaction gas exceeds reviewed limit');
 const price=actual.maxFeePerGas??actual.gasPrice;
 if(price===undefined||BigInt(price)>BigInt(expected.maxFeePerGas)) throw Error('Transaction fee exceeds reviewed limit');
}
export function digestRequest(request) { return keccak256(toHex(JSON.stringify(request))); }
export function simulationCheckpoint(heads, lag, lastReceipt = 0n) {
 if (!heads.length || lag < 0n || lastReceipt < 0n || heads.some(head => head < 0n)) throw Error('Invalid simulation checkpoint');
 const block = heads.reduce((lowest, head) => head < lowest ? head : lowest) - lag;
 return block < lastReceipt ? null : block;
}
export function isTransientBlockError(error) {
 const seen = new Set();
 for (let cause = error; cause && !seen.has(cause); cause = cause.cause) {
  seen.add(cause);
  if (cause.name === 'BlockNotFoundError' || /header not found|unknown block|block not found/i.test(cause.rpcMessage ?? '')) return true;
 }
 return false;
}
export function nthPotRecovery({owed, qualifyingBuys, everyN}, recoveryBuys) {
 if (owed > 0n) return 'payout';
 // The two-buy test may have submitted both trades in one EVM block. Repair it once,
 // without replaying the launch or silently treating the missing payout as success.
 if (everyN === 2n && qualifyingBuys === 1n && recoveryBuys === 0) return 'qualifying-buy';
 return 'stop';
}
export function publicError(error) {
 return typeof error?.safeMessage==='string'?error.safeMessage:'Vorbereitung angehalten. Die bereits bestätigten Schritte bleiben gespeichert.';
}
export function fail(message) { const e=Error(message); e.safeMessage=message; throw e; }
export function check(value,message){if(!value)fail(message);}
