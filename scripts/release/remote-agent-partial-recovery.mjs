#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { productionReleaseEvidenceSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import {
  assertProductionReleaseSource,
  buildProductionDeployStepSpecs,
  executeProductionDeploySteps,
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
  createWorkerDeploymentCapture,
  resolveReceiptWorkerTarget,
  verifyWorkerDeployment,
} from "./worker-deployment-evidence.mjs";

const EXACT_SHA = /^[0-9a-f]{40}$/u;
const REMOTE_AGENT = "remote-agent";
const WORKER_NAME = "openmeld-remote-agent-prod";
const CONTAINER_NAME = "openmeld-agent-computer";
const ROLLOUT_TIMEOUT_MS = 10 * 60 * 1000;

export function assessRemoteAgentPartialRecovery(input) {
  const { current, started, deployments, container, images } = input;
  const receipt = current?.receipt;
  const startedReceipt = started?.receipt;
  if (
    current?.sha !== input.sourceSha ||
    receipt?.attemptId !== input.attemptId ||
    receipt?.operationKey !== input.operationKey ||
    receipt?.status !== "failed" ||
    receipt?.application !== "unknown" ||
    receipt?.identity ||
    started?.sourceSha !== input.sourceSha ||
    startedReceipt?.status !== "started" ||
    startedReceipt?.application !== "unknown" ||
    startedReceipt?.attemptId !== receipt.attemptId ||
    startedReceipt?.operationKey !== receipt.operationKey ||
    startedReceipt?.startedAt !== receipt.startedAt
  ) {
    throw new Error(
      "The exact failed Remote Agent attempt and start event are not intact."
    );
  }
  const start = Date.parse(receipt.startedAt);
  const end = Date.parse(current.recordedAt);
  if (!(Number.isFinite(start) && Number.isFinite(end)) || end <= start) {
    throw new Error("The retained attempt has no bounded deployment window.");
  }
  const during = deployments.filter((deployment) => {
    const time = Date.parse(deployment.created_on);
    return Number.isFinite(time) && time >= start && time <= end;
  });
  const active = deployments.toSorted(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
  )[0];
  if (
    during.length !== 1 ||
    !active ||
    active.id !== during[0].id ||
    active.id !== input.expectedDeploymentId ||
    active.versions?.length !== 1 ||
    active.versions[0].percentage !== 100 ||
    active.versions[0].version_id !== input.expectedWorkerVersionId
  ) {
    throw new Error(
      "Cloudflare does not show one exact active Worker deployment inside the attempt window."
    );
  }
  const preceding = deployments.filter(
    (deployment) => Date.parse(deployment.created_on) < start
  );
  if (
    preceding.length === 0 ||
    preceding.toSorted(
      (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
    )[0].versions?.[0]?.version_id === active.versions[0].version_id
  ) {
    throw new Error(
      "The preceding Worker deployment is missing or indistinguishable."
    );
  }
  if (
    container?.id !== input.expectedContainerId ||
    container?.name !== CONTAINER_NAME ||
    container.version !== input.expectedContainerVersion ||
    container.configuration?.image !== input.expectedContainerImage ||
    Date.parse(container.updated_at) >= start ||
    container.health?.errors?.length ||
    container.health?.instances?.healthy < 1
  ) {
    throw new Error(
      "The live container no longer matches the pre-attempt target."
    );
  }
  const image = images.find((item) => item.name === CONTAINER_NAME);
  if (
    !image ||
    image.tags.includes(active.versions[0].version_id.slice(0, 8))
  ) {
    throw new Error(
      "The failed attempt's container image may already exist; inspect its rollout before recovery."
    );
  }
  return {
    workerDeploymentId: active.id,
    workerVersionId: active.versions[0].version_id,
    containerId: container.id,
    containerVersion: container.version,
    containerImage: container.configuration.image,
  };
}

export function verifyRecoveredRemoteAgentTarget(input) {
  const { baseline, container, images, instances, workerVersionId } = input;
  const image = images.find((item) => item.name === CONTAINER_NAME);
  if (
    container?.id !== baseline.containerId ||
    container.name !== CONTAINER_NAME ||
    container.version <= baseline.containerVersion ||
    container.configuration?.image === baseline.containerImage ||
    !image?.tags?.includes(workerVersionId.slice(0, 8)) ||
    container.health?.errors?.length ||
    !Array.isArray(instances) ||
    container.health?.instances?.healthy < 1 ||
    container.health?.instances?.failed !== 0 ||
    container.health?.instances?.starting !== 0 ||
    instances.some(
      (instance) =>
        instance.state !== "inactive" &&
        (instance.version !== container.version ||
          !["running", "healthy"].includes(instance.state))
    )
  ) {
    throw new Error(
      "The new Remote Agent image has not completed a healthy container rollout."
    );
  }
  return {
    containerVersion: container.version,
    containerImage: container.configuration.image,
  };
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout ?? 60_000,
    ...(options.inherit ? { stdio: "inherit" } : {}),
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args[0] ?? ""} failed: ${String(result.error?.message ?? result.stderr ?? result.status).trim()}`
    );
  }
  return String(result.stdout ?? "").trim();
}

function readCloudflare(cwd, args) {
  const serviceDir = path.join(cwd, "services/remote-agent");
  const output = run(
    "pnpm",
    ["exec", "dotenv", "-e", "../../.env", "-o", "--", "wrangler", ...args],
    serviceDir
  );
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Cloudflare ${args[0]} returned malformed JSON.`);
  }
}

function readWorkerCommand(cwd, input) {
  if (
    input.command !== "pnpm" ||
    input.args[0] !== "exec" ||
    input.args[1] !== "wrangler"
  ) {
    throw new Error(
      "Recovery identity reader only accepts the existing Wrangler deployment query."
    );
  }
  const serviceDir = path.join(cwd, "services/remote-agent");
  const wranglerArgs = input.args
    .slice(2)
    .map((arg) =>
      arg.startsWith("services/remote-agent/")
        ? arg.slice("services/remote-agent/".length)
        : arg
    );
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "dotenv",
      "-e",
      "../../.env",
      "-o",
      "--",
      "wrangler",
      ...wranglerArgs,
    ],
    {
      cwd: serviceDir,
      env: input.env,
      encoding: "utf8",
      timeout: 60_000,
    }
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function readState(cwd, containerId) {
  return {
    deployments: readCloudflare(cwd, [
      "deployments",
      "list",
      "--config",
      "wrangler.jsonc",
      "--env",
      "prod",
      "--name",
      WORKER_NAME,
      "--json",
    ]),
    container: readCloudflare(cwd, ["containers", "info", containerId]),
    images: readCloudflare(cwd, [
      "containers",
      "images",
      "list",
      "--filter",
      CONTAINER_NAME,
      "--json",
    ]),
  };
}

function readStartedEvidence(cwd, evidenceSha) {
  const parent = run("git", ["rev-parse", `${evidenceSha}^`], cwd);
  const message = run("git", ["show", "-s", "--format=%B", parent], cwd);
  return productionReleaseEvidenceSchema.parse(JSON.parse(message));
}

function assertCleanSource(cwd, expectedSha) {
  if (
    run("git", ["rev-parse", "HEAD"], cwd) !== expectedSha ||
    run("git", ["status", "--porcelain"], cwd)
  ) {
    throw new Error(
      "Recovery source must be the exact clean release checkout."
    );
  }
}

async function waitForContainer(cwd, baseline, workerVersionId) {
  const deadline = Date.now() + ROLLOUT_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const state = readState(cwd, baseline.containerId);
      const instances = readCloudflare(cwd, [
        "containers",
        "instances",
        baseline.containerId,
        "--json",
      ]);
      return verifyRecoveredRemoteAgentTarget({
        baseline,
        container: state.container,
        images: state.images,
        instances,
        workerVersionId,
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  throw new Error(
    `Container rollout did not complete: ${lastError?.message ?? "unknown state"}`
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (
      !(
        [
          "--source-dir",
          "--source-sha",
          "--attempt",
          "--expected-deployment",
          "--expected-worker-version",
          "--container-id",
          "--container-version",
          "--container-image",
        ].includes(key) && argv[index + 1]
      ) ||
      options[key]
    ) {
      throw new Error(
        `Invalid Remote Agent recovery option: ${key ?? "missing"}`
      );
    }
    options[key] = argv[index + 1];
  }
  if (
    Object.keys(options).length !== 8 ||
    !EXACT_SHA.test(options["--source-sha"])
  ) {
    throw new Error(
      "Remote Agent recovery requires the exact source, attempt, Worker and container selectors."
    );
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const controlDir = process.cwd();
  const sourceDir = path.resolve(options["--source-dir"]);
  run(
    "git",
    [
      "fetch",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ],
    controlDir
  );
  if (
    run("git", ["rev-parse", "HEAD"], controlDir) !==
      run("git", ["rev-parse", "origin/main"], controlDir) ||
    run("git", ["status", "--porcelain"], controlDir)
  ) {
    throw new Error(
      "Recovery control must be the current clean main checkout."
    );
  }
  const sourceSha = options["--source-sha"];
  assertCleanSource(sourceDir, sourceSha);
  run(
    "git",
    [
      "fetch",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ],
    sourceDir
  );
  assertProductionReleaseSource({ cwd: sourceDir, sourceSha });
  run(
    "pnpm",
    [
      "run",
      "release:preflight:local",
      "--",
      "--scope",
      REMOTE_AGENT,
      "--base",
      "99bd94a254457683a4922452b05bc80e175d50ac",
    ],
    sourceDir,
    { inherit: true, timeout: 20 * 60_000 }
  );
  const steps = buildProductionDeployStepSpecs([REMOTE_AGENT]);
  const [group] = groupReleaseSteps(steps);
  const target = await resolveReceiptWorkerTarget({ cwd: sourceDir, group });
  const operationKey = releaseComponentOperationKey({
    sourceSha,
    group,
    target,
  });
  process.chdir(sourceDir);
  await executeWithProductionScopeLeases({
    owner: resolveLocalReleaseOwner(),
    scopes: [REMOTE_AGENT],
    sourceSha,
    execute: async () => {
      const latest = readGuardedLocalReleaseSources({ cwd: sourceDir }).get(
        REMOTE_AGENT
      );
      const started = readStartedEvidence(sourceDir, latest.evidenceSha);
      const original = readState(sourceDir, options["--container-id"]);
      const baseline = assessRemoteAgentPartialRecovery({
        current: latest,
        started,
        ...original,
        sourceSha,
        attemptId: options["--attempt"],
        operationKey,
        expectedDeploymentId: options["--expected-deployment"],
        expectedWorkerVersionId: options["--expected-worker-version"],
        expectedContainerId: options["--container-id"],
        expectedContainerVersion: Number(options["--container-version"]),
        expectedContainerImage: options["--container-image"],
      });
      const recovery = {
        id: randomUUID(),
        originalEvidenceSha: latest.evidenceSha,
        startedAt: new Date().toISOString(),
        baseline,
      };
      const record = (status, application, identity) =>
        publishGuardedLocalReleaseEvidence({
          cwd: sourceDir,
          sourceSha,
          scopes: [REMOTE_AGENT],
          receipts: {
            [REMOTE_AGENT]: {
              ...latest.receipt,
              status,
              application,
              ...(identity ? { identity } : {}),
              recovery,
            },
          },
        });
      const capture = createWorkerDeploymentCapture({
        sourceSha,
        operationKey,
        target,
      });
      let startedRecorded = false;
      let appliedIdentity;
      try {
        record("started", "unknown");
        startedRecorded = true;
        await executeProductionDeploySteps({
          cwd: sourceDir,
          env: capture.env,
          steps: steps.slice(0, 1),
          adapters: {
            runCommand: (input) => readWorkerCommand(sourceDir, input),
          },
          beforeStep: (_step, state) => {
            if (state) {
              const fresh = readState(sourceDir, baseline.containerId);
              const freshBaseline = assessRemoteAgentPartialRecovery({
                current: latest,
                started,
                ...fresh,
                sourceSha,
                attemptId: options["--attempt"],
                operationKey,
                expectedDeploymentId: baseline.workerDeploymentId,
                expectedWorkerVersionId: baseline.workerVersionId,
                expectedContainerId: baseline.containerId,
                expectedContainerVersion: baseline.containerVersion,
                expectedContainerImage: baseline.containerImage,
              });
              if (JSON.stringify(freshBaseline) !== JSON.stringify(baseline)) {
                throw new Error(
                  "Remote Agent state drifted after the recovery lease was acquired."
                );
              }
              capture.recordDeploymentBaseline(state);
            }
            assertCleanSource(sourceDir, sourceSha);
          },
          afterStep: () => assertCleanSource(sourceDir, sourceSha),
        });
        const identity = await verifyWorkerDeployment({
          cwd: sourceDir,
          sourceSha,
          target,
          expected: capture.read(),
          runCommand: (input) => readWorkerCommand(sourceDir, input),
        });
        recovery.completed = await waitForContainer(
          sourceDir,
          baseline,
          identity.versionId
        );
        await verifyWorkerDeployment({
          cwd: sourceDir,
          sourceSha,
          target,
          expected: {
            versionId: identity.versionId,
            deploymentId: identity.deploymentId,
            proof: identity.proof,
          },
          runCommand: (input) => readWorkerCommand(sourceDir, input),
        });
        appliedIdentity = identity;
        record("applied", "applied", identity);
        record("verified", "applied", identity);
        process.stdout.write(
          `Remote Agent recovery verified: Worker ${identity.versionId}, container version ${recovery.completed.containerVersion}.\n`
        );
      } catch (error) {
        if (startedRecorded) {
          try {
            const observed = readState(sourceDir, baseline.containerId);
            const active = observed.deployments.toSorted(
              (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
            )[0];
            recovery.observedAfterFailure = {
              workerDeploymentId: active.id,
              workerVersionId: active.versions[0].version_id,
              containerVersion: observed.container.version,
              containerImage: observed.container.configuration.image,
              observedAt: new Date().toISOString(),
            };
          } catch {
            // Cloudflare observation can be unavailable during the failure.
          }
          record(
            "failed",
            appliedIdentity ? "applied" : "unknown",
            appliedIdentity
          );
        }
        throw error;
      } finally {
        capture.close();
      }
    },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[remote-agent-partial-recovery] ${error.message}\n`);
    process.exitCode = 1;
  });
}
