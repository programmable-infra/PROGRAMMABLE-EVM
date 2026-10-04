import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyVerifyPaths, isInterfacePresentationCandidate, isInterfacePresentationOnlyChange } from "./classify-verify-paths.mjs";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const file = "components/module-studio/studio.tsx";
const before = 'export const Card = () => <button onClick={sign} aria-label="Buy">Buy token</button>;';
const copy = before.replace("Buy token", "Buy your token").replace('aria-label="Buy"', 'aria-label="Buy token"');
const classify = (paths = [file], after = copy, extra = {}) => isInterfacePresentationOnlyChange(paths, {
  baseSha, headSha, readChange: () => [before, after], validateFile: () => {}, ...extra,
});

test("styles, images, fonts and copy can omit unrelated functional suites", () => {
  assert.equal(classify(), true);
  assert.equal(classify(["app/globals.css", "public/brand/module.avif", "public/brand/font.woff2"]), true);
  assert.equal(classify([file, "components/module-studio/studio.module.css"]), true);
  assert.equal(classify([file], before.replace("Buy token", "Sell <strong>now</strong>")), false);
});

test("copy coverage never erases imports, handlers, links, signing inputs, operators or conditional logic", () => {
  for (const after of [
    before.replace("{sign}", "{otherWallet}"),
    before.replace("{sign}", "{() => sign(200)}"),
    before.replace("<button", '<button disabled={false}'),
    before.replace("<button", '<button data-chain="1"'),
    before.replace("<button", '<button href="/different-route"'),
    `import "./different-wallet"; ${before}`,
    before.replace("sign", "true ? sign : other"),
    before.replace("Buy token", "{getQuote()}"),
    "const amount = 2; " + copy,
    "const fee = '0.3%'; " + copy,
    before.replace("Buy token", "{`Buy ${amount}`}"),
    before.replace("</button>", ""),
  ]) assert.equal(classify([file], after), false, after);
  for (const [oldSource, newSource] of [
    ['const App = () => <script>sendFunds(1)</script>;', 'const App = () => <script>sendFunds(2)</script>;'],
    ['const App = () => <option>ETH</option>;', 'const App = () => <option>OTHER</option>;'],
    ['const App = () => <textarea>1</textarea>;', 'const App = () => <textarea>2</textarea>;'],
    ['const App = () => <Transaction title="one" />;', 'const App = () => <Transaction title="two" />;'],
    ['const App = () => <Transaction><span>one</span></Transaction>;', 'const App = () => <Transaction><span>two</span></Transaction>;'],
  ]) assert.equal(classify([file], newSource, { readChange: () => [oldSource, newSource] }), false);
  const expression = 'export const Card = () => <span>{"Buy"}</span>;';
  assert.equal(classify([file], expression.replace('"Buy"', '"Sell"'), {
    readChange: () => [expression, expression.replace('"Buy"', '"Sell"')],
  }), true);
});

test("mixed outstanding server, trade, wallet, fee, dependency and control changes require their functional release", () => {
  for (const other of ["lib/server/custom-launch/provider.ts", "lib/onchain/swap.ts",
    "app/api/explore/route.ts", "contracts/src/Hook.sol", "config/fees.json", "package.json",
    "vercel.json", "scripts/publish-website-ui.mjs", ".github/workflows/verify.yml",
    "public/.well-known/launch.json", "README.md"]) {
    assert.equal(classify(["components/module-studio/studio.module.css", other]), false, other);
  }
  assert.equal(classify([], copy), false);
  assert.equal(classify([file, file]), false);
  assert.equal(classify([file], copy, { scope: classifyVerifyPaths([], { forceAll: true }) }), false);
  assert.equal(classify([file], copy, { baseSha: "" }), false);
  assert.equal(classify([file], copy, { headSha: baseSha }), false);
  assert.equal(classify([file], copy, { validateFile: () => { throw new Error("symlink"); } }), false);
});

test("the copied trusted classifier works without dependencies for CSS and rejects a whole mixed release", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "programmable-presentation-scope-")));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "--initial-branch=production");
    git("config", "user.name", "CI fixture");
    git("config", "user.email", "fixture@example.invalid");
    mkdirSync(join(directory, "components"));
    writeFileSync(join(directory, "components/card.css"), ".card { color: red; }\n");
    git("add", ".");
    git("commit", "-m", "Base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(directory, "components/card.css"), ".card { color: pink; }\n");
    git("add", ".");
    git("commit", "-m", "Style");
    const trusted = join(directory, "trusted.mjs");
    writeFileSync(trusted, readFileSync(new URL("./classify-verify-paths.mjs", import.meta.url)));
    const paths = join(directory, "paths.txt");
    const run = (files) => {
      writeFileSync(paths, files.join("\n") + "\n");
      return execFileSync(process.execPath, [trusted, paths], { cwd: directory, encoding: "utf8",
        env: { PATH: process.env.PATH, BASE_SHA: base, HEAD_SHA: git("rev-parse", "HEAD") } });
    };
    assert.match(run(["components/card.css"]), /^interface_presentation_only=true$/mu);
    mkdirSync(join(directory, "lib/server"), { recursive: true });
    writeFileSync(join(directory, "lib/server/trading.ts"), "export const changed = true;\n");
    git("add", "lib/server/trading.ts");
    git("commit", "-m", "Outstanding server change");
    assert.match(run(["components/card.css", "lib/server/trading.ts"]), /^interface_presentation_only=false$/mu);
    assert.equal(isInterfacePresentationCandidate(["components/card.css", "lib/server/trading.ts"]), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
