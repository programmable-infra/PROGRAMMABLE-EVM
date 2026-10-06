#!/usr/bin/env node
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
try {
  const result = await build({ absWorkingDir: root, entryPoints: ["ops/module-owner-publication/ethereum-admissions-core.ts"],
    bundle: true, packages: "external", platform: "node", target: "node24", format: "esm", write: false,
    tsconfig: path.join(root, "tsconfig.json"), logLevel: "silent" });
  const bytes = result.outputFiles[0].contents, hash = createHash("sha256").update(bytes).digest("hex");
  const directory = path.join(root, "contracts/out/module-owner-publication");
  await mkdir(directory, { recursive: true });
  const entry = path.join(directory, `${hash}.mjs`);
  await writeFile(entry, bytes, { mode: 0o600 });
  await (await import(pathToFileURL(entry).href)).run(process.argv.slice(2), root);
} catch {
  console.error("Ethereum admissions were not created. Check the verified publications and destination.");
  process.exitCode = 1;
}
