import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { build } from "esbuild";

/** Real studio and header with a synthetic catalog. No wallet, RPC or launch actions. */
export async function createModuleStudioServer() {
  const root = process.cwd();
  const entry = `
    import React, {useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {FoundationStudio} from './components/module-studio/studio';
    import {SiteHeader} from './components/site-navigation';
    import styles from './components/module-studio/studio.module.css';
    import './app/globals.css'; import './app/interface.css';
    import './app/programmable-experience.css'; import './app/webde-final-ui.css'; import './app/surfaces.css';
    const catalog = [{id:'wallet-cap-fixture',version:'1.0.0',digest:'0x'+'11'.repeat(32),name:'Initial wallet buy limit',
      description:'This module limits how much each wallet can buy during the opening period.',capabilities:['beforeSwap'],
      fields:[],available:true,studio:{category:'trading'}}];
    function App() {
      const [draft,setDraft] = useState({name:'',symbol:'COIN',description:'',image:null,socialLinks:{},quoteAsset:'',
        creatorFeeBps:0,initialBuy:'0.001',additionalLiquidity:'0',modules:[]});
      const [customQuote,setCustomQuote] = useState(false);
      const [errors,setErrors] = useState(new URLSearchParams(location.search).get('mode')==='error'?{name:'Enter a coin name'}:{});
      const imageInput = useRef(null);
      return <div className="app-frame"><SiteHeader/><main><div className={styles.launchPage}>
        <FoundationStudio draft={draft} catalog={catalog} quoteSymbol={customQuote?'TOKEN':'ETH'} initialBuy={draft.initialBuy}
          actionLabel="Review coin" errors={errors} customQuote={customQuote} canResolveQuote imageInput={imageInput}
          onUpdate={(key,value)=>{setDraft(current=>({...current,[key]:value}));setErrors({});}}
          onQuoteChange={address=>{setCustomQuote(true);setDraft(current=>({...current,quoteAsset:address}));}}
          onEnableQuote={()=>setCustomQuote(true)}
          onDefaultQuote={()=>{setCustomQuote(false);setDraft(current=>({...current,quoteAsset:''}));}}
          onChooseImage={()=>{}} onRemoveImage={()=>{}}
          onSubmit={event=>{event.preventDefault();setErrors(draft.name?{}:{name:'Enter a coin name'});}}/>
      </div></main></div>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const bundled = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic", external: ["/fonts/*", "/brand/*"],
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "module-studio-boundaries", setup(plugin) {
      plugin.onResolve({ filter: /^(@\/components\/wallet-provider|next\/(navigation|link|image))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root,
        contents: args.path === "@/components/wallet-provider" ? `export const useWallet=()=>({wallet:null,authenticated:false,walletLinked:false,authReady:true,sessionReady:true,hasSession:false,openingWallet:false,connecting:false,disconnecting:false,preloadWallet:()=>{},openWallet:()=>{},disconnect:async()=>false});`
          : args.path === "next/navigation" ? `export const usePathname=()=>'/launch/modules/foundation';export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({prefetch:()=>{},push:()=>{},replace:()=>{}});`
          : args.path === "next/link" ? `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`
          : `import React from 'react';export default function Image({priority,fill,unoptimized,...props}){return <img {...props}/>}` }));
    } }],
  });
  const files = new Map(bundled.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (files.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(files.get(url.pathname)); return; }
    if (url.pathname.startsWith("/api/")) { response.writeHead(403); response.end("Financial actions disabled in this fixture"); return; }
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
      const base = resolve(root, "public"), file = resolve(base, "." + url.pathname);
      if (!file.startsWith(base + sep)) { response.writeHead(404); response.end(); return; }
      const types = { ".woff2": "font/woff2", ".png": "image/png", ".avif": "image/avif", ".webp": "image/webp", ".svg": "image/svg+xml" };
      try { response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream"); response.end(await readFile(file)); }
      catch { response.writeHead(404); response.end(); } return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Local Module Studio fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
