import { scanEcosystem, cleanError } from '../server/scanner.mjs';
import { json } from '../server/rpc.mjs';
export const config={maxDuration:300};
const jobs=new Map();
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).end();
  const chainId=Number(new URL(req.url,'https://hazarrobin.vercel.app').searchParams.get('chainId'));
  if(chainId!==1&&chainId!==4663)return res.status(400).json({error:'Ungültige Chain.'});
  res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  const send=value=>{if(!res.destroyed&&!res.writableEnded)res.write(json(value)+'\n');};
  send({type:'progress',message:'Gebühren werden auf der Chain geprüft…'});
  let job=jobs.get(chainId);
  if(!job||job.expires<Date.now()){
    const listeners=new Set();job={expires:Date.now()+300000,listeners,promise:null};jobs.set(chainId,job);
    job.promise=scanEcosystem(chainId,message=>{for(const fn of listeners)fn({type:'progress',message});})
      .then(result=>{job.expires=Date.now()+15000;return result;})
      .catch(error=>{jobs.delete(chainId);throw error;});
  }
  job.listeners.add(send);
  try{send({type:'result',result:await job.promise});}
  catch(error){send({type:'error',message:cleanError(error)});}
  finally{job.listeners.delete(send);res.end();}
}
