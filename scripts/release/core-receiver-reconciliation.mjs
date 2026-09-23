#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { coreReceiverReconciliationSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import {
  readCurrentCliProjectionTarget,
  verifyCurrentCliProjectionAlignment,
} from "./deploy-core-current-cli-projection.mjs";
import {
  assertProductionReleaseSource,
  buildCoreReceiverStepSpecs,
  executeWithProductionScopeLeases,
  resolveLocalReleaseOwner,
} from "./production-release.mjs";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import {
  groupReleaseSteps,
  releaseComponentOperationKey,
} from "./production-release-receipts.mjs";
import {
  acquireProductionScopeLease,
  releaseProductionScopeLease,
} from "./production-scope-lease.mjs";
import { readRemoteTagCommit } from "./release-cli-resume.mjs";
import {
  resolveReceiptWorkerTarget,
  verifyWorkerDeployment,
} from "./worker-deployment-evidence.mjs";

// This is an incident-specific reconciliation, not a general deployment adoption API.
export const CORE_RECEIVER_INCIDENT = Object.freeze({
  repository: "amplifthq/openmeld",
  sourceSha: "567c820e470de965b4ba5e3ab303fd02340e5ca8",
  controlSha: "839cc89c80346767e78f6f8c821b2e1913c4b0e7",
  runId: 35_752_925_516,
  runAttempt: 1,
  jobId: 106_834_188_032,
  artifactId: 10_707_029_302,
  artifactSha256:
    "27a24c7c0dfe8528b25684f1dbfd1ef7cf01521dbccb3a861c0dd2a8c1bf6ed0",
  workerName: "openmeld-core-prod",
  deploymentId: "297033ac-2c4f-4e28-807d-70e4145fc965",
  versionId: "b7a853b8-b272-436c-bce9-084645846f3b",
  deployedAt: "2026-09-22T16:32:38.117224Z",
  projectionTag: "openmeld-release-19e5812f18b88a68dfca6d025d151f6cb9a5ac80",
  stableSourceSha: "788eef1284e516788e2fbe2e15c1bebbed03b4b6",
  manifestSha256:
    "8a2e55e57776b6dd7e65c9170732b5da004f40bfcbb726a204b1ab42b89d682b",
  supersededReceiptSha: "7ddda5f4c1650d47f3d963d60bb6048ce40a0aea",
  supersededSourceSha: "e562c8e4392fb7de600a61989dc6f93dd557f3b5",
  supersedingRunId: 35_528_171_693,
});
const INCIDENT = CORE_RECEIVER_INCIDENT;
const REPOSITORY_REMOTE =
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)amplifthq\/openmeld(?:\.git)?$/u;
const WHITESPACE = /\s+/u;
const CORE_ARGS = ["--config", "services/core/wrangler.jsonc", "--env", "prod"];

function requireEvidence(condition, label) {
  if (!condition) {
    throw new Error(
      `Core receiver reconciliation refused: ${label}. No deployment is permitted.`
    );
  }
}

export function assessCoreReceiverProvenance(input) {
  const { run, job, artifact, startup, version, deployments, projection } =
    input;
  const completion = input.supersedingRun;
  requireEvidence(
    completion?.id === INCIDENT.supersedingRunId &&
      completion.run_attempt === 1 &&
      completion.head_sha === INCIDENT.supersededSourceSha &&
      completion.path === ".github/workflows/cli-release.yml" &&
      completion.repository?.full_name === INCIDENT.repository &&
      completion.status === "completed" &&
      completion.conclusion === "success" &&
      completion.event === "workflow_dispatch" &&
      completion.created_at === "2026-09-20T18:09:57Z" &&
      completion.updated_at === "2026-09-20T18:19:11Z",
    "later official completion of the superseded local attempt"
  );
  requireEvidence(
    run.id === INCIDENT.runId &&
      run.run_attempt === 1 &&
      run.head_sha === INCIDENT.controlSha &&
      run.path === ".github/workflows/release-on-main.yml" &&
      run.repository?.full_name === INCIDENT.repository &&
      run.head_branch === "main" &&
      run.event === "workflow_dispatch" &&
      run.status === "completed" &&
      run.conclusion === "failure",
    "original run identity"
  );
  requireEvidence(
    job.id === INCIDENT.jobId &&
      job.run_id === INCIDENT.runId &&
      job.run_attempt === 1 &&
      job.head_sha === INCIDENT.controlSha &&
      job.status === "completed" &&
      job.conclusion === "failure",
    "original job identity"
  );
  for (const name of [
    "Admit declared production train artifacts",
    "Run current-stable Core recovery preflight",
  ]) {
    requireEvidence(
      job.steps?.filter(
        (step) => step.name === name && step.conclusion === "success"
      ).length === 1,
      name
    );
  }
  const receiverSteps = job.steps?.filter(
    (step) =>
      step.name === "Recover Core with the current stable CLI projection"
  );
  requireEvidence(
    receiverSteps?.length === 1 && receiverSteps[0].conclusion === "failure",
    "original receiver step"
  );
  const step = receiverSteps[0];
  const withinStep = (time) =>
    Number.isFinite(Date.parse(time)) &&
    Date.parse(time) >= Date.parse(step.started_at) &&
    Date.parse(time) <= Date.parse(step.completed_at);
  requireEvidence(
    artifact.id === INCIDENT.artifactId &&
      !artifact.expired &&
      artifact.name === `core-startup-evidence-${INCIDENT.sourceSha}` &&
      artifact.workflow_run?.id === INCIDENT.runId &&
      artifact.workflow_run?.head_sha === INCIDENT.controlSha &&
      artifact.digest === `sha256:${INCIDENT.artifactSha256}` &&
      input.archiveSha256 === INCIDENT.artifactSha256,
    "retained startup artifact digest and run"
  );
  requireEvidence(
    startup.schemaVersion === 2 &&
      startup.decision === "accepted" &&
      startup.performanceStatus === "within_target" &&
      startup.releaseSha === INCIDENT.sourceSha &&
      startup.versionId === INCIDENT.versionId &&
      startup.workerName === INCIDENT.workerName &&
      startup.startupTimeMs === 404 &&
      startup.startupTargetMs === 500 &&
      startup.trafficPercent === 0 &&
      withinStep(startup.generatedAt),
    "exact startup admission"
  );
  requireEvidence(
    projection.channelVersion === "0.3.217" &&
      projection.tagName === "v0.3.217" &&
      projection.tagCommitSha === INCIDENT.stableSourceSha &&
      input.remoteTagSha === INCIDENT.stableSourceSha &&
      projection.releaseManifestSha256 === INCIDENT.manifestSha256 &&
      projection.expectedCoreTag === INCIDENT.projectionTag,
    "immutable stable tag and manifest"
  );
  requireEvidence(
    version.id === INCIDENT.versionId &&
      withinStep(version.metadata?.created_on) &&
      version.annotations?.["workers/tag"] === INCIDENT.projectionTag,
    "live Core version and projection"
  );
  requireEvidence(
    Array.isArray(deployments) &&
      deployments.length > 0 &&
      deployments.every(
        (deployment) =>
          typeof deployment.id === "string" &&
          Number.isFinite(Date.parse(deployment.created_on))
      ) &&
      new Set(deployments.map((deployment) => deployment.id)).size ===
        deployments.length,
    "readable deployment history"
  );
  const sorted = deployments.toSorted(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
  );
  const active = sorted[0];
  requireEvidence(
    active.id === INCIDENT.deploymentId &&
      active.created_on === INCIDENT.deployedAt &&
      active.versions?.length === 1 &&
      active.versions[0].version_id === INCIDENT.versionId &&
      active.versions[0].percentage === 100 &&
      sorted.filter(
        (deployment) =>
          Date.parse(deployment.created_on) >= Date.parse(active.created_on)
      ).length === 1 &&
      sorted.filter((deployment) => withinStep(deployment.created_on))
        .length === 1,
    "exact active deployment with no newer or intervening deployment"
  );
  return coreReceiverReconciliationSchema.parse({
    kind: "reconciled-hosted-core-receiver",
    repository: INCIDENT.repository,
    runId: INCIDENT.runId,
    runAttempt: 1,
    jobId: INCIDENT.jobId,
    controlSha: INCIDENT.controlSha,
    deployedAt: INCIDENT.deployedAt,
    supersededReceipt: {
      evidenceSha: INCIDENT.supersededReceiptSha,
      sourceSha: INCIDENT.supersededSourceSha,
      completionRunId: INCIDENT.supersedingRunId,
    },
    startupArtifact: {
      id: INCIDENT.artifactId,
      sha256: INCIDENT.artifactSha256,
      startupTimeMs: 404,
    },
    stableProjection: {
      tagName: "v0.3.217",
      sourceSha: INCIDENT.stableSourceSha,
      manifestSha256: INCIDENT.manifestSha256,
    },
  });
}

// The publisher is the existing append-only evidence writer. Cloudflare is only read.
export async function reconcileCoreReceiverEvidence(input) {
  const reconciliation = assessCoreReceiverProvenance(input.provenance);
  const previous = (await input.readEvidence()).get("core");
  const identity = await input.verifyLive();
  requireEvidence(
    identity.sourceSha === INCIDENT.sourceSha &&
      identity.workerName === INCIDENT.workerName &&
      identity.environment === "prod" &&
      identity.deploymentId === INCIDENT.deploymentId &&
      identity.versionId === INCIDENT.versionId &&
      identity.projectionTag === INCIDENT.projectionTag &&
      identity.proof === "reconciled-hosted",
    "correlated applied identity"
  );
  const alreadyReconciled = previous?.reconciliation;
  if (alreadyReconciled) {
    requireEvidence(
      JSON.stringify(alreadyReconciled) === JSON.stringify(reconciliation) &&
        previous.sha === INCIDENT.sourceSha &&
        previous.receipt?.operationKey === input.operationKey &&
        previous.receipt.application === "applied" &&
        JSON.stringify(previous.receipt.identity) === JSON.stringify(identity),
      "retained reconciliation matches this incident"
    );
  } else {
    requireEvidence(
      previous?.evidenceSha === INCIDENT.supersededReceiptSha &&
        previous.sha === INCIDENT.supersededSourceSha &&
        previous.receipt?.status === "failed" &&
        previous.receipt.application === "unknown" &&
        Date.parse(previous.recordedAt) <
          Date.parse(input.provenance.supersedingRun.created_at),
      "exact superseded historical receipt"
    );
  }
  if (input.verifyOnly) {
    const alignment = await input.verifyAlignment();
    await input.verifyLive();
    return { mode: "verification-only", reconciliation, identity, alignment };
  }
  // A new reconciliation attempt starts NOW; it is never attributed to the old runner.
  const receipt = alreadyReconciled
    ? previous.receipt
    : {
        attemptId: randomUUID(),
        componentIndex: 0,
        operationKey: input.operationKey,
        startedAt: new Date().toISOString(),
        status: "applied",
        application: "applied",
        identity,
      };
  const publish = (status, proof) =>
    input.publishEvidence({
      sourceSha: INCIDENT.sourceSha,
      scopes: ["core"],
      receipts: { core: { ...receipt, status } },
      ...(proof ? { reconciliation: { core: reconciliation } } : {}),
    });
  if (!alreadyReconciled) {
    await publish("applied", true);
  }
  let alignment;
  try {
    alignment = await input.verifyAlignment();
    await input.verifyLive();
  } catch (error) {
    if (receipt.status !== "verified" && receipt.status !== "failed") {
      await publish("failed");
    }
    throw error;
  }
  if (receipt.status !== "verified") {
    await publish("verified");
  }
  return { mode: "reconciled", reconciliation, identity, alignment };
}

function command(cwd, binary, args, options = {}) {
  return execFileSync(binary, args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 24 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

async function readIncidentProvenance(cwd) {
  const api = (route) =>
    JSON.parse(
      command(cwd, "gh", ["api", `repos/${INCIDENT.repository}/${route}`])
    );
  // A rerun changes run_attempt and is deliberately refused rather than blended with attempt 1.
  const run = api(`actions/runs/${INCIDENT.runId}`);
  const supersedingRun = api(`actions/runs/${INCIDENT.supersedingRunId}`);
  const job = api(`actions/jobs/${INCIDENT.jobId}`);
  const artifact = api(`actions/artifacts/${INCIDENT.artifactId}`);
  const archive = command(
    cwd,
    "gh",
    [
      "api",
      `repos/${INCIDENT.repository}/actions/artifacts/${INCIDENT.artifactId}/zip`,
    ],
    { encoding: "buffer" }
  );
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");
  requireEvidence(
    archiveSha256 === INCIDENT.artifactSha256,
    "downloaded artifact checksum"
  );
  const directory = mkdtempSync(
    path.join(tmpdir(), "openmeld-receiver-provenance-")
  );
  let startup;
  try {
    const file = path.join(directory, "startup.zip");
    writeFileSync(file, archive);
    startup = JSON.parse(
      command(cwd, "unzip", ["-p", file, "core-startup-admission.json"])
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const projection = await readCurrentCliProjectionTarget({ cwd });
  const remote = readRemoteTagCommit({ cwd, tagName: "v0.3.217" });
  const deployments = JSON.parse(
    command(cwd, "pnpm", [
      "exec",
      "wrangler",
      "deployments",
      "list",
      ...CORE_ARGS,
      "--json",
    ])
  );
  const version = JSON.parse(
    command(cwd, "pnpm", [
      "exec",
      "wrangler",
      "versions",
      "view",
      INCIDENT.versionId,
      ...CORE_ARGS,
      "--json",
    ])
  );
  return {
    run,
    supersedingRun,
    job,
    artifact,
    archiveSha256,
    startup,
    projection,
    remoteTagSha: remote.remoteTagSha,
    deployments,
    version,
  };
}

export function runCoreReceiverReconciliation(input) {
  const cwd = path.resolve(input.cwd);
  const controlRoot = fileURLToPath(new URL("../../", import.meta.url));
  const sourceCheck = () => {
    requireEvidence(
      command(cwd, "git", ["rev-parse", "HEAD"]).trim() ===
        INCIDENT.sourceSha &&
        command(cwd, "git", ["status", "--porcelain"]).trim() === "",
      "exact clean product source"
    );
    requireEvidence(
      REPOSITORY_REMOTE.test(
        command(cwd, "git", ["remote", "get-url", "origin"]).trim()
      ),
      "production repository"
    );
    assertProductionReleaseSource({ cwd, sourceSha: INCIDENT.sourceSha });
    if (!input.verifyOnly) {
      const head = command(controlRoot, "git", ["rev-parse", "HEAD"]).trim();
      const remoteMain = command(controlRoot, "git", [
        "ls-remote",
        "origin",
        "refs/heads/main",
      ])
        .trim()
        .split(WHITESPACE)[0];
      requireEvidence(
        head === remoteMain &&
          !command(controlRoot, "git", ["status", "--porcelain"]).trim(),
        "clean current-main trusted control"
      );
    }
  };
  sourceCheck();
  const execute = async () => {
    sourceCheck();
    const provenance = await readIncidentProvenance(cwd);
    assessCoreReceiverProvenance(provenance);
    const group = groupReleaseSteps(
      buildCoreReceiverStepSpecs(INCIDENT.sourceSha)
    )[0];
    const target = await resolveReceiptWorkerTarget({ cwd, group });
    requireEvidence(
      target.workerName === INCIDENT.workerName &&
        target.projectionTag === INCIDENT.projectionTag,
      "receipt target"
    );
    const operationKey = releaseComponentOperationKey({
      sourceSha: INCIDENT.sourceSha,
      group,
      target,
    });
    const runCommand = ({ command: binary, args }) => ({
      status: 0,
      stdout: command(cwd, binary, args),
      stderr: "",
    });
    return reconcileCoreReceiverEvidence({
      provenance,
      operationKey,
      verifyOnly: input.verifyOnly,
      readEvidence: () => readGuardedLocalReleaseSources({ cwd }),
      publishEvidence: (event) => {
        sourceCheck();
        return publishGuardedLocalReleaseEvidence({ cwd, ...event });
      },
      verifyLive: () => {
        sourceCheck();
        // Recheck the projection as well as exact activation immediately around receipt writes.
        const version = JSON.parse(
          command(cwd, "pnpm", [
            "exec",
            "wrangler",
            "versions",
            "view",
            INCIDENT.versionId,
            ...CORE_ARGS,
            "--json",
          ])
        );
        requireEvidence(
          version.annotations?.["workers/tag"] === INCIDENT.projectionTag,
          "active projection"
        );
        return verifyWorkerDeployment({
          cwd,
          sourceSha: INCIDENT.sourceSha,
          target,
          runCommand,
          expected: {
            deploymentId: INCIDENT.deploymentId,
            versionId: INCIDENT.versionId,
            proof: "reconciled-hosted",
          },
        });
      },
      verifyAlignment: () =>
        verifyCurrentCliProjectionAlignment({
          cwd,
          env: process.env,
          ...provenance.projection,
        }),
    });
  };
  return input.verifyOnly
    ? execute()
    : executeWithProductionScopeLeases({
        sourceSha: INCIDENT.sourceSha,
        scopes: ["core"],
        owner: resolveLocalReleaseOwner(),
        execute,
        adapters: {
          acquireProductionScopeLease: (options) =>
            acquireProductionScopeLease({ cwd, ...options }),
          releaseProductionScopeLease: (options) =>
            releaseProductionScopeLease({ cwd, ...options }),
        },
      });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (
    args[0] !== "--release-source" ||
    !args[1] ||
    args.length > 3 ||
    (args[2] && args[2] !== "--verify-only")
  ) {
    throw new Error(
      "Usage: core-receiver-reconciliation.mjs --release-source <exact-product-checkout> [--verify-only]"
    );
  }
  runCoreReceiverReconciliation({
    cwd: args[1],
    verifyOnly: args[2] === "--verify-only",
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
