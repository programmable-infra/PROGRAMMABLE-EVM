import {build} from 'esbuild';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
try{
 const output=path.join(root,'contracts/out/economic-modules/metamask-console.cjs');await mkdir(path.dirname(output),{recursive:true});
 const result=await build({absWorkingDir:root,entryPoints:['ops/economic-modules/metamask-console.mjs'],bundle:true,packages:'external',platform:'node',target:'node24',format:'cjs',write:false,tsconfig:path.join(root,'tsconfig.json'),logLevel:'silent'});
 await writeFile(output,result.outputFiles[0].contents,{mode:0o600});
 const mod=await import(pathToFileURL(output).href);await (mod.run??mod.default.run)(process.argv.slice(2),root);
}catch(e){console.error(e.safeMessage??'Die lokale Konsole konnte nicht starten. Keine Transaktion gesendet.');if(e.errors)console.error(e.errors.map(x=>({text:x.text,location:x.location})));process.exitCode=1;}
