#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { isInterfacePresentationCandidate } from "./ci/classify-verify-paths.mjs";

const exec = promisify(execFile);
const REPOSITORY = "programmablehq/PROGRAMMABLE";
const PROJECT = "prj_MM8nbhoztJnz1yhimwc9CVFYhAd7";
const TEAM = "team_x9QVubeZTF27TMYRLZWRvltj";
const VERCEL_SCOPE = "aficialais-projects";
const SITE = "https://programmable.market";
const SHA = /^[a-f0-9]{40}$/u;
class PublicationError extends Error {}
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function command(binary, args, timeout = 60_000) {
  try {
    return (await exec(binary, args, { timeout, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  } catch {
    // Provider stderr and command arguments can contain credentials.
    throw new PublicationError(`${binary} ${args[0]} failed. No deployment was retried.`);
  }
}
const git = (...args) => command("git", args);
const github = async (endpoint) => JSON.parse(await command("gh", ["api", endpoint]));
const vercel = (...args) => command("vercel", [...args, "--scope", VERCEL_SCOPE, "--non-interactive",
  ...(process.env.VERCEL_TOKEN ? ["--token", process.env.VERCEL_TOKEN] : [])], 20 * 60_000);
const deployment = async (id) => JSON.parse(await vercel("api",
  `/v13/deployments/${encodeURIComponent(id)}?teamId=${TEAM}`, "--raw"));

export function deploymentSource(value) {
  const sha = value.meta?.githubCommitSha ?? value.meta?.gitCommitSha;
  if (value.projectId !== PROJECT || value.readyState !== "READY" || !SHA.test(sha ?? "")
    || !/^dpl_[A-Za-z0-9]+$/u.test(value.id ?? "")
    || !/^[A-Za-z0-9.-]+\.vercel\.app$/u.test(value.url ?? "")) {
    throw new PublicationError("The deployment must be READY and belong to Programmable with an exact source commit.");
  }
  return { id: value.id, sha, url: `https://${value.url}` };
}

async function source() {
  const remote = (await git("remote", "get-url", "origin")).replace(/\.git$/u, "").toLowerCase();
  if (!["https://github.com/programmablehq/programmable", "git@github.com:programmablehq/programmable"].includes(remote)) {
    throw new PublicationError("Use the canonical Programmable repository.");
  }
  if (await git("status", "--porcelain", "--untracked-files=no")) throw new PublicationError("Commit the change before publishing.");
  const head = await git("rev-parse", "HEAD");
  const branch = await git("branch", "--show-current");
  if (branch !== "production" && !(process.env.GITHUB_REF === "refs/heads/production" && process.env.GITHUB_SHA === head)) {
    throw new PublicationError("Publish from the clean production checkout.");
  }
  const remoteHead = (await git("ls-remote", "origin", "refs/heads/production")).split(/\s+/u)[0];
  if (!SHA.test(head) || head !== remoteHead) throw new PublicationError("The production branch has moved. Publish its current commit.");
  return head;
}

async function plan() {
  const head = await source();
  const live = deploymentSource(await deployment("programmable.market"));
  if (head === live.sha) return { eligible: false, reason: "already-live", head, live, paths: [] };
  // Check the entire outstanding release, not just the last push. A pending
  // trading or server change cannot ride along with a later CSS change.
  await git("merge-base", "--is-ancestor", live.sha, head);
  const paths = (await git("diff", "--no-renames", "--name-only", live.sha, head)).split("\n").filter(Boolean);
  return { eligible: isInterfacePresentationCandidate(paths), reason: "presentation-scope", head, live, paths };
}

async function provePresentation(value) {
  const directory = await mkdtemp(join(tmpdir(), "programmable-ui-publish-"));
  try {
    const classifier = await git("show", `${value.live.sha}:scripts/ci/classify-verify-paths.mjs`);
    const file = join(directory, "trusted-classifier.mjs");
    await writeFile(file, classifier, { mode: 0o600 });
    const trusted = await import(pathToFileURL(file).href);
    return typeof trusted.isInterfacePresentationOnlyChange === "function"
      && trusted.isInterfacePresentationOnlyChange(value.paths, { baseSha: value.live.sha, headSha: value.head });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function waitForVerify(head) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const result = await github(`repos/${REPOSITORY}/actions/workflows/verify.yml/runs?head_sha=${head}&event=push&branch=production&per_page=1`);
    const run = result.workflow_runs?.[0];
    if (run?.status === "completed") {
      if (run.head_sha !== head || run.conclusion !== "success") throw new PublicationError("The exact production Verify run did not pass.");
      return run.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  throw new PublicationError("Production Verify is still pending. The staged deployment was not promoted.");
}

async function smoke(origin) {
  for (const path of ["/", "/explore", "/launch"]) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20_000), redirect: "error",
      headers: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {} });
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) {
      throw new PublicationError(`The website did not load at ${path}.`);
    }
    const body = await response.text();
    if (!body.includes("<html") || !body.includes("</html>")) throw new PublicationError(`The page at ${path} was incomplete.`);
  }
}

async function publish(value) {
  if (!value.eligible) throw new PublicationError("Use the functional release route for this change.");
  if (!await provePresentation(value)) {
    emit({ status: "functional-release-required", commit: value.head });
    return;
  }
  emit({ status: "building", commit: value.head, changedPaths: value.paths });
  const output = await vercel("deploy", "--prod", "--skip-domain", "--yes",
    "--meta", `githubCommitSha=${value.head}`, "--meta", "githubCommitRef=production",
    "--meta", "githubRepo=PROGRAMMABLE", "--meta", "githubOrg=programmablehq");
  const candidateUrl = output.split(/\s+/u).findLast((word) => /^https:\/\/[A-Za-z0-9.-]+\.vercel\.app$/u.test(word));
  if (!candidateUrl) throw new PublicationError("No staged deployment URL was returned. Inspect Vercel before retrying.");
  const candidate = deploymentSource(await deployment(new URL(candidateUrl).hostname));
  if (candidate.sha !== value.head) throw new PublicationError("The staged deployment source changed.");
  emit({ status: "staged", deployment: candidate.id, url: candidate.url });
  const verifyRunId = await waitForVerify(value.head);
  await smoke(candidate.url);
  const currentHead = await source();
  const currentLive = deploymentSource(await deployment("programmable.market"));
  if (currentHead !== value.head || currentLive.id !== value.live.id) {
    throw new PublicationError("Production changed while building. The candidate was not promoted.");
  }
  // Promote this exact candidate once. An uncertain response is never retried.
  await vercel("promote", candidate.id, "--yes");
  const published = deploymentSource(await deployment("programmable.market"));
  if (published.id !== candidate.id || published.sha !== value.head) throw new PublicationError("Inspect the production binding before any retry.");
  await smoke(SITE);
  const receipt = { status: "live", commit: value.head, deployment: candidate.id,
    verifyRunId, previousDeployment: value.live.id, publishedAt: new Date().toISOString(), url: SITE };
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,
    `Published [programmable.market](${SITE}) from \`${value.head}\`. Previous deployment: \`${value.live.id}\`.\n`, { flag: "a" });
  emit(receipt);
}

async function main() {
  const mode = process.argv[2] ?? "publish";
  if (!["plan", "publish"].includes(mode)) throw new PublicationError("Use plan or publish.");
  const value = await plan();
  if (mode === "plan") {
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT,
      `eligible=${value.eligible}\n`, { flag: "a" });
    emit(value);
  } else if (value.reason === "already-live") emit(value);
  else await publish(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Do not forward provider errors, signed URLs, environment values or tokens.
    process.stderr.write(`${error instanceof PublicationError ? error.message : "Website publication stopped. Inspect the last reported stage before retrying."}\n`);
    process.exitCode = 1;
  });
}
