import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

// Local test host: actual component and CSS; only Next adapters and wallet/API
// are fixtures. This file is never imported by a production entry point.
export async function createLateMigrationServer() {
  const root = process.cwd();
  const bundled = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {LateMigrationClaim} from './components/late-migration-claim'; import {FixtureWallet,FIXTURE_CONTRACT} from './tests/browser/fixtures/late-migration-wallet'; import './app/globals.css'; import './app/surfaces.css'; createRoot(document.getElementById('root')).render(<FixtureWallet><LateMigrationClaim intakeActivation={new URLSearchParams(window.location.search).get('disabled') === 'true' ? null : {sourceContractAddress:FIXTURE_CONTRACT}}/></FixtureWallet>);`,
      loader: "tsx", resolveDir: root,
    },
    bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    external: ["/brand/*", "/fonts/*"],
    plugins: [{ name: "late-migration-fixture", setup(plugin) {
      plugin.onResolve({filter:/^@\/components\/wallet-provider$/},()=>({path:resolve(root,"tests/browser/fixtures/late-migration-wallet.tsx")}));
      plugin.onResolve({filter:/^next\/(link|image)$/}, args=>({path:args.path,namespace:"fixture"}));
      plugin.onLoad({filter:/.*/,namespace:"fixture"}, args=>({loader:"tsx",resolveDir:root,contents:args.path==="next/link"
        ? `import React from 'react'; export default function Link({prefetch,...props}) { return <a {...props}/>; }`
        : `import React from 'react'; export default function Image({priority,fill,...props}) { return <img {...props}/>; }` }));
    }}],
  });
  const sources = new Map(bundled.outputFiles.map(file=>[file.path.endsWith('.css')?'/fixture.css':'/fixture.js',file.contents]));
  return createServer(async(request,response)=>{
    const url = new URL(request.url,'http://localhost');
    if(sources.has(url.pathname)) {response.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');response.end(sources.get(url.pathname));return;}
    if(url.pathname.startsWith('/brand/') || url.pathname.startsWith('/fonts/')) {
      const base=resolve(root,'public'), file=resolve(base,'.'+url.pathname);
      if(!file.startsWith(base+sep)) {response.writeHead(404);response.end();return;}
      try {response.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.woff2')?'font/woff2':'image/png');response.end(await readFile(file));}
      catch {response.writeHead(404);response.end();} return;
    }
    if(url.pathname.startsWith('/api/')) {response.writeHead(503);response.end('Fixture API interception required');return;}
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><title>Late migration local QA</title><style>:root{--font-instrument:Arial,sans-serif;--font-plex-mono:monospace}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
