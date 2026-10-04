import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import yaml from "js-yaml";
import { deploymentSource, presentationDeploymentArguments } from "../publish-website-ui.mjs";

const fixture = { id: "dpl_ABC123", projectId: "prj_MM8nbhoztJnz1yhimwc9CVFYhAd7", readyState: "READY",
  url: "programmable-ui.vercel.app", meta: { githubCommitSha: "a".repeat(40) } };

test("metadata and both runtime identities use the same commit required by Custom Hook sessions", () => {
  const args = presentationDeploymentArguments(fixture.meta.githubCommitSha);
  const values = (flag) => args.flatMap((value, index) => value === flag ? [args[index + 1]] : []);
  const env = Object.fromEntries(values("--env").map((value) => value.split("=")));
  const meta = Object.fromEntries(values("--meta").map((value) => value.split("=")));
  assert.equal(env.VERCEL_GIT_COMMIT_SHA, meta.githubCommitSha);
  assert.equal(env.PROGRAMMABLE_RELEASE_COMMIT_SHA, env.VERCEL_GIT_COMMIT_SHA);
  assert.equal(env.PROGRAMMABLE_RELEASE_COMMIT_SHA, fixture.meta.githubCommitSha);
  assert.ok(args.includes("--skip-domain"));
  assert.equal(args.includes("--force"), false);
  assert.throws(() => presentationDeploymentArguments("production"));
});

test("publication binds the deployed project and exact Git source, never a broken or arbitrary deployment", () => {
  assert.equal(deploymentSource(fixture).sha, fixture.meta.githubCommitSha);
  for (const invalid of [
    { ...fixture, projectId: "another-project" }, { ...fixture, readyState: "BUILDING" },
    { ...fixture, meta: {} }, { ...fixture, meta: { githubCommitSha: "production" } },
    { ...fixture, url: "programmable.market" }, { ...fixture, url: "evil.test/path.vercel.app" },
    { ...fixture, id: "not-a-deployment" },
  ]) assert.throws(() => deploymentSource(invalid));
});

test("automatic UI publication uses only the protected production branch and serializes against the functional deploy", () => {
  const workflow = yaml.load(readFileSync(new URL("../../.github/workflows/publish-website-ui.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["production"]);
  assert.equal(workflow.concurrency.group, "programmable-production");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const job = workflow.jobs.publish;
  assert.equal(job.environment, "production");
  assert.equal(job.if, "github.repository_id == 1314365508");
  for (const step of job.steps) assert.equal(step["continue-on-error"], undefined);
  assert.equal(job.steps.find((step) => step.name === "Build and publish the UI once").if, "steps.plan.outputs.eligible == 'true'");
});

test("local recovery rejects untracked source before contacting a deployment provider", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "programmable-ui-clean-source-")));
  try {
    execFileSync("git", ["init", "--initial-branch=production"], { cwd: directory, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/programmablehq/PROGRAMMABLE.git"], { cwd: directory });
    writeFileSync(join(directory, "unreviewed-route.ts"), "export const changed = true;\n");
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../publish-website-ui.mjs", import.meta.url)), "plan"],
      { cwd: directory, encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Commit the change before publishing/u);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
