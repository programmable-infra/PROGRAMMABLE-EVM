#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseStrictJson } from "../packages/launch/src/canonical-json.mjs";
import { decodeExactUtf8, sha256Digest } from "../packages/launch/src/io.mjs";
import { runRobinhoodV41PostdeploymentCli } from "../contracts/scripts/finalize-robinhood-custom-launch-v41-deployment.mjs";
import { robinhoodV41BackendPromotionTools } from "../contracts/scripts/robinhood-backend-promotion-v41.mjs";

export const RUNTIME_CAPTURE_PATH = "release/robinhood-chain-4663/v4.1.3/backend-promotion-input.public.json";
export const RUNTIME_ATTESTATION_PATH = "release/robinhood-chain-4663/v4.1.3/backend-promotion-input.attestation.json";
const MAXIMUM_BYTES = 16 * 1024 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

function boundBytes(root, relative) {
  let file = root;
  for (const segment of relative.split("/")) {
    file = path.join(file, segment);
    assert.ok(!lstatSync(file).isSymbolicLink(), "runtime capture paths must not contain symlinks");
  }
  const metadata = lstatSync(file);
  assert.ok(metadata.isFile() && metadata.size > 0 && metadata.size <= MAXIMUM_BYTES,
    "runtime capture must be a bounded regular file");
  const bytes = readFileSync(file);
  const committed = execFileSync("git", ["-C", root, "show", `HEAD:${relative}`], {
    maxBuffer: MAXIMUM_BYTES,
    env: { ...Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !key.startsWith("GIT_"))), GIT_NO_REPLACE_OBJECTS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(bytes.equals(committed), "runtime capture bytes must match the exact source commit");
  return bytes;
}

/** Reauthenticate a new runtime capture, then retain every historical apply gate. */
export async function verifyRuntimePromotionReadiness(argv, {
  runFinalizer = runRobinhoodV41PostdeploymentCli,
  freshVerifyBackend = robinhoodV41BackendPromotionTools.freshVerifyRobinhoodBackendPromotionInput,
} = {}) {
  const [command, ...rest] = argv;
  assert.ok(command === "apply" && rest.length % 2 === 0, "only the 4.1.3 read-only apply route is supported");
  const flags = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    assert.ok(!flags.has(rest[index]) && typeof rest[index + 1] === "string"
      && rest[index + 1].length > 0, "duplicate or empty runtime verifier arguments");
    flags.set(rest[index], rest[index + 1]);
  }
  assert.ok(flags.has("--repository-root") && flags.has("--stage"), "exact repository root and original stage are required");
  const root = realpathSync(path.resolve(flags.get("--repository-root")));
  const packageJson = JSON.parse(readFileSync(path.join(root, "packages/launch/package.json"), "utf8"));
  assert.ok(packageJson.name === "@programmable/launch" && packageJson.version === "4.1.3",
    "runtime revalidation is restricted to @programmable/launch 4.1.3");
  const inputBytes = boundBytes(root, RUNTIME_CAPTURE_PATH);
  const attestationBytes = boundBytes(root, RUNTIME_ATTESTATION_PATH);
  const input = parseStrictJson(decodeExactUtf8(inputBytes, "runtime backend capture"), {
    maximumBytes: MAXIMUM_BYTES, maximumDepth: 96,
  });
  const unchanged = () => {
    assert.ok(inputBytes.equals(boundBytes(root, RUNTIME_CAPTURE_PATH))
      && attestationBytes.equals(boundBytes(root, RUNTIME_ATTESTATION_PATH)),
    "runtime capture changed during verification");
  };
  // The existing importer verifies the closed V4.1 tuple, freshness and the
  // backend's exact protected-main capture workflow through pinned Cosign.
  const imported = await runFinalizer([
    "verify-backend-import", "--repository-root", root, "--stage", flags.get("--stage"),
    "--backend-input", path.join(root, RUNTIME_CAPTURE_PATH),
    "--backend-attestation-bundle", path.join(root, RUNTIME_ATTESTATION_PATH),
  ]);
  assert.ok(imported.command === "verify-backend-import" && imported.releaseReady === false
    && imported.publicAuthorization === false && imported.publicWrites === false
    && imported.wroteLiveArtifacts === false, "runtime import must remain verification-only");
  assert.equal(imported.backendPromotionPublicInputSha256, sha256Digest(inputBytes), "authenticated runtime capture bytes");
  assert.ok(SHA256.test(imported.captureVerificationDigest), "authenticated runtime capture authorization is required");
  assert.deepEqual(imported.backendSource, structuredClone(input.backendSource), "authenticated runtime source");
  unchanged();
  let backendChecks = 0;
  const result = await runFinalizer(argv, {
    // apply authenticates the original Phase A/Phase B and landed artifacts,
    // and owns the common provider/Sourcify/backend observation instant.
    freshVerifyBackend: async (options) => {
      assert.equal(++backendChecks, 1, "exactly one fresh runtime backend check is required");
      unchanged();
      const fresh = await freshVerifyBackend({ ...options, capturedInput: structuredClone(input) });
      unchanged();
      return fresh;
    },
  });
  assert.equal(backendChecks, 1, "historical apply must perform fresh runtime verification");
  assert.ok(result.command === "apply" && result.releaseReady === true
    && result.publicAuthorization === true && result.publicWrites === true
    && result.wroteLiveArtifacts === false && result.preparedArtifactPreserved === true
    && result.replayed === false && SHA256.test(result.freshBackendReadbackDigest),
  "every historical apply gate must succeed");
  unchanged();
  return {
    ...result,
    runtimeRevalidation: {
      schemaVersion: "programmable.launch-cli-v413-runtime-revalidation.v1",
      inputPath: RUNTIME_CAPTURE_PATH, inputSha256: sha256Digest(inputBytes),
      attestationPath: RUNTIME_ATTESTATION_PATH, attestationSha256: sha256Digest(attestationBytes),
      backendSource: imported.backendSource, captureVerificationDigest: imported.captureVerificationDigest,
      activatesWriteProfile: false,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await verifyRuntimePromotionReadiness(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
