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
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CLOUDFLARE_IMAGE_REF =
  /^registry\.cloudflare\.com\/([0-9a-f]{32})\/openmeld-agent-computer@sha256:[0-9a-f]{64}$/u;

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
    !Number.isFinite(Date.parse(container.updated_at)) ||
    Date.parse(container.updated_at) >= start ||
    !Array.isArray(container.health?.errors) ||
    container.health.errors.length !== 0 ||
    !Number.isInteger(container.instances) ||
    container.instances < 1 ||
    container.health?.instances?.healthy !== container.instances ||
    container.health.instances.failed !== 0 ||
    container.health.instances.starting !== 0
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
  const {
    baseline,
    container,
    images,
    instancesPage,
    workerVersionId,
    imageDigest,
  } = input;
  const image = images.find((item) => item.name === CONTAINER_NAME);
  const health = container?.health?.instances;
  const listed = instancesPage?.instances;
  const page = instancesPage?.result_info;
  const activeInstances = Array.isArray(listed)
    ? listed.filter((instance) => instance.state !== "inactive")
    : [];
  const imagePrefix = baseline.containerImage.split("@")[0];
  if (
    container?.id !== baseline.containerId ||
    container.name !== CONTAINER_NAME ||
    container.version <= baseline.containerVersion ||
    !IMAGE_DIGEST.test(imageDigest) ||
    container.configuration?.image !== `${imagePrefix}@${imageDigest}` ||
    container.active_rollout_id != null ||
    !image?.tags?.includes(workerVersionId.slice(0, 8)) ||
    container.health?.errors?.length ||
    !Array.isArray(listed) ||
    listed.length === 0 ||
    page?.next_page_token !== null ||
    page?.page_token !== null ||
    !Number.isInteger(page?.per_page) ||
    page.per_page < listed.length ||
    health?.healthy !== container.instances ||
    health?.healthy < 1 ||
    health?.failed !== 0 ||
    health?.starting !== 0 ||
    health?.stopped !== 0 ||
    health?.scheduling !== 0 ||
    health?.assigned !== 0 ||
    health?.active !== activeInstances.length ||
    activeInstances.some(
      (instance) =>
        instance.version !== container.version ||
        !["running", "healthy"].includes(instance.state)
    )
  ) {
    throw new Error(
      "The new Remote Agent image has not completed a healthy container rollout."
    );
  }
  return {
    containerVersion: container.version,
    containerImage: container.configuration.image,
    observedAt: new Date().toISOString(),
    activeRolloutId: null,
    healthyInstances: health.healthy,
    activeInstances: health.active,
  };
}

async function readImageDigest(cwd, imageRef, workerVersionId) {
  const match = CLOUDFLARE_IMAGE_REF.exec(imageRef);
  if (!match) {
    throw new Error(
      "The container image is not the expected Cloudflare registry target."
    );
  }
  const serviceDir = path.join(cwd, "services/remote-agent");
  const credentials = JSON.parse(
    run(
      "pnpm",
      [
        "exec",
        "dotenv",
        "-e",
        "../../.env",
        "-o",
        "--",
        "wrangler",
        "containers",
        "registries",
        "credentials",
        "--pull",
        "--json",
      ],
      serviceDir
    )
  );
  if (typeof credentials.password !== "string" || !credentials.password) {
    throw new Error(
      "Cloudflare did not issue a temporary registry pull credential."
    );
  }
  const tag = workerVersionId.slice(0, 8);
  const response = await fetch(
    `https://registry.cloudflare.com/v2/${match[1]}/${CONTAINER_NAME}/manifests/${tag}`,
    {
      method: "HEAD",
      headers: {
        Authorization: `Basic ${Buffer.from(`v1:${credentials.password}`).toString("base64")}`,
        Accept:
          "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Cloudflare registry could not resolve the release image tag: HTTP ${response.status}.`
    );
  }
  const digest = response.headers.get("docker-content-digest");
  if (!IMAGE_DIGEST.test(digest ?? "")) {
    throw new Error(
      "Cloudflare registry did not return an immutable image digest."
    );
  }
  return digest;
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
      const imageDigest = await readImageDigest(
        cwd,
        baseline.containerImage,
        workerVersionId
      );
      const instancesPage = readCloudflare(cwd, [
        "containers",
        "instances",
        baseline.containerId,
        "--per-page",
        "100",
        "--json",
      ]);
      return verifyRecoveredRemoteAgentTarget({
        baseline,
        container: state.container,
        images: state.images,
        instancesPage,
        imageDigest,
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

export async function executeRemoteAgentRecovery(input) {
  try {
    await input.runDeploy();
    const identity = await input.verifyWorker();
    const completed = await input.verifyContainer(identity.versionId);
    await input.verifyWorker(identity);
    input.recovery.completed = completed;
    input.record("verified", "applied", identity);
    return { identity, completed };
  } catch (error) {
    try {
      input.recovery.observedAfterFailure = await input.observeFailure();
    } catch {
      // The canonical failed/unknown receipt remains the release authority.
    }
    input.record("failed", "unknown");
    throw error;
  }
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
      const record = (status, application, identity) => {
        const receipt = {
          ...latest.receipt,
          status,
          application,
          ...(identity ? { identity } : {}),
        };
        return publishGuardedLocalReleaseEvidence({
          cwd: sourceDir,
          sourceSha,
          scopes: [REMOTE_AGENT],
          receipts: { [REMOTE_AGENT]: receipt },
          recoveryProof: {
            [REMOTE_AGENT]: { ...receipt, recovery },
          },
        });
      };
      const capture = createWorkerDeploymentCapture({
        sourceSha,
        operationKey,
        target,
      });
      try {
        const result = await executeRemoteAgentRecovery({
          recovery,
          record,
          runDeploy: () =>
            executeProductionDeploySteps({
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
                  if (
                    JSON.stringify(freshBaseline) !== JSON.stringify(baseline)
                  ) {
                    throw new Error(
                      "Remote Agent state drifted after the recovery lease was acquired."
                    );
                  }
                  capture.recordDeploymentBaseline(state);
                }
                assertCleanSource(sourceDir, sourceSha);
              },
              afterStep: () => assertCleanSource(sourceDir, sourceSha),
            }),
          verifyWorker: (identity) =>
            verifyWorkerDeployment({
              cwd: sourceDir,
              sourceSha,
              target,
              expected: identity ?? capture.read(),
              runCommand: (input) => readWorkerCommand(sourceDir, input),
            }),
          verifyContainer: (workerVersionId) =>
            waitForContainer(sourceDir, baseline, workerVersionId),
          observeFailure: () => {
            const observed = readState(sourceDir, baseline.containerId);
            const active = observed.deployments.toSorted(
              (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
            )[0];
            return {
              workerDeploymentId: active.id,
              workerVersionId: active.versions[0].version_id,
              containerVersion: observed.container.version,
              containerImage: observed.container.configuration.image,
              observedAt: new Date().toISOString(),
            };
          },
        });
        process.stdout.write(
          `Remote Agent recovery verified: Worker ${result.identity.versionId}, container version ${result.completed.containerVersion}.\n`
        );
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
