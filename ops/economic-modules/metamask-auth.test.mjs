import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {fetchEthereumAuthorization} from './metamask-auth.mjs';
import {ACCOUNT} from './metamask-core.mjs';

// Match serve-metamask.mjs, including external dependencies and the CJS target.
const result=await build({entryPoints:[fileURLToPath(new URL('./metamask-auth.mjs',import.meta.url))],bundle:true,packages:'external',platform:'node',target:'node24',format:'cjs',write:false,logLevel:'silent'});
const bundledModule={exports:{}};
vm.runInNewContext(result.outputFiles[0].text,{module:bundledModule,exports:bundledModule.exports,require:createRequire(import.meta.url),AbortSignal,fetch:(...args)=>globalThis.fetch(...args)});
const modes=[['native ESM',fetchEthereumAuthorization],['server CJS bundle',bundledModule.exports.fetchEthereumAuthorization]];
const origin='https://programmable.market';
const request={schemaVersion:'mock-unsigned-request',launchWallet:ACCOUNT};
const session=()=>({walletAddress:ACCOUNT,appId:'mock-app',userId:'did:privy:mock-user',token:'mock-old-customer',refreshToken:'mock-old-refresh',privyAccessToken:'mock-old-privy',identityToken:'mock-old-identity'});
const fresh=()=>({user:{id:'did:privy:mock-user'},token:'mock-new-customer',refresh_token:'mock-new-refresh',privy_access_token:'mock-new-privy',identity_token:'mock-new-identity'});

function mockNetwork(t,{statuses=[401,200],refresh=fresh(),refreshStatus=200}={}){
 const calls=[],saved=[],events=[];
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const req=new Request(input,options),url=new URL(req.url);
  const body=req.method==='POST'?await req.json():null;
  const call={url:req.url,headers:req.headers,body};calls.push(call);
  if(url.origin===origin&&url.pathname==='/api/module-foundation/authorize'){
   events.push('authorize');
   const status=statuses.shift();assert.ok(status,'Unexpected authorization retry');
   return Response.json({unsigned:true},{status});
  }
  assert.equal(url.origin,'https://auth.privy.io');
  if(url.pathname==='/api/v1/apps/mock-app')return Response.json({id:'mock-app'});
  if(url.pathname==='/api/v1/analytics_events')return Response.json({});
  assert.equal(url.pathname,'/api/v1/sessions');
  events.push('refresh');
  return Response.json(refresh,{status:refreshStatus});
 });
 return {calls,saved,events,persist:async value=>{events.push('persist');saved.push(value);}};
}

for(const [mode,authorize] of modes){
 test(`${mode}: renews the same session and persists rotated credentials before one retry`,async t=>{
  const net=mockNetwork(t),original=session();
  assert.equal((await authorize(request,original,net.persist)).status,200);
  assert.deepEqual(net.events,['authorize','refresh','persist','authorize']);
  const auth=net.calls.filter(call=>call.url.startsWith(origin)),refresh=net.calls.find(call=>call.url.endsWith('/sessions'));
  assert.equal(auth[0].headers.get('authorization'),'Bearer mock-old-customer');
  assert.equal(auth[1].headers.get('authorization'),'Bearer mock-new-customer');
  assert.equal(auth[1].headers.get('x-privy-identity-token'),'mock-new-identity');
  assert.deepEqual(auth.map(call=>call.body),[request,request]);
  assert.equal(refresh.headers.get('authorization'),'Bearer mock-old-privy');
  assert.equal(refresh.headers.get('origin'),origin);
  assert.equal(refresh.headers.get('privy-app-id'),'mock-app');
  assert.deepEqual(refresh.body,{refresh_token:'mock-old-refresh'});
  assert.equal(net.saved[0].userId,original.userId);
  assert.equal(net.saved[0].walletAddress,ACCOUNT);
  assert.equal(net.saved[0].refreshToken,'mock-new-refresh');
  assert.equal(net.saved[0].privyAccessToken,'mock-new-privy');
  assert.equal(original.token,'mock-old-customer');
 });
 test(`${mode}: returns success and rate limits without refreshing`,async t=>{
  const net=mockNetwork(t,{statuses:[200,429]});
  assert.equal((await authorize(request,session(),net.persist)).status,200);
  assert.equal((await authorize(request,session(),net.persist)).status,429);
  assert.deepEqual(net.events,['authorize','authorize']);
 });
 test(`${mode}: preserves a second unauthorized response without a refresh loop`,async t=>{
  const net=mockNetwork(t,{statuses:[401,401]});
  assert.equal((await authorize(request,session(),net.persist)).status,401);
  assert.deepEqual(net.events,['authorize','refresh','persist','authorize']);
 });
 test(`${mode}: never refreshes without existing credentials or sends a different wallet`,async t=>{
  const net=mockNetwork(t),missing=session();delete missing.refreshToken;
  assert.equal((await authorize(request,missing,net.persist)).status,401);
  await assert.rejects(authorize(request,{...session(),walletAddress:'0x'+'11'.repeat(20)},net.persist),/Test-Wallet/);
  assert.deepEqual(net.events,['authorize']);
 });
 test(`${mode}: rejects identity changes before saving or retrying`,async t=>{
  const net=mockNetwork(t,{refresh:{...fresh(),user:{id:'did:privy:someone-else'}}});
  await assert.rejects(authorize(request,session(),net.persist),/Anmeldung hat sich geändert/);
  assert.deepEqual(net.events,['authorize','refresh']);
 });
 test(`${mode}: rejects incomplete rotated credentials`,async t=>{
  const invalid=fresh();delete invalid.refresh_token;
  const net=mockNetwork(t,{refresh:invalid});
  await assert.rejects(authorize(request,session(),net.persist),/unvollständig/);
  assert.deepEqual(net.events,['authorize','refresh']);
 });
 test(`${mode}: failed persistence prevents the authorization retry`,async t=>{
  const net=mockNetwork(t);
  await assert.rejects(authorize(request,session(),async()=>{throw Error('mock disk failure');}),/mock disk failure/);
  assert.deepEqual(net.events,['authorize','refresh']);
 });
 test(`${mode}: refresh failures do not expose authentication response details`,async t=>{
  const net=mockNetwork(t,{refreshStatus:401,refresh:{error:'mock-sensitive-server-detail',code:'invalid_token'}});
  await assert.rejects(authorize(request,session(),net.persist),error=>{
   assert.equal(error.message,'Die bestehende Privy-Anmeldung konnte nicht erneuert werden.');
   assert.equal(error.cause,undefined);return true;
  });
  assert.deepEqual(net.events,['authorize','refresh']);
 });
}
