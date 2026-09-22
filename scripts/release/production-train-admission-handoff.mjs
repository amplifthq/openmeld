#!/usr/bin/env node

// biome-ignore-all lint/suspicious/noMisplacedAssertion: This manually dispatched acceptance script uses Node assertions without a unit test runner.
// Read-only Deep Confidence acceptance, never a Production admission authority.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  artifactOutputIdentity,
  assertArtifactCheckout,
  checkProductionArtifact,
} from "./production-artifact-check.mjs";
import {
  admissionSha256,
  PARENT_ADMISSION_ENV,
  parseAdmissionEvidence,
  verifyParentAdmission,
} from "./production-train-admission-evidence.mjs";
import {
  admitProductionTrainArtifacts,
  PRODUCTION_TRAIN_SCOPES_ENV,
  resolveProductionTrain,
} from "./production-train-artifact-admission.mjs";

const CONTROL_ROOT = path.resolve(import.meta.dirname, "../..");
const WRONG_SOURCE = /sourceSha does not match/u;
const WRONG_BYTES = /inputs or bytes do not match/u;
const WRONG_RECEIPT = /receipt hash does not match/u;
const UNTRUSTED_WORKFLOW = /trusted main release-on-main control/u;

const git = (root, ...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

// The diagnostic adapter changes only the allowed caller identity. It uses
// actual GitHub context, never impersonates release-on-main, and its receipts
// must be rejected by the unmodified Production verifier.
async function diagnosticIdentity(input) {
  const env = input.env;
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    `${env.GITHUB_REPOSITORY}/.github/workflows/deep-confidence.yml@${env.GITHUB_REF}`
  );
  assert.equal(env.GITHUB_SHA, git(CONTROL_ROOT, "rev-parse", "HEAD"));
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA);
  assert.equal(input.sourceSha, env.GITHUB_SHA);
  assertArtifactCheckout(input.root, input.sourceSha);
  return {
    producer: {
      repository: env.GITHUB_REPOSITORY,
      workflowRef: env.GITHUB_WORKFLOW_REF,
      controlSha: env.GITHUB_SHA,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      job: "validate_release_source",
    },
    buildInputs: {
      treeSha: git(input.root, "rev-parse", "HEAD^{tree}"),
      lockSha256: admissionSha256(
        await readFile(path.join(input.root, "pnpm-lock.yaml"))
      ),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

async function issue(input) {
  assert.equal(input.env.GITHUB_JOB, "validate_release_source");
  assert.equal(
    existsSync(path.join(input.root, "dev-tmp/release-artifact-check")),
    false
  );
  let heavyAdmissions = 0;
  const result = await admitProductionTrainArtifacts(
    { ...input, issueParentEvidence: true },
    {
      readAdmissionIdentity: diagnosticIdentity,
      checkArtifact: async (request) => {
        heavyAdmissions += 1;
        const artifact = await checkProductionArtifact(request);
        assert.notEqual(
          artifact.reused,
          true,
          "Parent must build a fresh real artifact"
        );
        return artifact;
      },
    }
  );
  assert.equal(heavyAdmissions, 1);
  await appendFile(
    input.env.GITHUB_OUTPUT,
    `parent_admission_evidence=${JSON.stringify(result.parentEvidence)}\n`
  );
  return { heavyAdmissions, evidence: result.parentEvidence };
}

async function verify(input) {
  assert.equal(input.env.GITHUB_JOB, "verify_web_admission");
  assert.equal(
    existsSync(path.join(input.root, "clients/web/dist")),
    false,
    "The receiving runner must start without live Web output"
  );
  assert.equal(
    existsSync(path.join(input.root, "clients/web/.wrangler/deploy")),
    false
  );
  const dependencies = {
    readAdmissionIdentity: diagnosticIdentity,
    checkArtifact: () => assert.fail("Child entered heavy train admission"),
    checkNpmArtifact: () => assert.fail("Child entered npm admission"),
  };
  const evidence = parseAdmissionEvidence(input.env[PARENT_ADMISSION_ENV]);
  const expected = evidence.artifacts.find(({ scope }) => scope === "web");
  const verified = await admitProductionTrainArtifacts(input, dependencies);
  assert.equal(verified.parentEvidenceVerified, true);
  await admitProductionTrainArtifacts(
    { ...input, restoreWebArtifact: true },
    dependencies
  );

  // Repeat the actual artifact preflight with no mocked build/SSR implementation.
  const preflight = await checkProductionArtifact({
    root: input.root,
    scope: "web",
    sourceSha: input.sourceSha,
  });
  assert.equal(
    preflight.reused,
    true,
    "Child preflight rebuilt instead of reusing"
  );
  assert.equal(preflight.inputIdentity, expected.inputIdentity);
  assert.equal(preflight.artifactSha256, expected.artifactSha256);

  await assert.rejects(
    verifyParentAdmission(input, resolveProductionTrain(input)),
    UNTRUSTED_WORKFLOW
  );
  await assert.rejects(
    admitProductionTrainArtifacts(
      {
        ...input,
        env: {
          ...input.env,
          [PARENT_ADMISSION_ENV]: JSON.stringify({
            ...evidence,
            sourceSha: "0".repeat(40),
          }),
        },
      },
      dependencies
    ),
    WRONG_SOURCE
  );

  const directory = path.join(input.root, "dev-tmp/release-artifact-check");
  for (const [filename, failure] of [
    [path.join(directory, "web.json"), WRONG_RECEIPT],
    [
      path.join(
        directory,
        "artifacts/web",
        expected.inputIdentity,
        "deploy/config.json"
      ),
      WRONG_BYTES,
    ],
  ]) {
    const original = await readFile(filename);
    try {
      await appendFile(filename, "\ncorrupt-handoff");
      await assert.rejects(
        admitProductionTrainArtifacts(
          {
            ...input,
            restoreWebArtifact: true,
          },
          dependencies
        ),
        failure
      );
    } finally {
      await writeFile(filename, original);
    }
  }
  assert.equal(
    await artifactOutputIdentity(path.join(input.root, "clients/web")),
    expected.artifactSha256
  );
  return {
    heavyAdmissions: 0,
    preflightReused: preflight.reused,
    artifactSha256: expected.artifactSha256,
    inputIdentity: expected.inputIdentity,
    rejected: [
      "diagnostic-proof-in-production",
      "wrong-source",
      "corrupt-receipt",
      "corrupt-snapshot",
    ],
    evidence,
  };
}

try {
  const mode = process.argv[2];
  assert.ok(mode === "issue" || mode === "verify", "Choose issue or verify");
  const input = {
    root: process.cwd(),
    sourceSha: process.env.GITHUB_SHA,
    selectedScopes: "web",
    env: { ...process.env, [PRODUCTION_TRAIN_SCOPES_ENV]: "web" },
  };
  const startedAt = new Date().toISOString();
  const result = await (mode === "issue" ? issue(input) : verify(input));
  const report = {
    kind: "diagnostic-artifact-handoff",
    mode,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceSha: input.sourceSha,
    job: input.env.GITHUB_JOB,
    artifactId: input.env.OPENMELD_PARENT_WEB_ARTIFACT_ID ?? null,
    ...result,
  };
  const reportDir = path.join(input.root, "dev-tmp/release-artifact-handoff");
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    path.join(reportDir, `${mode}.json`),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
