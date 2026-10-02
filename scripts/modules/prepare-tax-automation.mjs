import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/modules/prepare-tax-automation.mjs OUTPUT_DIRECTORY [QUOTE_DECIMALS]");
const bundle = path.join(root, "node_modules/.cache/prepare-tax-automation.mjs");
await build({ entryPoints: [path.join(root, "scripts/modules/prepare-tax-automation.ts")], tsconfig: path.join(root, "tsconfig.json"),
  absWorkingDir: root, bundle: true, platform: "node", format: "esm", packages: "external", outfile: bundle });
const child = spawn(process.execPath, [bundle, path.resolve(output), process.argv[3] ?? "18"], { cwd: root, stdio: "inherit" });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
