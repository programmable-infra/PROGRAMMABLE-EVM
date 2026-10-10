import { scanEcosystem, cleanError } from '../server/scanner.mjs';
import { json } from '../server/rpc.mjs';
export const config={maxDuration:300};
const jobs=new Map();
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).end();
  const params=new URL(req.url,'https://hazarrobin.vercel.app').searchParams;
  const chainId=Number(params.get('chainId'));
  const rawMinimum=params.get('minimumBlock')??'0';if(!/^\d{1,12}$/.test(rawMinimum))return res.status(400).end();const minimumBlock=BigInt(rawMinimum);
  if(chainId!==1&&chainId!==4663)return res.status(400).json({error:'Ungültige Chain.'});
  res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  const send=value=>{if(!res.destroyed&&!res.writableEnded)res.write(json(value)+'\n');};
  send({type:'progress',message:'Gebühren werden auf der Chain geprüft…'});
  let job=jobs.get(chainId);
  if(!job||job.expires<Date.now()||(job.result&&BigInt(job.result.blockNumber)<minimumBlock)){
    const listeners=new Set();job={expires:Date.now()+300000,listeners,promise:null,result:null};jobs.set(chainId,job);
    job.promise=scanEcosystem(chainId,message=>{for(const fn of listeners)fn({type:'progress',message});},minimumBlock)
      .then(result=>{job.expires=Date.now()+(result.issues.length?0:15000);job.result=result;return result;})
      .catch(error=>{jobs.delete(chainId);throw error;});
  }
  job.listeners.add(send);
  try{send({type:'result',result:await job.promise});}
  catch(error){send({type:'error',message:cleanError(error)});}
  finally{job.listeners.delete(send);res.end();}
}
