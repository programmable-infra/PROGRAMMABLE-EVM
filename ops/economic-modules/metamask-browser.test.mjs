import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('./metamask-console.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const account='0x0000000000000000000000000000000000000001';
const hash='0x'+'12'.repeat(32);
const status=(kind='ready',id='one')=>({account,chainId:1,family:'test',completed:0,total:1,transactions:0,cases:[],status:kind,...(kind==='review'?{prepared:{id,label:id,request:{from:account,value:'0x0'},maximumGasWei:'1'}}:{}),...(kind==='waiting'?{waitSeconds:1,message:'Wait'}:{})});
const store=entries=>{const values=new Map(Object.entries(entries));return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};
async function settle(){for(let i=0;i<40;i++)await new Promise(r=>setImmediate(r));}
function browser({steps=[status('complete')],session={},local={},send=async()=>hash,fetchHook,lock=true}={}){
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{id,textContent:'',style:{},replaceChildren(){},append(){}});return elements.get(id);};
 const calls=[],walletCalls=[],sessionStorage=store({moduleConsoleSession:'test-session',...session}),localStorage=store(local);
 const provider={request:async arg=>{walletCalls.push(arg.method);if(arg.method==='eth_sendTransaction')return send(arg);if(arg.method==='eth_chainId')return '0x1';return [account];}};
 const next=[...steps];
 const context=vm.createContext({document:{getElementById:element,createElement:()=>element(Symbol()),createTextNode:x=>x},sessionStorage,localStorage,location:{hash:'',pathname:'/'},history:{replaceState(){}},window:{addEventListener(){},dispatchEvent(){},ethereum:provider},Event:class {},navigator:{locks:{request:async(name,options,fn)=>fn(lock?{}:null)}},setTimeout:fn=>{queueMicrotask(fn);},fetch:async(path,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,body});let response=await fetchHook?.(path,body,calls);if(response)return response;const data=path==='/state'?status():path==='/next'?next.shift()??status('complete'):path==='/revalidate'?{request:{from:account,value:'0x0'}}:status('pending');return {ok:true,status:200,json:async()=>data};}});
 vm.runInContext(script,context);
 return {elements,element,calls,walletCalls,sessionStorage,localStorage,start:()=>element('start').onclick({isTrusted:true}),pause:()=>element('pause').onclick()};
}
test('one human start advances several wallet confirmations, waits and completes',async()=>{
 const b=browser({steps:[status('review','one'),status('pending'),status('waiting'),status('review','two'),status('complete')]});
 await settle();assert.equal(b.walletCalls.length,0);
 await b.start();
 assert.equal(b.walletCalls.filter(x=>x==='eth_sendTransaction').length,2);
 assert.equal(b.walletCalls.filter(x=>x==='eth_requestAccounts').length,1);
 assert.equal(b.element('start').textContent,'Abgeschlossen');
 assert.equal(b.sessionStorage.getItem('moduleConsoleRunIntent'),null);
});
test('an already started tab resumes after reload without requesting account access again',async()=>{
 const b=browser({session:{moduleConsoleRunIntent:'test-session'},steps:[status('review'),status('complete')]});
 await settle();assert.equal(b.walletCalls.includes('eth_requestAccounts'),false);
 assert.equal(b.walletCalls.filter(x=>x==='eth_sendTransaction').length,1);
});
test('a saved transaction hash is acknowledged before preparing anything else',async()=>{
 const b=browser({session:{moduleConsoleRunIntent:'test-session',moduleConsoleWalletPending:'test-session'},local:{moduleConsolePending:JSON.stringify({id:'old',hash})}});
 await settle();assert.equal(b.calls[1].path,'/submitted');
 assert.equal(b.walletCalls.includes('eth_sendTransaction'),false);
 assert.equal(b.localStorage.getItem('moduleConsolePending'),null);
});
test('reload with an unknown open wallet request never automatically repeats it',async()=>{
 const b=browser({session:{moduleConsoleRunIntent:'test-session',moduleConsoleWalletPending:'test-session'},steps:[status('review')]});
 await settle();assert.equal(b.walletCalls.length,0);
 assert.match(b.element('status').textContent,/offene Anfrage/);
});
test('a rejected wallet request stops automatic continuation',async()=>{
 const b=browser({steps:[status('review'),status('review','two')],send:async()=>{throw Object.assign(Error('rejected'),{code:4001});}});
 await settle();await b.start();
 assert.equal(b.walletCalls.filter(x=>x==='eth_sendTransaction').length,1);
 assert.equal(b.sessionStorage.getItem('moduleConsoleRunIntent'),null);
 assert.equal(b.sessionStorage.getItem('moduleConsoleWalletPending'),null);
 assert.match(b.element('error').textContent,/abgelehnt/);
});
test('pause during a wallet confirmation records the result but starts no new request',async()=>{
 let confirm;const signed=new Promise(r=>confirm=r);
 const b=browser({steps:[status('review'),status('review','two')],send:()=>signed});
 await settle();const active=b.start();await settle();
 assert.equal(b.element('start').textContent,'Läuft automatisch');b.pause();confirm(hash);await active;
 assert.equal(b.calls.filter(x=>x.path==='/submitted').length,1);
 assert.equal(b.walletCalls.filter(x=>x==='eth_sendTransaction').length,1);
 assert.equal(b.sessionStorage.getItem('moduleConsoleRunIntent'),null);
 assert.match(b.element('status').textContent,/Pausiert/);
});
test('temporary acknowledgement failures retry the hash, never the wallet transaction',async()=>{
 let attempts=0;
 const b=browser({steps:[status('review'),status('complete')],fetchHook:async path=>path==='/submitted'&&attempts++<2?{ok:false,status:503}:undefined});
 await settle();await b.start();
 assert.equal(attempts,3);assert.equal(b.walletCalls.filter(x=>x==='eth_sendTransaction').length,1);
 assert.equal(b.localStorage.getItem('moduleConsolePending'),null);
});
test('an expired unsigned request is renewed without a second start click',async()=>{
 let revalidations=0;
 const b=browser({steps:[status('review','expired'),status('review','fresh'),status('complete')],fetchHook:async path=>path==='/revalidate'&&revalidations++===0?{ok:false,status:400,json:async()=>({error:'expired',code:'PREPARATION_EXPIRED'})}:undefined});
 await settle();await b.start();assert.equal(revalidations,2);
 assert.equal(b.walletCalls.filter(x=>x==='eth_sendTransaction').length,1);
});
test('another active tab prevents a competing wallet loop',async()=>{
 const b=browser({lock:false,session:{moduleConsoleRunIntent:'test-session'}});await settle();
 assert.equal(b.walletCalls.length,0);assert.match(b.element('status').textContent,/anderen Fenster/);
});
