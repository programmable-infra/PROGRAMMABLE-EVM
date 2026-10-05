import { createServer } from "node:http";
import { build } from "esbuild";

export async function createTradePanelServer() {
  const bundle = await build({ entryPoints: ["tests/browser/fixtures/trade-panel.tsx"], bundle: true, format: "esm", platform: "browser", write: false, outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const files = new Map(bundle.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (files.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(files.get(url.pathname)); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><title>Trade panel fixture</title><style>:root{--webde-surface:#171717;--webde-ink:#fff;--webde-surface-raised:#333;--panel-fill-action:#ddd}*{box-sizing:border-box}body{margin:0;background:#111;color:#fff;font:16px/1.5 Arial}main{max-width:640px;padding:24px;margin:auto}button,input{min-height:44px}button,label,input{display:block;margin-block:12px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
