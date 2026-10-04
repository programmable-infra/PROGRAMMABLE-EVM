import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";
import { deploymentSource } from "../publish-website-ui.mjs";

const fixture = { id: "dpl_ABC123", projectId: "prj_MM8nbhoztJnz1yhimwc9CVFYhAd7", readyState: "READY",
  url: "programmable-ui.vercel.app", meta: { githubCommitSha: "a".repeat(40) } };

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
