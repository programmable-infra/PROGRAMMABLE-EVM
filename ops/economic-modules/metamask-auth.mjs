import PrivyExport,{InMemoryCache} from '@privy-io/js-sdk-core';
import {RefreshSession} from '@privy-io/routes';
import {ACCOUNT,check,fail} from './metamask-core.mjs';

const origin='https://programmable.market';
// Native ESM exposes the constructor; esbuild's external CJS import wraps the
// package namespace as the default export. Both use the installed public API.
const Privy=typeof PrivyExport==='function'?PrivyExport:PrivyExport.default;

export async function fetchEthereumAuthorization(request,session,persistSession){
 check(session.walletAddress?.toLowerCase()===ACCOUNT.toLowerCase(),'Anmeldung gehört nicht zur Test-Wallet');
 const send=()=>fetch(origin+'/api/module-foundation/authorize',{method:'POST',headers:{Origin:origin,'content-type':'application/json',Authorization:`Bearer ${session.token}`,...(session.identityToken?{'X-Privy-Identity-Token':session.identityToken}:{})},body:JSON.stringify(request),signal:AbortSignal.timeout(95000)});
 let response=await send();
 if(response.status!==401||!session.refreshToken)return response;
 check(session.appId&&session.userId&&session.privyAccessToken,'Die bestehende Anmeldung ist unvollständig.');
 let fresh;
 try{
  const sdk=new Privy({appId:session.appId,storage:new InMemoryCache()});
  fresh=await sdk.fetchPrivyRoute(RefreshSession,{body:{refresh_token:session.refreshToken},headers:{Origin:origin,Authorization:`Bearer ${session.privyAccessToken}`}});
 }catch{
  // SDK errors may include authentication response details. Never persist them
  // in the console error journal or expose them to the browser.
  fail('Die bestehende Privy-Anmeldung konnte nicht erneuert werden.');
 }
 check(fresh?.user?.id===session.userId,'Anmeldung hat sich geändert');
 check([fresh.token,fresh.refresh_token,fresh.privy_access_token].every(value=>typeof value==='string'&&value.length>0),'Die erneuerte Anmeldung ist unvollständig.');
 session={...session,token:fresh.token,refreshToken:fresh.refresh_token,privyAccessToken:fresh.privy_access_token,identityToken:fresh.identity_token};
 // Save rotated credentials before retrying; there is only one refresh per request.
 await persistSession(session);
 return send();
}
