import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { productionTrainAdmissionSchema } from "../../packages/schemas/src/schemas/release/production-train-admission.ts";
import {
  artifactInputIdentity,
  assertArtifactCheckout,
  restoreArtifactSnapshot,
} from "./production-artifact-check.mjs";

export const PARENT_ADMISSION_ENV = "OPENMELD_PARENT_TRAIN_ADMISSION";
const CONTROL_ROOT = path.resolve(import.meta.dirname, "../..");

export function admissionSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function isCoordinatedRelease(env) {
  return (
    env.GITHUB_WORKFLOW_REF ===
    `${env.GITHUB_REPOSITORY}/.github/workflows/release-on-main.yml@refs/heads/main`
  );
}

export async function admissionIdentity(input) {
  const env = input.env;
  if (
    !isCoordinatedRelease(env) ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_SHA !== git(CONTROL_ROOT, "rev-parse", "HEAD") ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA
  ) {
    throw new Error(
      "Parent admission requires trusted main release-on-main control."
    );
  }
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

export function parseAdmissionEvidence(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Parent admission evidence is missing or malformed.");
  }
  const result = productionTrainAdmissionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid parent admission evidence: ${result.error.message}`
    );
  }
  return result.data;
}

export async function verifyParentAdmission(input, train, dependencies = {}) {
  const evidence = parseAdmissionEvidence(input.env[PARENT_ADMISSION_ENV]);
  const identity = await (
    dependencies.readAdmissionIdentity ?? admissionIdentity
  )(input);
  for (const [key, expected] of Object.entries({
    sourceSha: train.sourceSha,
    scopes: train.scopes,
    ...identity,
  })) {
    if (!isDeepStrictEqual(evidence[key], expected)) {
      throw new Error(`Parent admission ${key} does not match this release.`);
    }
  }
  const declaredArtifactScopes = ["cli", "desktop", "web", "website"].filter(
    (scope) => train.scopes.includes(scope)
  );
  if (
    evidence.artifactScopes.some(
      (scope) => !declaredArtifactScopes.includes(scope)
    ) ||
    train.artifactScopes.some(
      (scope) => !evidence.artifactScopes.includes(scope)
    ) ||
    !isDeepStrictEqual(
      evidence.artifacts.map(({ scope }) => scope),
      evidence.artifactScopes
    )
  ) {
    throw new Error("Parent admission artifacts do not cover this stage.");
  }
  return evidence;
}

// Each renderer consumes only its admitted bytes. Never rebuild on failure.
export async function restoreParentRendererArtifact(input, evidence, scope) {
  const expected = evidence.artifacts.find((entry) => entry.scope === scope);
  const receiptPath = path.join(
    input.root,
    `dev-tmp/release-artifact-check/${scope}.json`
  );
  const bytes = await readFile(receiptPath);
  if (!expected || admissionSha256(bytes) !== expected.receiptSha256) {
    throw new Error(
      `Parent ${scope} artifact receipt hash does not match admission.`
    );
  }
  const receipt = JSON.parse(bytes);
  const identity = await artifactInputIdentity(
    input.root,
    scope,
    input.sourceSha,
    input.env
  );
  if (
    receipt.sourceSha !== input.sourceSha ||
    receipt.scope !== scope ||
    receipt.allowDirty !== false ||
    receipt.runtime !== expected.runtime ||
    receipt.inputIdentity !== identity ||
    identity !== expected.inputIdentity ||
    receipt.artifactSha256 !== expected.artifactSha256 ||
    !(await restoreArtifactSnapshot({
      receiptPath,
      webRoot: path.join(input.root, `clients/${scope}`),
      scope,
      identity,
      artifactSha256: expected.artifactSha256,
    }))
  ) {
    throw new Error(
      `Parent ${scope} artifact inputs or bytes do not match admission.`
    );
  }
}
