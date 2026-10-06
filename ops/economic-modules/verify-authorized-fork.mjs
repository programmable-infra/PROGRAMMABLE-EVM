#!/usr/bin/env node
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
try {
  const built = await build({ absWorkingDir: root, entryPoints: ["ops/economic-modules/verify-authorized-fork.ts"],
    bundle: true, packages: "external", platform: "node", target: "node24", format: "cjs", write: false,
    tsconfig: path.join(root, "tsconfig.json"), logLevel: "silent" });
  const bytes = built.outputFiles[0].contents;
  const directory = path.join(root, "contracts/out/economic-modules");
  await mkdir(directory, { recursive: true });
  const entry = path.join(directory, `${createHash("sha256").update(bytes).digest("hex")}.cjs`);
  await writeFile(entry, bytes, { mode: 0o600 });
  const compiled = await import(pathToFileURL(entry).href);
  await (compiled.run ?? compiled.default.run)(process.argv.slice(2), root);
} catch (error) {
  console.error(error instanceof Error && /^Probe: [a-zA-Z0-9 ,:.()/-]+$/.test(error.message)
    ? error.message : "Probe: stopped; credentials and transaction payloads were not printed");
  process.exitCode = 1;
}
