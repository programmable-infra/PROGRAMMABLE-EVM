import {createServer} from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile, mkdir, open, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createPublicClient, custom, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getAddress, getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex} from 'viem';
import Privy,{InMemoryCache} from '@privy-io/js-sdk-core';
import {RefreshSession} from '@privy-io/routes';
import {foundationChainProfile} from '../../lib/module-foundation/chains.ts';
import {foundationTransactionGasLimit} from '../../lib/module-foundation/gas.ts';
import {foundationFactoryV2Abi, encodeFoundationParameters, encodeFoundationLaunchEntry} from '../../lib/module-foundation/abi.ts';
import {buildFoundationEthereumGraph, assertFoundationEthereumTransaction,predictFoundationEthereumAccounts} from '../../lib/module-foundation/ethereum-graph-builder.ts';
import {ETHEREUM_MODULE_SOURCE} from '../../lib/module-foundation/ethereum-release.ts';
import {parseEthereumModuleAuthorization} from '../../lib/module-foundation/ethereum-authorization.ts';
import {encodeFoundationFundingPath} from '../../lib/module-foundation/funding-path.ts';
import {FAMILIES, ACCOUNT, BUY, FUNDING, tokenAbi, permitAbi, hostAbi, moduleAbi, configFor, caseSteps, swapData, assertEnvelope, digestRequest, simulationCheckpoint, isTransientBlockError, nthPotRecovery, boundedGasFees, publicError, check, fail} from './metamask-core.mjs';
const origin='https://programmable.market';
const cleanJson=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const readJson=async file=>JSON.parse(await readFile(file,'utf8'));
async function durable(file,value){const temp=file+'.tmp';const f=await open(temp,'w',0o600);try{await f.writeFile(cleanJson(value)+'\n');await f.sync();}finally{await f.close();}await rename(temp,file);}
const stampAbi=parseAbi(['function launchIdByToken(address) view returns (bytes32)']);
const blockReaderAbi=parseAbi(['function getBlockNumber() view returns (uint256)']);
export async function run([configFile],root){
 check(configFile,'Konfiguration fehlt');
 const cfg=await readJson(configFile), dir=cfg.output; await mkdir(dir,{recursive:true,mode:0o700});
 const lock=await open(join(dir,'console.lock'),'wx',0o600).catch(()=>fail('Diese Konsole läuft bereits.'));
 await lock.writeFile(String(process.pid));await lock.close();
 const stateFile=join(dir,'state.private.json');
 let state;try{state=await readJson(stateFile);}catch(e){if(e.code!=='ENOENT')throw e;state={schemaVersion:'programmable.economic-metamask.v1',account:ACCOUNT,createdAt:new Date().toISOString(),simulationOnly:cfg.simulationOnly===true,chains:{},history:[],prepared:null};}
 check(state.account===ACCOUNT,'Falsche Test-Wallet im gespeicherten Ablauf');
 const save=()=>durable(stateFile,state);
 const chains=new Map();
 const allowed=new Set(['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_blockNumber','eth_getCode','eth_call','eth_estimateGas','eth_getTransactionCount','eth_getBalance','eth_getTransactionByHash','eth_getTransactionReceipt','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getLogs','eth_simulateV1']);
 for(const chainId of (cfg.enabledChains??[4663,1])){
  const profile=foundationChainProfile(chainId), urls=await Promise.all(cfg.chains[chainId].rpcFiles.map(f=>readFile(f,'utf8').then(v=>v.trim())));
  check(cfg.simulationOnly===true || urls.every(u=>new URL(u).protocol==='https:'),'Produktive RPCs müssen HTTPS verwenden');
  check(new URL(urls[0]).host!==new URL(urls[1]).host,'Zwei unabhängige RPCs werden benötigt');
  let requests=0;
  const clients=urls.map(url=>createPublicClient({chain:profile.chain,cacheTime:0,transport:custom({request:async({method,params})=>{
   check(allowed.has(method),'RPC-Methode ist nicht lesend');requests++;
   const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requests,method,params}),signal:AbortSignal.timeout(20000)});
   if(!r.ok)fail('RPC gerade nicht erreichbar. Der Fortschritt ist gespeichert.');const b=await r.json();if(b.error){await durable(join(dir,'rpc-error.private.json'),{method,params,error:b.error});const e=Error('RPC reverted');e.code=b.error.code;e.data=b.error.data;e.rpcMessage=String(b.error.message??'');throw e;}return b.result;
  }},{retryCount:0})}));
  check((await Promise.all(clients.map(c=>c.getChainId()))).every(v=>v===chainId),'RPC-Netzwerk stimmt nicht');
  const binding=await readJson(cfg.chains[chainId].bindingFile);
  state.chains[chainId]??={initialized:false,cases:FAMILIES.map((family,kind)=>({family,kind,position:0,salt:toHex(randomBytes(32)),transactions:[],checks:{},completed:false})).filter(x=>!cfg.simulationOnly||!cfg.testOnlyFamilies||cfg.testOnlyFamilies.includes(x.family))};
  chains.set(chainId,{chainId,profile,clients,binding,get requests(){return requests;}});
 }
 await save();
 let busy=false,chainId=4663;
 const withLock=async fn=>{check(!busy,'Eine Vorbereitung läuft bereits');busy=true;try{return await fn();}finally{busy=false;}};
 const cstate=c=>state.chains[c.chainId];
 const current=()=>{for(const c of chains.values()){const pending=cstate(c).cases.filter(x=>!x.completed);if(!pending.length)continue;const now=Math.max(cstate(c).clock??0,Math.floor(Date.now()/1000));const item=pending.find(x=>!x.waitUntil||x.waitUntil<=now)??pending.reduce((a,b)=>(a.waitUntil??0)<(b.waitUntil??0)?a:b);return {c,item};}return null;};
 const bal=(c,token,blockNumber)=>c.clients[0].readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[ACCOUNT],...(blockNumber?{blockNumber}:{})});
 const field=(c,item,name,args=[],blockNumber)=>c.clients[0].readContract({address:item.module,abi:moduleAbi,functionName:name,args,...(blockNumber?{blockNumber}:{})});
 async function verifyPins(c,item){
  const entries=[...Object.values(c.profile.infrastructure),c.profile.wrappedEth,c.profile.multicall3];
  if(item?.selection) entries.push({address:item.selection.factory,runtimeCodeHash:item.selection.factoryCodeHash});
  entries.push(c.chainId===1?ETHEREUM_MODULE_SOURCE.implementation:c.binding.factory);
  for(const pin of entries){const code=await Promise.all(c.clients.map(p=>p.getCode({address:pin.address})));check(code.every(b=>b&&keccak256(b)===pin.runtimeCodeHash),'Contract-Code stimmt nicht mit der geprüften Version überein');}
 }
 async function authorization(request){
  let session=await readJson(cfg.sessionFile);check(session.walletAddress.toLowerCase()===ACCOUNT.toLowerCase(),'Anmeldung gehört nicht zur Test-Wallet');
  const send=()=>fetch(origin+'/api/module-foundation/authorize',{method:'POST',headers:{Origin:origin,'content-type':'application/json',Authorization:`Bearer ${session.token}`,...(session.identityToken?{'X-Privy-Identity-Token':session.identityToken}:{})},body:JSON.stringify(request),signal:AbortSignal.timeout(95000)});
  let r=await send();
  if(r.status===401&&session.refreshToken){const sdk=new Privy({appId:session.appId,storage:new InMemoryCache()});const fresh=await sdk.fetchPrivyRoute(RefreshSession,{body:{refresh_token:session.refreshToken},headers:{Origin:origin,Authorization:`Bearer ${session.privyAccessToken}`}});check(fresh.user.id===session.userId,'Anmeldung hat sich geändert');session={...session,token:fresh.token,refreshToken:fresh.refresh_token,privyAccessToken:fresh.privy_access_token,identityToken:fresh.identity_token};await durable(cfg.sessionFile,session);r=await send();}
  const body=await r.json();if(!r.ok){if(r.status===429){state.retryNotBefore=Date.now()+Number(r.headers.get('retry-after')||300)*1000;await save();fail('Ethereum-Freigabe hat ein Anfragelimit erreicht. Der Countdown verhindert neue Anfragen.');}fail('Ethereum-Freigabe ist gerade nicht verfügbar: '+r.status);}
  return parseEthereumModuleAuthorization(body,request);
 }
 async function buildLaunch(c,item){
  const entry=cfg.modules.find(x=>x.family===item.family).targets.find(x=>x.chainId===c.chainId);
  const pub=await readJson(entry.publication);
  check(pub.release.chainId===c.chainId&&pub.protocolReleaseDigest===c.binding.releaseDigest,'Modul ist an eine andere Version gebunden');
  const ref=cstate(c).cases[0];
  item.selection={...pub.release,configuration:configFor(item.kind,ref.hook),creatorShareBps:item.kind<7?10000:0};
  await verifyPins(c,item);
  const block=await c.clients[0].getBlock();
  const metadata={name:`Programmable Test ${item.family}`,symbol:`TEST${item.kind}`,description:'Internal economic module test. Not a public project.',imageURI:origin+'/favicon.ico',website:origin,socialData:toHex(JSON.stringify({purpose:'economic-module-lifecycle-test',internalTest:true}))};
  const p={metadata,quote:c.profile.wrappedEth.address,quoteDecimals:18,initialTick:320040,additionalQuoteAmount:0n,initialBuyQuoteAmount:0n,initialBuyMinimumTokenAmount:0n,deadline:block.timestamp+600n,tokenSalt:item.salt,hookSalt:toHex(0,{size:32}),modules:[item.selection],...(c.chainId===1?{creatorBuyFeeBps:item.kind<7?1000:0,creatorSellFeeBps:item.kind<7?1000:0}:{creatorFeeBps:item.kind<7?1000:0})};
  const predicted=c.chainId===1?predictFoundationEthereumAccounts({source:ETHEREUM_MODULE_SOURCE,account:ACCOUNT,tokenSalt:p.tokenSalt,metadata}).token:await c.clients[0].readContract({address:c.binding.factory.address,abi:foundationFactoryV2Abi,functionName:'predictTokenAddress',args:[ACCOUNT,p.tokenSalt,metadata]});
  p.initialTick=BigInt(p.quote)<BigInt(predicted)?320040:-320040;
  if(c.chainId===1){
   const graph=await buildFoundationEthereumGraph({source:ETHEREUM_MODULE_SOURCE,account:ACCOUNT,parameters:p,fundingPath:[],value:0n});
   const request={schemaVersion:'programmable.ethereum-module-authorization-request.v1',chainId:'1',launchWallet:ACCOUNT,releaseDigest:ETHEREUM_MODULE_SOURCE.releaseDigest,parameters:encodeFoundationParameters(graph.parameters),fundingPath:encodeFoundationFundingPath([],1),valueWei:'0'};
   const auth=await authorization(request), tx=auth.transaction;
   await assertFoundationEthereumTransaction({source:ETHEREUM_MODULE_SOURCE,transaction:{from:tx.from,to:tx.to,data:tx.calldata,value:BigInt(tx.valueWei)}});
   Object.assign(item,{token:graph.token,hook:graph.hook,engine:graph.engine,poolKey:graph.poolKey,launchId:auth.launchId});
   return {to:tx.to,data:tx.calldata,value:0n,expires:Math.min(Number(p.deadline),Number(auth.deadline))};
  }
  const hash=await c.clients[0].readContract({address:c.binding.factory.address,abi:foundationFactoryV2Abi,functionName:'hookInitCodeHash',args:[ACCOUNT,predicted,p]});
  for(let i=0n;i<1000000n;i++){const salt=toHex(i,{size:32}),address=getCreate2Address({from:c.binding.hookDeployer.address,salt,bytecodeHash:hash});if((BigInt(address)&0x3fffn)===0x20ccn){p.hookSalt=salt;item.hook=address;break;}if(i%1024n===0n)await new Promise(r=>setImmediate(r));}
  check(item.hook,'Keine passende Hook-Adresse gefunden');
  Object.assign(item,{token:predicted,engine:c.binding.factory.address,poolKey:{currency0:BigInt(predicted)<BigInt(p.quote)?predicted:p.quote,currency1:BigInt(predicted)<BigInt(p.quote)?p.quote:predicted,fee:0,tickSpacing:60,hooks:item.hook}});
  return {to:c.binding.factory.address,data:encodeFoundationLaunchEntry(p,{functionName:'launch'}),value:0n,expires:Number(p.deadline)};
 }
 async function prepare(c,item,stage,tx,label,role='step',extra={}){
  const p=c.clients[0],value=BigInt(tx.value??0n);
  const [nonce,pending,gasEstimate,block,tip]=await Promise.all([p.getTransactionCount({address:ACCOUNT,blockTag:'latest'}),p.getTransactionCount({address:ACCOUNT,blockTag:'pending'}),stage==='launch'&&item.launchDraft?.gasEstimate?BigInt(item.launchDraft.gasEstimate):p.estimateGas({account:ACCOUNT,to:tx.to,data:tx.data,value}),p.getBlock(),p.estimateMaxPriorityFeePerGas().catch(()=>1000000n)]);
  check(nonce===pending,'Eine andere Wallet-Transaktion ist noch offen. Bitte zuerst bestätigen lassen.');
  const gas=foundationTransactionGasLimit(gasEstimate,c.chainId),fees=boundedGasFees(gas,block.baseFeePerGas??0n,tip);
  if(stage==='launch'&&item.launchDraft)item.launchDraft.gasEstimate=String(gasEstimate);
  state.lastGasQuote={chainId:c.chainId,family:item.family,stage,gasEstimate:String(gasEstimate),gasLimit:String(gas),baseFeePerGas:String(block.baseFeePerGas??0n),...Object.fromEntries(Object.entries(fees).map(([k,v])=>[k,typeof v==='bigint'?String(v):v])),at:new Date().toISOString()};
  if(!fees.affordable){state.gasRetryAt=Date.now()+15000;await save();return display({status:'waiting',message:'Warte auf Netzgebühren innerhalb des Limits von 0,005 ETH',waitSeconds:15});}
  delete state.gasRetryAt;
  const {maxFeePerGas,maxPriorityFeePerGas}=fees;
  check(await p.getBalance({address:ACCOUNT})>fees.maximumGasWei+value,'Die Test-Wallet hat für diesen Schritt zu wenig ETH.');
  const request={from:ACCOUNT,to:tx.to,data:tx.data,value:toHex(value),chainId:toHex(c.chainId),nonce:toHex(nonce),gas:toHex(gas),maxFeePerGas:toHex(maxFeePerGas),maxPriorityFeePerGas:toHex(maxPriorityFeePerGas)};
  state.prepared={id:randomUUID(),chainId:c.chainId,family:item.family,stage,role,label,request,digest:digestRequest(request),preparedBlock:String(block.number),expires:tx.expires??Number(block.timestamp+300n),maximumGasWei:String(gas*maxFeePerGas),...extra};await save();return display();
 }
 async function approval(c,item,stage,token,amount){
  const p=c.clients[0],permit=c.profile.infrastructure.permit2.address,router=c.profile.infrastructure.universalRouter.address;
  const allowance=await p.readContract({address:token,abi:tokenAbi,functionName:'allowance',args:[ACCOUNT,permit]});
  if(allowance<amount)return prepare(c,item,stage,{to:token,data:encodeFunctionData({abi:tokenAbi,functionName:'approve',args:[permit,amount]})},'Begrenzte Token-Freigabe','approval');
  const [permitted,expiration]=await p.readContract({address:permit,abi:permitAbi,functionName:'allowance',args:[ACCOUNT,token,router]});
  if(permitted<amount||expiration<Math.floor(Date.now()/1000)+300)return prepare(c,item,stage,{to:permit,data:encodeFunctionData({abi:permitAbi,functionName:'approve',args:[token,router,amount,Math.floor(Date.now()/1000)+86400]})},'Begrenzte Freigabe für den Swap-Router','approval');
  return null;
 }
 async function evmBlockNumber(c,blockNumber){
  const pin=c.profile.multicall3;
  if(!c.blockReaderChecked){const codes=await Promise.all(c.clients.map(client=>client.getCode({address:pin.address,blockNumber})));check(codes.every(code=>code&&keccak256(code)===pin.runtimeCodeHash),'Der Blockzähler entspricht nicht der geprüften Version.');c.blockReaderChecked=true;}
  const blocks=await Promise.all(c.clients.map(client=>client.readContract({address:pin.address,abi:blockReaderAbi,functionName:'getBlockNumber',blockNumber})));
  check(blocks[0]===blocks[1],'RPCs bestätigen verschiedene Ausführungsblöcke.');return blocks[0];
 }
 async function swap(c,item,stage,target,buy,amount,role='step'){
  const quote=c.profile.wrappedEth.address,input=buy?quote:target.token,output=buy?target.token:quote;
  const approved=await approval(c,item,stage,input,amount);if(approved)return approved;
  const waitForBlock=()=>{c.simulationRetries=(c.simulationRetries??0)+1;if(c.simulationRetries>6){c.simulationRetries=0;fail('Der RPC liefert noch keinen gemeinsamen Block. Bitte später fortsetzen; alle Bestätigungen bleiben gespeichert.');}return display({status:'waiting',message:'Warte, bis beide RPCs den letzten Schritt bereitstellen',waitSeconds:Math.min(2**c.simulationRetries,15)});};
  const p=c.clients[0];let block,quoteSimulation,deadline,qualifyingBuysBefore;
  try{
   const heads=await Promise.all(c.clients.map(client=>client.getBlockNumber({cacheTime:0})));
   const lastReceipt=state.history.filter(tx=>tx.chainId===c.chainId).reduce((last,tx)=>BigInt(tx.blockNumber)>last?BigInt(tx.blockNumber):last,0n);
   const blockNumber=simulationCheckpoint(heads,c.profile.preparationLag,lastReceipt);
   if(blockNumber===null)return waitForBlock();
   const blocks=await Promise.all(c.clients.map(client=>client.getBlock({blockNumber})));
   check(blocks[0].hash===blocks[1].hash,'RPCs bestätigen verschiedene Blöcke.');block=blocks[0];deadline=block.timestamp+300n;
   if(item.kind===5&&buy&&target===item){
    const [evmBlock,lastQualifying,count]=await Promise.all([evmBlockNumber(c,blockNumber),field(c,item,'lastQualifyingBlock',[],blockNumber),field(c,item,'qualifyingBuys',[],blockNumber)]);
    if(evmBlock<=lastQualifying)return display({status:'waiting',message:'Der nächste Kauf zählt erst im nächsten Ausführungsblock',waitSeconds:6});
    qualifyingBuysBefore=String(count);
   }
   const readBalance={to:output,data:encodeFunctionData({abi:tokenAbi,functionName:'balanceOf',args:[ACCOUNT]})};
   quoteSimulation=await p.simulateCalls({account:ACCOUNT,blockNumber,calls:[readBalance,{to:c.profile.infrastructure.universalRouter.address,data:swapData(target.poolKey,input,output,amount,1n,deadline),value:0n},readBalance]});
  }catch(error){if(isTransientBlockError(error))return waitForBlock();throw error;}
  c.simulationRetries=0;
  check(quoteSimulation.results.length===3&&quoteSimulation.results.every(r=>r.status==='success'),'Der Swap ist mit den aktuellen Modulregeln nicht ausführbar.');
  const beforeQuote=decodeAbiParameters(parseAbiParameters('uint256'),quoteSimulation.results[0].data)[0],afterQuote=decodeAbiParameters(parseAbiParameters('uint256'),quoteSimulation.results[2].data)[0];
  const minOut=(afterQuote-beforeQuote)*9700n/10000n;check(minOut>0n,'Der Test-Swap würde keine Token liefern.');
  const data=swapData(target.poolKey,input,output,amount,minOut,deadline);
  const before=await bal(c,output);
  const label=role==='pot-qualifying-buy'?'Fehlenden qualifizierten Kauf ergänzen · 0,00001 ETH':buy?'Testkauf · 0,00001 ETH':'Test-Token verkaufen';
  return prepare(c,item,stage,{to:c.profile.infrastructure.universalRouter.address,data,expires:Number(deadline)},label,role,{output,minimumOutput:String(minOut),outputBefore:String(before),tradeToken:target.token,buy,inputAmount:String(amount),simulationBlock:String(block.number),simulationBlockHash:block.hash,...(qualifyingBuysBefore!==undefined?{qualifyingBuysBefore}:{})});
 }
 function display(extra={}){
  const cur=state.prepared?{c:chains.get(state.prepared.chainId),item:cstate(chains.get(state.prepared.chainId)).cases.find(x=>x.family===state.prepared.family)}:current();return {account:ACCOUNT,simulationOnly:cfg.simulationOnly===true,chainId:cur?.c.chainId??1,family:cur?.item.family??null,completed:Object.values(state.chains).flatMap(c=>c.cases).filter(i=>i.completed).length,total:Object.values(state.chains).flatMap(c=>c.cases).length,transactions:state.history.length,status:state.prepared?.hash?'pending':state.prepared?'review':cur?'ready':'complete',prepared:state.prepared?{id:state.prepared.id,label:state.prepared.label,request:state.prepared.request,maximumGasWei:state.prepared.maximumGasWei,hash:state.prepared.hash}:null,cases:Object.entries(state.chains).flatMap(([chain,c])=>c.cases.map(i=>({chainId:Number(chain),family:i.family,completed:i.completed,position:i.position,steps:caseSteps(i.kind).length}))),...extra};
 }
 async function reconcile(){
  const pre=state.prepared;if(!pre)return;
  const c=chains.get(pre.chainId),p=c.clients[0];
  if(!pre.hash){
   const nonce=await p.getTransactionCount({address:ACCOUNT,blockTag:'latest'}),pending=await p.getTransactionCount({address:ACCOUNT,blockTag:'pending'});
   if(nonce>Number(BigInt(pre.request.nonce))){
    const head=await p.getBlockNumber();check(head-BigInt(pre.preparedBlock)<128n,'Die Transaktion muss anhand ihres Hashes wiederhergestellt werden.');
    for(let b=BigInt(pre.preparedBlock);b<=head;b++){const block=await p.getBlock({blockNumber:b,includeTransactions:true});const found=block.transactions.find(t=>t.from.toLowerCase()===ACCOUNT.toLowerCase()&&t.nonce===Number(BigInt(pre.request.nonce)));if(found){assertEnvelope(found,pre.request);pre.hash=found.hash;await save();break;}}
    check(pre.hash,'Die gesendete Transaktion konnte noch nicht wiedergefunden werden.');
   }else if(pending>Number(BigInt(pre.request.nonce)))return display({status:'waiting',message:'MetaMask-Transaktion ist noch im Netzwerk. Bitte nicht erneut senden.',waitSeconds:5});
   else if(pre.expires<Math.floor(Date.now()/1000)+20){state.prepared=null;await save();return;}
   else return display();
  }
  const results=await Promise.all(c.clients.map(async client=>{try{return {tx:await client.getTransaction({hash:pre.hash}),receipt:await client.getTransactionReceipt({hash:pre.hash})};}catch(e){if(/NotFound/.test(e.name))return null;throw e;}}));
  if(results.some(x=>!x))return display({status:'pending',message:'Warte auf Bestätigung im Netzwerk',waitSeconds:c.chainId===1?8:3});
  for(const result of results){assertEnvelope(result.tx,pre.request);check(result.receipt.status==='success','Transaktion ist fehlgeschlagen. Sie wird nicht automatisch erneut gesendet.');}
  check(results[0].receipt.blockHash===results[1].receipt.blockHash,'RPCs bestätigen verschiedene Blöcke.');
  const receipt=results[0].receipt,item=cstate(c).cases.find(i=>i.family===pre.family);
  if(pre.role==='step'||pre.role==='pot-qualifying-buy'){
   if(pre.stage==='launch'){
    const launches=await Promise.all(c.clients.map(client=>client.readContract({address:item.engine,abi:foundationFactoryV2Abi,functionName:'launchOf',args:[item.token],blockNumber:receipt.blockNumber})));
    check(launches.every(r=>r.hook.toLowerCase()===item.hook.toLowerCase()&&r.basePositionId>0n&&r.creatorQuotePrincipal===0n&&r.initialBuyTokenAmount===0n),'Launch-Ergebnis stimmt nicht');
    const modules=await Promise.all(c.clients.map(client=>client.readContract({address:item.hook,abi:hostAbi,functionName:'moduleAt',args:[0n],blockNumber:receipt.blockNumber})));
    check(modules.every(m=>m.codeHash===item.selection.moduleCodeHash&&m.configurationHash===keccak256(item.selection.configuration)),'Modul-Bindung stimmt nicht');item.module=modules[0].instance;
    check((await Promise.all(c.clients.map(client=>client.getCode({address:item.module,blockNumber:receipt.blockNumber})))).every(code=>code&&keccak256(code)===item.selection.moduleCodeHash),'Modul-Code stimmt nicht');
    if(c.chainId===1){const id=await p.readContract({address:pre.request.to,abi:stampAbi,functionName:'launchIdByToken',args:[item.token],blockNumber:receipt.blockNumber});check(id===item.launchId,'Programmable-Stamp fehlt');}
    item.checks.launch=true;item.launchTransaction=pre.hash;delete item.launchDraft;
   }else if(pre.output){
    const output=await bal(c,pre.output,receipt.blockNumber);check(output-BigInt(pre.outputBefore)>=BigInt(pre.minimumOutput),'Swap-Ausgabe liegt unter dem geprüften Minimum');
    if(pre.qualifyingBuysBefore!==undefined){
     const counts=await Promise.all(c.clients.map(client=>client.readContract({address:item.module,abi:moduleAbi,functionName:'qualifyingBuys',blockNumber:receipt.blockNumber})));
     check(counts.every(count=>count===BigInt(pre.qualifyingBuysBefore)+1n),'Der Testkauf wurde nicht als neuer qualifizierter Kauf gezählt.');
    }
    item.checks[pre.role==='pot-qualifying-buy'?'pot-qualifying-buy':pre.stage]=true;
    if(pre.stage==='reference-buy')item.referenceAmount=String(output-BigInt(pre.outputBefore));
    if(pre.stage==='buy'){const block=await p.getBlock({blockNumber:receipt.blockNumber});item.firstBuyAt=Number(block.timestamp);}
   }else if(pre.stage==='execute'){
    check(await field(c,item,'totalQuoteUsed',[],receipt.blockNumber)>BigInt(pre.usedBefore),'Die Gebührenaktion hat kein Budget verwendet');
    if(item.kind===0||item.kind===1)check(await field(c,item,'totalBurned',[],receipt.blockNumber)>0n,'Buyback hat keine Token verbrannt');
    if(item.kind===3)check(await field(c,item,'lockedLiquidity',[],receipt.blockNumber)>0n,'Keine zusätzliche Liquidität entstanden');
    item.checks.execute=true;
   }else if(pre.stage.startsWith('payout')){check(await field(c,item,'totalPaid',[],receipt.blockNumber)>BigInt(pre.paidBefore),'Keine Auszahlung erfolgt');check(await field(c,item,'owed',[ACCOUNT],receipt.blockNumber)===0n,'Auszahlung hat offene Schuld nicht entfernt');item.checks[pre.stage]=true;}
   if(pre.role==='pot-qualifying-buy')item.potRecoveryBuys=(item.potRecoveryBuys??0)+1;
   else item.position++;
  }
  const entry={chainId:c.chainId,family:item.family,stage:pre.stage,role:pre.role,hash:pre.hash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,gasUsed:String(receipt.gasUsed)};
  item.transactions.push(entry);state.history.push(entry);state.prepared=null;await save();
 }
 async function next(){
  if(!state.prepared&&state.gasRetryAt>Date.now())return display({status:'waiting',message:'Warte auf Netzgebühren innerhalb des Limits von 0,005 ETH',waitSeconds:Math.ceil((state.gasRetryAt-Date.now())/1000)});
  const active=current();if(active)cstate(active.c).clock=Number((await active.c.clients[0].getBlock()).timestamp);
  const prior=await reconcile();if(prior)return prior;
  if(state.retryNotBefore>Date.now())return display({status:'waiting',message:'Warte auf das Ethereum-Anfragefenster',waitSeconds:Math.ceil((state.retryNotBefore-Date.now())/1000)});
  for(let advance=0;advance<10;advance++){
   const cur=current();if(!cur)return display({message:'Signierablauf abgeschlossen. Nachweise werden getrennt von der öffentlichen Freischaltung geprüft.'});
   const {c,item}=cur;chainId=c.chainId;const p=c.clients[0];
   if(!cstate(c).initialized){
    if(!c.runtimeChecked){await verifyPins(c);c.runtimeChecked=true;}
    const balance=await bal(c,c.profile.wrappedEth.address);
    if(balance<FUNDING)return prepare(c,item,'funding',{to:c.profile.wrappedEth.address,data:encodeFunctionData({abi:tokenAbi,functionName:'deposit'}),value:FUNDING-balance},'0,00025 ETH als WETH für die Test-Swaps bereitstellen','funding');
    const a=await approval(c,item,'funding',c.profile.wrappedEth.address,FUNDING);if(a)return a;cstate(c).initialized=true;await save();
   }
   const stages=caseSteps(item.kind),stage=stages[item.position];
   if(!stage){item.completed=true;item.completedAt=new Date().toISOString();item.lifecycleApproval='pending independent final review';await save();continue;}
   if(stage==='launch'){
    if(!item.launchDraft||item.launchDraft.tx.expires<Math.floor(Date.now()/1000)+30){item.launchDraft={tx:await buildLaunch(c,item)};await save();}
    return prepare(c,item,stage,item.launchDraft.tx,'Test-Coin mit '+item.family+' erstellen');
   }
   if(stage==='price-history'||stage==='cooldown'){
    const end=stage==='cooldown'?Number(await field(c,item,'pausedUntil')):item.firstBuyAt+305;
    const now=Number((await p.getBlock()).timestamp);cstate(c).clock=now;if(now<end){item.waitUntil=end;await save();if(current()?.item!==item)continue;return display({status:'waiting',message:stage==='cooldown'?'Die Verkaufspause des Moduls läuft':'Die Module bauen ihre Preisgeschichte auf',waitSeconds:end-now});}
    delete item.waitUntil;item.checks[stage]=true;item.position++;await save();continue;
   }
   if(stage.startsWith('reference-')){
    const ref=cstate(c).cases[0];
    if(stage==='reference-buy')return swap(c,item,stage,ref,true,BUY);
    if(stage==='reference-sell')return swap(c,item,stage,ref,false,BigInt(item.referenceAmount));
    if(stage==='reference-before'){item.referenceBefore=String(await field(c,item,item.kind===9?'currentCap':'unlockReached'));check(item.kind!==10||item.referenceBefore==='false','Referenz sollte zunächst gesperrt sein');}
    if(stage==='reference-after'){const value=await field(c,item,item.kind===9?'currentCap':'unlockReached');check(item.kind===9?value>BigInt(item.referenceBefore):value===true,'Referenzmodul hat nicht auf den Preis reagiert');}
    if(stage==='reference-restored'&&item.kind===10)check(await field(c,item,'unlocked')===true,'Entangled blieb nicht entsperrt');
    item.checks[stage]=true;item.position++;await save();continue;
   }
   if(stage==='buy'||stage==='buy-again')return swap(c,item,stage,item,true,BUY);
   if(stage==='sell'||stage==='sell-half'){const amount=await bal(c,item.token);check(amount>0n,'Keine Test-Token zum Verkauf');return swap(c,item,stage,item,false,stage==='sell-half'?amount/2n:amount);}
   if(stage==='execute'){const used=await field(c,item,'totalQuoteUsed');return prepare(c,item,stage,{to:item.hook,data:encodeFunctionData({abi:hostAbi,functionName:'executeModuleAction',args:[0n,'0x61461954']})},'Aufgelaufene Gebühren im Modul ausführen','step',{usedBefore:String(used)});}
   if(stage.startsWith('payout')){
    const owed=await field(c,item,'owed',[ACCOUNT]);
    if(item.kind===5&&owed===0n){
     const blockNumber=BigInt(item.transactions.at(-1).blockNumber);
     const snapshots=await Promise.all(c.clients.map(async client=>{const read=(name,args=[])=>client.readContract({address:item.module,abi:moduleAbi,functionName:name,args,blockNumber});const [debt,count,n]=await Promise.all([read('owed',[ACCOUNT]),read('qualifyingBuys'),read('everyN')]);return {owed:debt,qualifyingBuys:count,everyN:BigInt(n)};}));
     check(cleanJson(snapshots[0])===cleanJson(snapshots[1]),'Die RPCs bestätigen unterschiedliche Prämienstände.');
     const decision=nthPotRecovery(snapshots[0],item.potRecoveryBuys??0);
     if(decision==='qualifying-buy')return swap(c,item,stage,item,true,BUY,'pot-qualifying-buy');
     check(decision==='payout','Die Prämienbedingung ist noch nicht erfüllt. Der Test wird nicht als bestanden markiert.');
     return display({status:'waiting',message:'Warte auf den aktuellen Prämienstand',waitSeconds:3});
    }
    if(owed===0n&&stage==='payout-after-sale'){item.position++;item.checks[stage]='nothing owed';await save();continue;}
    check(owed>0n,'Das Modul hat noch keine Auszahlung vorgemerkt');
    const action='0x'+keccak256(toHex('pay(address[])')).slice(2,10)+encodeAbiParameters(parseAbiParameters('address[]'),[[ACCOUNT]]).slice(2);
    return prepare(c,item,stage,{to:item.hook,data:encodeFunctionData({abi:hostAbi,functionName:'executeModuleAction',args:[0n,action]})},'Vorgemerkte Belohnung an die Test-Wallet auszahlen','step',{paidBefore:String(await field(c,item,'totalPaid'))});
   }
   fail('Unbekannter Test-Schritt');
  }
  return display({status:'waiting',message:'Nächster Schritt wird vorbereitet',waitSeconds:1});
 }
 const port=cfg.port??4188,host=`127.0.0.1:${port}`;
 let session=randomBytes(32).toString('base64url');
 // Keep the existing local tab usable after an update without losing a pending wallet hash.
 try{const previous=await readJson(join(dir,'local-console.private.json'));const url=new URL(previous.url);if(previous.sourceRoot===root&&previous.account===ACCOUNT&&url.origin===`http://${host}`&&/^#[A-Za-z0-9_-]{43}$/.test(url.hash))session=url.hash.slice(1);}catch(error){if(error.code!=='ENOENT')throw error;}
 const html=await readFile(join(root,'ops/economic-modules/metamask-console.html'),'utf8');
 const server=createServer(async(req,res)=>{
  const send=(code,body,type='application/json')=>{res.writeHead(code,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"});res.end(type==='application/json'?cleanJson(body):body);};
  try{
   check(req.headers.host===host,'Ungültiger Host');
   if(req.url==='/'&&req.method==='GET')return send(200,html,'text/html; charset=utf-8');
   check(req.headers['x-console-session']===session,'Lokaler Zugang fehlt');check(!req.headers.origin||req.headers.origin==='http://'+host,'Fremde Website nicht erlaubt');
   if(req.method==='GET'&&req.url==='/state')return send(200,display());
   check(req.method==='POST'&&req.headers['content-type']==='application/json','Ungültige Anfrage');
   let bytes=0,body='';for await(const part of req){bytes+=part.length;check(bytes<8192,'Anfrage zu groß');body+=part;}const input=JSON.parse(body||'{}');
   const result=await withLock(async()=>{
    if(req.url==='/next')return next();
    if(req.url==='/submitted'){check(state.prepared&&input.id===state.prepared.id&&/^0x[0-9a-f]{64}$/i.test(input.hash),'Transaktion passt nicht zum vorbereiteten Schritt');check(!state.prepared.hash||state.prepared.hash===input.hash,'Dieser Schritt hat bereits eine andere Transaktion');state.prepared.hash=input.hash;await save();return display();}
    if(req.url==='/revalidate'){check(state.prepared&&input.id===state.prepared.id&&!state.prepared.hash,'Vorbereitung ist nicht mehr aktuell');const pre=state.prepared,c=chains.get(pre.chainId);check(pre.expires>Math.floor(Date.now()/1000)+15,'Die Vorbereitung ist abgelaufen');check(await c.clients[0].getTransactionCount({address:ACCOUNT,blockTag:'pending'})===Number(BigInt(pre.request.nonce)),'Es ist bereits eine Transaktion offen');await c.clients[0].call({account:ACCOUNT,to:pre.request.to,data:pre.request.data,value:BigInt(pre.request.value),gas:BigInt(pre.request.gas)});return {request:pre.request};}
    fail('Unbekannter Endpunkt');
   });send(200,result);
  }catch(error){await durable(join(dir,'last-error.private.json'),{at:new Date().toISOString(),type:error.name,detail:String(error.shortMessage??error.cause?.shortMessage??error.message).replace(/https?:\/\/[^\s]+/g,'[rpc]').slice(0,700),cause:String(error.cause?.message??'').replace(/https?:\/\/[^\s]+/g,'[rpc]').slice(0,700),code:error.code,revertData:error.data??error.cause?.data??error.cause?.cause?.data,message:publicError(error),stage:state.prepared?.stage??(current()?.item?caseSteps(current().item.kind)[current().item.position]:null)}).catch(()=>{});send(400,{error:publicError(error)});}
 });
 server.on('close',()=>rm(join(dir,'console.lock'),{force:true}));
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 await durable(join(dir,'local-console.private.json'),{url:`http://${host}/#${session}`,pid:process.pid,sourceRoot:root,account:ACCOUNT});
 console.log(`MetaMask console ready on http://${host}/ (private access link saved)`);
 return server;
}
