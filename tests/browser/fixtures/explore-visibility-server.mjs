import { createServer } from 'node:http';
import { build } from 'esbuild';

/** Real Explore lifecycle, deterministic empty catalog, no provider access. */
export async function createExploreVisibilityServer() {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {UnifiedLaunchesView} from './components/robinhood-launches-view';
    const standalone=new URLSearchParams(location.search).has('standalone');
    createRoot(document.getElementById('root')).render(<main>
      {!standalone?<section style={{height:1400}}><h1>Introduction</h1></section>:null}
      <UnifiedLaunchesView embedded={!standalone}/></main>);
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', outdir: '/fixture-output',
    external: ['/fonts/*', '/brand/*'], define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [{ name: 'boundaries', setup(p) {
      p.onResolve({filter:/^(next\/(link|navigation)|@\/components\/view-chain)$/}, a=>({path:a.path,namespace:'stub'}));
      p.onLoad({filter:/.*/,namespace:'stub'}, a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='next/link'
        ? 'import React from "react";export default function Link({prefetch,...props}){return <a {...props}/>}'
        : a.path==='next/navigation' ? 'export const useRouter=()=>({prefetch:()=>{}});export const usePathname=()=>"/";'
        : 'export const useRouteViewChain=()=>({hydrated:true,viewChainId:4663});'}));
    }}] });
  const files=new Map(result.outputFiles.map(f=>[f.path.endsWith('.css')?'/fixture.css':'/fixture.js',f.contents]));
  return createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(files.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(files.get(url.pathname));return;}
    if(url.pathname==='/api/explore/launches'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({scope:'all',status:'ready',updatedAt:new Date().toISOString(),items:[],presentations:[],page:{number:1,size:10,totalItems:0,totalPages:0,hasMore:false}}));return;}
    if(url.pathname.startsWith('/api/')){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
