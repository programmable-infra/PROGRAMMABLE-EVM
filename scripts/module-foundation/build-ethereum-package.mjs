import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const output = new URL("packages/module-foundation-ethereum/dist/index.mjs", root);
const result = await build({ absWorkingDir: fileURLToPath(root),
  entryPoints: ["packages/module-foundation-ethereum/src/index.ts"], bundle: true,
  format: "esm", platform: "node", target: "node24", packages: "external",
  write: false, legalComments: "none", sourcemap: false, treeShaking: true });
const contents = result.outputFiles[0].text;
if (process.argv.includes("--check")) {
  if (await readFile(output, "utf8") !== contents) throw new Error("The Ethereum shared package must be rebuilt.");
} else {
  await mkdir(new URL(".", output), { recursive: true });
  await writeFile(output, contents);
}
console.log(`Ethereum shared package: ${Buffer.byteLength(contents)} bytes`);
