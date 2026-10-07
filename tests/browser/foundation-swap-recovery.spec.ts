import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

let server: Server, origin: string;

test.beforeAll(async () => {
  // Exercise the real asynchronous SwapPanel with controlled wallet and journal
  // boundaries. No provider, signature or transaction is used by this fixture.
  const stubs: Record<string, string> = {
    wallet: `export const useWallet = () => ({ wallet: { account: '0x'+'a'.repeat(40), chainId: '4663' }, authenticated: true, sessionReady: true,
      readTradeBalances: async () => ({nativeBalanceWei: 1000000000000000000n, tokenBalanceRaw: 0n, gasPriceWei: 1n}) });`,
    client: `export async function fetchSwapToken() { return {schemaVersion:'programmable.swap-token.v1',chainId:4663,status:'ready',
      token:{address:'0x'+'b'.repeat(40),name:'Module coin',symbol:'MOD',decimals:18},route:{kind:'module-foundation',transactionHash:'0x'+'1'.repeat(64)}}; }
      export function getPendingSwap() { const mode=new URLSearchParams(location.search).get('mode');
        if(mode==='storage-error') throw Error('storage unavailable');
        return mode==='pending' || mode==='unknown-hash' ? {kind:'swap',chainId:4663,hash:mode==='pending'?'0x'+'2'.repeat(64):null} : null; }
      export function subscribePendingSwap(){return () => {}};
      export function prepareSwap(){throw Error('Generic preparation must not run for Foundation')}
      export function recoverSwap(){throw Error('Not used by fixture')}`,
    foundation: `import React from 'react'; export function ModuleFoundationMarketHost(){return React.createElement('button',null,'Foundation trade')}`,
    dynamic: `import React from 'react'; export default function dynamic(load){const Component=React.lazy(async()=>({default:await load()}));return props=>React.createElement(React.Suspense,{fallback:null},React.createElement(Component,props))}`,
    link: `import React from 'react'; export default function Link(props){return React.createElement('a',props)}`,
  };
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SwapPanel} from './components/swap-panel';
      createRoot(document.getElementById('root')).render(<SwapPanel embedded initialAddress={'0x'+'b'.repeat(40)} />);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, outdir: "/fixture", format: "esm", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "wallet-boundaries", setup(builder) {
      builder.onResolve({ filter: /wallet-provider$|lib\/swap\/client$|module-foundation-market-host$|^next\/(dynamic|link)$/ }, args => ({
        path: args.path.includes("wallet-provider") ? "wallet" : args.path.includes("swap/client") ? "client"
          : args.path.includes("module-foundation-market-host") ? "foundation" : args.path.slice(5), namespace: "fixture",
      }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js", resolveDir: process.cwd() }));
    } }],
  });
  const files = new Map(bundle.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  server = createServer((request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    if (files.has(path)) { response.setHeader("Content-Type", path.endsWith(".css") ? "text/css" : "text/javascript"); response.end(files.get(path)); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw Error("Fixture failed");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => { server?.close(); if (server) await once(server, "close"); });

test("Foundation trading opens after the previous swap journal is clear", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Foundation trade" })).toBeVisible();
});

for (const mode of ["pending", "unknown-hash", "storage-error"]) {
  test(`Foundation keeps previous swap recovery visible: ${mode}`, async ({ page }) => {
    await page.goto(`${origin}/?mode=${mode}`);
    if (mode === "storage-error") await expect(page.getByRole("alert")).toContainText("Saved wallet activity could not be read");
    else {
      await expect(page.getByRole("button", { name: "Check confirmation" })).toBeVisible();
      if (mode === "unknown-hash") await expect(page.getByLabel("Transaction hash")).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Foundation trade" })).toHaveCount(0);
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });
}
