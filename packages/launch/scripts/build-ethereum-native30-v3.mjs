import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/,'');
const write=process.argv.includes('--write');
function outputFile(file, data) { if(write) writeFileSync(file,data); else if(readFileSync(file,'utf8')!==data) throw Error('Artifact differs: '+file); }
const dir=root+'/packages/launch/contracts/ethereum-native30-v3';
const input=readFileSync(dir+'/EthereumNative30HookV3.standard-json.json','utf8');
const parsed = JSON.parse(input);
for (const name of ['EthereumNative30HookV3.sol','EthereumNativeFeeVaultV3.sol']) {
 const source = readFileSync(root+'/contracts/src/ethereum-native30-v3/'+name,'utf8');
 if (source !== parsed.sources['src/ethereum-native30-v3/'+name].content || source !== readFileSync(dir+'/'+name,'utf8')) throw Error('Source package differs: '+name);
}
const solc=process.env.SOLC ?? homedir()+'/.solc-select/artifacts/solc-0.8.26/solc-0.8.26';
if (!execFileSync(solc,['--version'],{encoding:'utf8'}).includes('0.8.26+commit.8a97fa7a')) throw Error('Wrong compiler');
const output=JSON.parse(execFileSync(solc,['--standard-json'],{input,encoding:'utf8',maxBuffer:25_000_000}));
const errors=(output.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error(JSON.stringify(errors));
const names=new Map();
function visit(n){if(!n||typeof n!=='object')return;if(n.nodeType==='VariableDeclaration'&&n.mutability==='immutable')names.set(String(n.id),n.name);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else visit(v)}}
Object.values(output.sources).forEach(s=>visit(s.ast));
const recipient='0xD88539d3c4C460136a733A3Fd60cf6BF269079da';
const recipe={sourceArtifactHash:'sha256:'+createHash('sha256').update(input).digest('hex'),sourcePropertyRef:'EthereumNative30HookV3 / EthereumNativeFeeVaultV3; canonical Standard JSON in packages/launch/contracts/ethereum-native30-v3',recipient};
for (const [role,name]of[['hook','EthereumNative30HookV3'],['vault','EthereumNativeFeeVaultV3']]){
 const c=output.contracts['src/ethereum-native30-v3/'+name+'.sol'][name];
 const immutableWords=Object.entries(c.evm.deployedBytecode.immutableReferences).map(([id,refs])=>({name:names.get(id),byteOffsets:refs.map(r=>r.start)})).sort((a,b)=>a.name.localeCompare(b.name));
 if(immutableWords.some(w=>!w.name))throw Error('unknown immutable');
 recipe[role]={runtimeTemplateHex:'0x'+c.evm.deployedBytecode.object,immutableWords};
 outputFile(dir+'/'+name+'.artifact.json',JSON.stringify({contractName:name,compiler:'0.8.26+commit.8a97fa7a',sourceArtifactHash:recipe.sourceArtifactHash,recipient,rateBps:30,abi:c.abi,creationBytecode:'0x'+c.evm.bytecode.object,...recipe[role]},null,2)+'\n');
}
outputFile(root+'/lib/custom-launch/ethereum-native30-recipes-v2.ts','/** Generated from the published Native30 V3 Standard JSON with solc 0.8.26. */\nexport const ETHEREUM_NATIVE30_RECIPES_V2 = '+JSON.stringify({native30_fee_kernel_v3:recipe},null,2)+' as const;\n');
console.log(JSON.stringify({sourceArtifactHash:recipe.sourceArtifactHash,hookBytes:(recipe.hook.runtimeTemplateHex.length-2)/2,vaultBytes:(recipe.vault.runtimeTemplateHex.length-2)/2}));
