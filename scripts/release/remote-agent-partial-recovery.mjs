#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { productionReleaseEvidenceSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import {
  assertProductionReleaseSource,
  buildProductionDeployStepSpecs,
  buildProductionReleasePlan,
  executeProductionDeploySteps,
  executeWithProductionScopeLeases,
  resolveLocalReleaseOwner,
  runProductionPreflightSteps,
} from "./production-release.mjs";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import {
  completeRemoteAgentReceipt,
  groupReleaseSteps,
  releaseComponentOperationKey,
  resumeRemoteAgentVerification,
} from "./production-release-receipts.mjs";
import { runProductionStageAdmission } from "./production-stage-admission.mjs";
import {
  describeRemoteContainerConfiguration,
  describeRetainedContainer,
} from "./remote-agent-container-evidence.mjs";
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
const MAX_RECOVERY_HISTORY_EVENTS = 32;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CLOUDFLARE_IMAGE_REF =
  /^registry\.cloudflare\.com\/([0-9a-f]{32})\/openmeld-agent-computer@sha256:[0-9a-f]{64}$/u;

function assertFailedRecoveryAttempt(input) {
  const { current, started } = input;
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
    startedReceipt?.componentIndex !== receipt.componentIndex ||
    startedReceipt?.startedAt !== receipt.startedAt
  ) {
    throw new Error(
      "The exact failed Remote Agent attempt and start event are not intact."
    );
  }
}

function readRecoveryWindow({ current, recovery }) {
  const receipt = current.receipt;
  const start = Date.parse(recovery?.startedAt ?? receipt.startedAt);
  const end = Date.parse(
    recovery?.observedAfterFailure?.observedAt ?? current.recordedAt
  );
  if (!(Number.isFinite(start) && Number.isFinite(end)) || end <= start) {
    throw new Error("The retained attempt has no bounded deployment window.");
  }
  return { start, end };
}

function assessRecoveryWorker(input) {
  const { recovery, deployments } = input;
  if (
    !Array.isArray(deployments) ||
    deployments.some(
      (deployment) => !Number.isFinite(Date.parse(deployment.created_on))
    )
  ) {
    throw new Error(
      "Recovery requires a fully timestamped deployment history."
    );
  }
  const { start, end } = readRecoveryWindow(input);
  const during = deployments.filter((deployment) => {
    const time = Date.parse(deployment.created_on);
    return Number.isFinite(time) && time >= start && time <= end;
  });
  const active = deployments.toSorted(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
  )[0];
  const unchangedRecovery = isUnchangedRecoveryWorker(recovery, active);
  const unchangedWindow = input.beforeUpload || unchangedRecovery;
  if (
    (unchangedWindow
      ? during.length !== 0 || Date.parse(active?.created_on) >= start
      : during.length !== 1 || active?.id !== during[0].id) ||
    !active ||
    !Number.isFinite(Date.parse(active.created_on)) ||
    active.id !== input.expectedDeploymentId ||
    active.versions?.length !== 1 ||
    active.versions[0].percentage !== 100 ||
    active.versions[0].version_id !== input.expectedWorkerVersionId
  ) {
    throw new Error(
      "Cloudflare does not show the exact active Worker for the selected recovery window."
    );
  }
  if (recovery) {
    assertRecoveryObservation(input, active);
  }
  const preceding = deployments
    .filter((deployment) => Date.parse(deployment.created_on) < start)
    .toSorted((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  if (
    !preceding ||
    (unchangedWindow
      ? preceding.id !== active.id
      : preceding.versions?.[0]?.version_id ===
        active.versions[0].version_id) ||
    (recovery &&
      (preceding.id !== recovery.baseline.workerDeploymentId ||
        preceding.versions?.length !== 1 ||
        preceding.versions[0].percentage !== 100 ||
        preceding.versions[0].version_id !== recovery.baseline.workerVersionId))
  ) {
    throw new Error(
      "The preceding Worker deployment is missing or indistinguishable."
    );
  }
  return { active, unchangedRecovery };
}

function isUnchangedRecoveryWorker(recovery, active) {
  return Boolean(
    recovery?.observedContainer &&
      active &&
      recovery.baseline.workerDeploymentId === active.id &&
      recovery.baseline.workerVersionId === active.versions?.[0]?.version_id &&
      recovery.observedAfterFailure?.workerDeploymentId === active.id &&
      recovery.observedAfterFailure?.workerVersionId ===
        active.versions?.[0]?.version_id
  );
}

export function assessRemoteAgentPartialRecovery(input) {
  assertFailedRecoveryAttempt(input);
  const { active, unchangedRecovery } = assessRecoveryWorker(input);
  const { container, images } = input;
  assertRecoveryContainer(input);
  const image = images.find((item) => item.name === CONTAINER_NAME);
  if (
    !image ||
    (!(input.beforeUpload || unchangedRecovery) &&
      image.tags.includes(active.versions[0].version_id.slice(0, 8)))
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

function assertRecoveryContainer(input) {
  const {
    container,
    current: { receipt },
  } = input;
  if (
    container?.id !== input.expectedContainerId ||
    container?.name !== CONTAINER_NAME ||
    container.version !== input.expectedContainerVersion ||
    container.configuration?.image !== input.expectedContainerImage ||
    !Number.isFinite(Date.parse(container.updated_at)) ||
    Date.parse(container.updated_at) >=
      Date.parse(
        hasAdvancedNativeObservation(input.recovery)
          ? input.recovery.observedAfterFailure.observedAt
          : receipt.startedAt
      ) ||
    container.active_rollout_id != null ||
    !Array.isArray(container.health?.errors) ||
    container.health.errors.length !== 0 ||
    !Number.isInteger(container.instances) ||
    container.instances < 1 ||
    container.health?.instances?.healthy +
      container.health?.instances?.active !==
      container.instances ||
    container.health.instances.failed !== 0 ||
    container.health.instances.starting !== 0
  ) {
    throw new Error(
      "The live container no longer matches the pre-attempt target."
    );
  }
  if (input.beforeUpload || input.recovery?.observedContainer) {
    describeRetainedContainer(container, input.instancesPage);
    const page = input.instancesPage;
    const activeInstances = page.instances.filter(
      (instance) => instance.state !== "inactive"
    );
    if (
      !Number.isInteger(page.result_info?.per_page) ||
      page.result_info.per_page < page.instances.length ||
      container.health.instances.active !== activeInstances.length ||
      ["stopped", "scheduling", "assigned"].some(
        (state) => container.health.instances[state] !== 0
      )
    ) {
      throw new Error(
        "Pre-upload recovery requires complete healthy Container counts."
      );
    }
  }
}

function assertRecoveryObservation(input, active) {
  const { recovery, container } = input;
  const observed = recovery.observedAfterFailure;
  const expected =
    recovery.observedContainer ??
    input.current.receipt.remoteAgent?.container ??
    recovery.nativeProvenance?.container;
  const { instances: expectedInstances, ...expectedConfiguration } =
    expected ?? {};
  const retained = describeRetainedContainer(container, input.instancesPage);
  const advanced = hasAdvancedNativeObservation(recovery);
  if (
    observed?.workerDeploymentId !== active.id ||
    observed.workerVersionId !== active.versions[0].version_id ||
    recovery.baseline.containerId !== input.expectedContainerId ||
    observed.containerVersion !== input.expectedContainerVersion ||
    observed.containerImage !== input.expectedContainerImage ||
    !expected ||
    !(
      advanced ||
      isDeepStrictEqual(
        describeRemoteContainerConfiguration(container),
        expectedConfiguration
      )
    ) ||
    (!advanced &&
      expectedInstances?.some(
        (instance) =>
          !retained.instances.some(
            (live) =>
              live.id === instance.id && live.version === instance.version
          )
      ))
  ) {
    throw new Error(
      "The linked recovery observation or retained Container has changed."
    );
  }
}

function hasAdvancedNativeObservation(recovery) {
  const observed = recovery?.observedAfterFailure;
  return Boolean(
    recovery?.observedContainer &&
      observed?.containerVersion > recovery.baseline.containerVersion &&
      IMAGE_DIGEST.test(observed.containerImage.split("@")[1] ?? "") &&
      observed.containerImage.split("@")[0] ===
        recovery.baseline.containerImage.split("@")[0]
  );
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
  const unchanged =
    input.nativeProvenance && container?.version === baseline.containerVersion;
  if (
    input.sourceImageDigest &&
    container?.version === baseline.containerVersion
  ) {
    if (!input.sourceContainer) {
      throw new Error(
        "An unchanged source-built image requires its pre-deploy Container snapshot."
      );
    }
    assertRetainedPreUploadContainer(
      input.sourceContainer,
      container,
      instancesPage
    );
  }
  if (unchanged) {
    const observed = describeRemoteContainerConfiguration(container);
    const expected = input.nativeProvenance.container;
    if (
      observed.id !== expected.id ||
      observed.version !== expected.version ||
      observed.image !== expected.image ||
      observed.configurationHash !== expected.configurationHash ||
      expected.image !== baseline.containerImage ||
      imageDigest !== expected.image.split("@")[1]
    ) {
      throw new Error("The proven native artifact or configuration changed.");
    }
  }
  if (
    container?.id !== baseline.containerId ||
    container.name !== CONTAINER_NAME ||
    (!unchanged &&
      (input.sourceImageDigest
        ? container.version < baseline.containerVersion
        : container.version <= baseline.containerVersion)) ||
    !IMAGE_DIGEST.test(imageDigest) ||
    (input.sourceImageDigest !== undefined &&
      input.sourceImageDigest !== imageDigest) ||
    container.configuration?.image !== `${imagePrefix}@${imageDigest}` ||
    container.active_rollout_id != null ||
    !(
      image?.tags?.includes(
        (unchanged
          ? input.nativeProvenance.workerVersionId
          : workerVersionId
        ).slice(0, 8)
      ) || input.sourceImageDigest === imageDigest
    ) ||
    !Array.isArray(container.health?.errors) ||
    container.health.errors.length ||
    !Array.isArray(listed) ||
    listed.length === 0 ||
    page?.next_page_token !== null ||
    page?.page_token !== null ||
    !Number.isInteger(page?.per_page) ||
    page.per_page < listed.length ||
    health?.healthy + health?.active !== container.instances ||
    health?.healthy + health?.active < 1 ||
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

export function proveNativeBaseline(input) {
  const prior = input.verifiedHistoryBaseline;
  const identity = prior?.receipt?.identity;
  const container = describeRemoteContainerConfiguration(input.container);
  if (
    !(
      EXACT_SHA.test(prior?.evidenceSha ?? "") &&
      EXACT_SHA.test(prior?.sha ?? "")
    ) ||
    prior.receipt.status !== "verified" ||
    identity?.kind !== "worker-deployment" ||
    identity.workerName !== WORKER_NAME ||
    identity.environment !== "prod" ||
    identity.sourceSha !== prior.sha ||
    (prior.receipt.remoteAgent &&
      prior.receipt.remoteAgent.phase !== "complete") ||
    !(Date.parse(prior.recordedAt) <= Date.parse(input.startedAt)) ||
    container.id !== input.baseline.containerId ||
    container.version !== input.baseline.containerVersion ||
    container.image !== input.baseline.containerImage ||
    !IMAGE_DIGEST.test(input.imageDigest) ||
    container.image.split("@")[1] !== input.imageDigest
  ) {
    throw new Error(
      "The existing native artifact lacks matching verified release provenance."
    );
  }
  const provenance = {
    evidenceSha: prior.evidenceSha,
    sourceSha: prior.sha,
    workerVersionId: identity.versionId,
    container,
  };
  verifyRecoveredRemoteAgentTarget({
    ...input,
    nativeProvenance: provenance,
    workerVersionId: identity.versionId,
  });
  return provenance;
}

async function readImageDigest(
  cwd,
  imageRef,
  workerVersionId,
  immutableDigest
) {
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
  const tag = immutableDigest ?? workerVersionId.slice(0, 8);
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

function readRecoveryState(cwd, containerId, history, beforeUpload) {
  return {
    ...readState(cwd, containerId),
    ...(history.recovery || beforeUpload
      ? {
          instancesPage: readCloudflare(cwd, [
            "containers",
            "instances",
            containerId,
            "--per-page",
            "100",
            "--json",
          ]),
        }
      : {}),
  };
}

function readRecoveryEntry(cwd, evidenceSha, sourceSha) {
  const metadata = productionReleaseEvidenceSchema.parse(
    JSON.parse(run("git", ["show", "-s", "--format=%B", evidenceSha], cwd))
  );
  if (
    metadata.scope !== REMOTE_AGENT ||
    metadata.sourceSha !== sourceSha ||
    run("git", ["rev-parse", `${evidenceSha}^{tree}`], cwd) !==
      run("git", ["rev-parse", `${sourceSha}^{tree}`], cwd)
  ) {
    throw new Error(
      "Recovery history does not preserve the original source and scope."
    );
  }
  return {
    metadata,
    parents: run("git", ["show", "-s", "--format=%P", evidenceSha], cwd).split(
      " "
    ),
  };
}

function recoveryObservationBaseline(recovery) {
  const observed = recovery.observedAfterFailure;
  return {
    workerDeploymentId: observed?.workerDeploymentId,
    workerVersionId: observed?.workerVersionId,
    containerId: recovery.baseline.containerId,
    containerVersion: observed?.containerVersion,
    containerImage: observed?.containerImage,
  };
}

// A recovery failure adds a proof parent. Follow only that explicit chronology,
// never an arbitrary ancestor that happens to contain a matching start event.
export function readRemoteAgentRecoveryHistory(cwd, current) {
  let entry = readRecoveryEntry(cwd, current.evidenceSha, current.sha);
  if (
    entry.metadata.recordedAt !== current.recordedAt ||
    !isDeepStrictEqual(entry.metadata.receipt, current.receipt)
  ) {
    throw new Error(
      "Recovery history does not match the latest canonical receipt."
    );
  }
  let latestRecovery;
  let nextBaseline;
  for (let depth = 0; depth < MAX_RECOVERY_HISTORY_EVENTS; depth++) {
    const { metadata, parents } = entry;
    if (
      metadata.schemaVersion !== 3 ||
      metadata.receipt?.status !== "failed" ||
      metadata.receipt.application !== "unknown" ||
      !isDeepStrictEqual(metadata.receipt, current.receipt) ||
      ![1, 2].includes(parents.length)
    ) {
      throw new Error(
        "Recovery history contains a different or unresolved attempt."
      );
    }
    const previous = readRecoveryEntry(cwd, parents[0], current.sha);
    if (parents.length === 1) {
      if (
        previous.metadata.schemaVersion !== 3 ||
        previous.metadata.receipt?.status !== "started" ||
        !isDeepStrictEqual(
          { ...previous.metadata.receipt, status: "failed" },
          current.receipt
        ) ||
        Date.parse(previous.metadata.recordedAt) >
          Date.parse(metadata.recordedAt)
      ) {
        throw new Error("Recovery history has no exact original start event.");
      }
      return { started: previous.metadata, recovery: latestRecovery };
    }
    const proof = readRecoveryEntry(cwd, parents[1], current.sha);
    const { recovery, ...receipt } = proof.metadata.receipt;
    const observed = recovery?.observedAfterFailure;
    if (
      proof.metadata.schemaVersion !== 4 ||
      proof.parents.length !== 1 ||
      proof.parents[0] !== parents[0] ||
      recovery?.originalEvidenceSha !== parents[0] ||
      proof.metadata.recordedAt !== metadata.recordedAt ||
      !isDeepStrictEqual(receipt, metadata.receipt) ||
      !observed ||
      !(
        Date.parse(previous.metadata.recordedAt) <=
          Date.parse(recovery.startedAt) &&
        Date.parse(recovery.startedAt) < Date.parse(observed.observedAt) &&
        Date.parse(observed.observedAt) <= Date.parse(metadata.recordedAt)
      ) ||
      (!hasAdvancedNativeObservation(recovery) &&
        (observed.containerVersion !== recovery.baseline.containerVersion ||
          observed.containerImage !== recovery.baseline.containerImage)) ||
      (nextBaseline &&
        !isDeepStrictEqual(nextBaseline, recoveryObservationBaseline(recovery)))
    ) {
      throw new Error(
        "The linked recovery proof, observation window or baseline is invalid."
      );
    }
    latestRecovery ??= recovery;
    nextBaseline = recovery.baseline;
    entry = previous;
  }
  throw new Error("Recovery history exceeds the manual reconciliation limit.");
}

export function readNativeHistoryBaseline(cwd, prior) {
  if (!prior) {
    return undefined;
  }
  const parents = run(
    "git",
    ["show", "-s", "--format=%P", prior.evidenceSha],
    cwd
  ).split(" ");
  if (parents.length < 2) {
    return prior;
  }
  const proof = productionReleaseEvidenceSchema.parse(
    JSON.parse(run("git", ["show", "-s", "--format=%B", parents[1]], cwd))
  );
  if (proof.schemaVersion !== 4 || !proof.receipt.recovery.nativeProvenance) {
    return prior;
  }
  const { recovery, ...receipt } = proof.receipt;
  if (
    proof.scope !== REMOTE_AGENT ||
    proof.sourceSha !== prior.sha ||
    !isDeepStrictEqual(receipt, prior.receipt) ||
    run("git", ["rev-parse", `${parents[1]}^{tree}`], cwd) !==
      run("git", ["rev-parse", `${prior.sha}^{tree}`], cwd)
  ) {
    throw new Error(
      "Native recovery provenance does not match its canonical receipt."
    );
  }
  const reference = recovery.nativeProvenance;
  if (
    recovery.completed?.containerVersion !== reference.container.version ||
    recovery.completed.containerImage !== reference.container.image
  ) {
    throw new Error(
      "Native provenance does not describe the completed unchanged artifact."
    );
  }
  const metadata = productionReleaseEvidenceSchema.parse(
    JSON.parse(
      run("git", ["show", "-s", "--format=%B", reference.evidenceSha], cwd)
    )
  );
  run(
    "git",
    ["merge-base", "--is-ancestor", reference.evidenceSha, prior.evidenceSha],
    cwd
  );
  if (
    metadata.scope !== REMOTE_AGENT ||
    metadata.sourceSha !== reference.sourceSha ||
    metadata.receipt?.identity?.versionId !== reference.workerVersionId ||
    run("git", ["rev-parse", `${reference.evidenceSha}^{tree}`], cwd) !==
      run("git", ["rev-parse", `${reference.sourceSha}^{tree}`], cwd)
  ) {
    throw new Error(
      "Original native receipt provenance does not match its reference."
    );
  }
  return {
    evidenceSha: reference.evidenceSha,
    sha: metadata.sourceSha,
    recordedAt: metadata.recordedAt,
    receipt: metadata.receipt,
  };
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

export async function waitForRemoteAgentContainer(
  cwd,
  baseline,
  workerVersionId,
  nativeProvenance,
  sourceImageDigest,
  sourceContainer
) {
  const deadline = Date.now() + ROLLOUT_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const state = readState(cwd, baseline.containerId);
      const imageDigest = await readImageDigest(
        cwd,
        baseline.containerImage,
        nativeProvenance &&
          state.container.version === baseline.containerVersion
          ? nativeProvenance.workerVersionId
          : workerVersionId,
        sourceImageDigest
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
        nativeProvenance,
        sourceImageDigest,
        sourceContainer,
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
    if (
      completed.containerVersion !== input.recovery.baseline.containerVersion ||
      completed.containerImage !== input.recovery.baseline.containerImage
    ) {
      input.recovery.nativeProvenance = undefined;
    }
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

export function publishRemoteAgentRecoveryEvidence(input) {
  const updated = {
    ...input.receipt,
    status: input.status,
    application: input.application,
    ...(input.identity ? { identity: input.identity } : {}),
  };
  const receipt =
    input.status === "verified" ? completeRemoteAgentReceipt(updated) : updated;
  return publishGuardedLocalReleaseEvidence({
    cwd: input.cwd,
    sourceSha: input.sourceSha,
    scopes: [REMOTE_AGENT],
    receipts: { [REMOTE_AGENT]: receipt },
    recoveryProof: {
      [REMOTE_AGENT]: { ...receipt, recovery: input.recovery },
    },
    ...(input.now ? { now: input.now } : {}),
  });
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
          "--verify-only",
          "--base",
          "--before-upload",
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
    Object.keys(options).length !== (options["--before-upload"] ? 10 : 9) ||
    (options["--before-upload"] !== undefined &&
      (options["--before-upload"] !== "true" || options["--verify-only"])) ||
    (options["--verify-only"] !== "true" &&
      !EXACT_SHA.test(options["--base"] ?? "")) ||
    (options["--verify-only"] === "true" && options["--base"] !== undefined) ||
    (options["--verify-only"] !== undefined &&
      options["--verify-only"] !== "true") ||
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
  const beforeUpload = options["--before-upload"] === "true";
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
  process.chdir(sourceDir);
  if (options["--verify-only"] !== "true") {
    // Current-main owns the plan and checks against the pinned source. Ordinary
    // train admission cannot prove an unknown attempt before its recovery lease.
    const plan = buildProductionReleasePlan({
      scope: REMOTE_AGENT,
      base: options["--base"],
      sourceSha,
    });
    runProductionPreflightSteps(plan.sourcePreflightSteps);
    assertCleanSource(sourceDir, sourceSha);
  }
  const steps = buildProductionDeployStepSpecs([REMOTE_AGENT]);
  const [group] = groupReleaseSteps(steps);
  const target = await resolveReceiptWorkerTarget({ cwd: sourceDir, group });
  const operationKey = releaseComponentOperationKey({
    sourceSha,
    group,
    target,
  });
  await executeWithProductionScopeLeases({
    owner: resolveLocalReleaseOwner(),
    scopes: [REMOTE_AGENT],
    sourceSha,
    execute: async () => {
      const latest = readGuardedLocalReleaseSources({ cwd: sourceDir }).get(
        REMOTE_AGENT
      );
      if (options["--verify-only"] === "true") {
        assertRemoteVerificationSelectors(latest, options);
        await resumeRemoteAgentVerification({
          cwd: sourceDir,
          sourceSha,
          group,
          target,
          operationKey,
          previous: latest,
          runCommand: (input) => readWorkerCommand(sourceDir, input),
        });
        process.stdout.write(
          "Remote Agent original attempt verified without deployment.\n"
        );
        return;
      }
      const history = readRemoteAgentRecoveryHistory(sourceDir, latest);
      const verifyPreUploadTag =
        beforeUpload && !history.recovery?.observedContainer;
      const original = readRecoveryState(
        sourceDir,
        options["--container-id"],
        history,
        beforeUpload
      );
      const baseline = assessRemoteAgentPartialRecovery({
        current: latest,
        beforeUpload,
        ...history,
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
      await runProductionStageAdmission({
        scope: REMOTE_AGENT,
        sourceSha,
        remoteAgentRecovery: {
          sourceSha,
          evidenceSha: latest.evidenceSha,
          attemptId: latest.receipt.attemptId,
          operationKey,
        },
      });
      const recovery = {
        id: randomUUID(),
        originalEvidenceSha: latest.evidenceSha,
        startedAt: new Date().toISOString(),
        baseline,
      };
      // A pre-upload recovery performs a full native release. Historical native
      // receipts can describe an older deployment. Rebuild from this source to
      // establish the expected immutable image independently of registry tags.
      const fullNativeRelease =
        beforeUpload || Boolean(history.recovery?.observedContainer);
      const prior = fullNativeRelease
        ? undefined
        : readNativeHistoryBaseline(sourceDir, latest.verifiedHistoryBaseline);
      const nativeProvenance = prior
        ? proveNativeBaseline({
            verifiedHistoryBaseline: prior,
            startedAt: latest.receipt.startedAt,
            baseline,
            container: original.container,
            images: original.images,
            instancesPage: readCloudflare(sourceDir, [
              "containers",
              "instances",
              baseline.containerId,
              "--per-page",
              "100",
              "--json",
            ]),
            imageDigest: await readImageDigest(
              sourceDir,
              baseline.containerImage,
              prior.receipt.identity?.versionId
            ),
          })
        : undefined;
      if (nativeProvenance) {
        recovery.nativeProvenance = nativeProvenance;
      }
      const retainedBeforeUpload = fullNativeRelease
        ? describeRetainedContainer(original.container, original.instancesPage)
        : undefined;
      if (retainedBeforeUpload) {
        recovery.observedContainer = retainedBeforeUpload;
      }
      if (verifyPreUploadTag) {
        await verifyPreUploadImage(sourceDir, baseline);
      }
      const record = (status, application, identity) =>
        publishRemoteAgentRecoveryEvidence({
          cwd: sourceDir,
          sourceSha,
          receipt: latest.receipt,
          recovery,
          status,
          application,
          identity,
        });
      const capture = createWorkerDeploymentCapture({
        sourceSha,
        operationKey,
        target,
      });
      let sourceImage;
      try {
        if (fullNativeRelease) {
          sourceImage = await buildRecoverySourceImage(sourceDir);
          assertCleanSource(sourceDir, sourceSha);
        }
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
              beforeStep: async (_step, state) => {
                assertCleanSource(sourceDir, sourceSha);
                if (!state) {
                  return;
                }
                const fresh = readRecoveryState(
                  sourceDir,
                  baseline.containerId,
                  history,
                  beforeUpload
                );
                const freshBaseline = assessRemoteAgentPartialRecovery({
                  current: latest,
                  beforeUpload,
                  ...history,
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
                assertNativeConfigurationUnchanged(
                  nativeProvenance,
                  fresh.container
                );
                if (retainedBeforeUpload) {
                  assertRetainedPreUploadContainer(
                    retainedBeforeUpload,
                    fresh.container,
                    fresh.instancesPage
                  );
                  if (verifyPreUploadTag) {
                    await verifyPreUploadImage(sourceDir, baseline);
                  }
                }
                capture.recordDeploymentBaseline(state);
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
            waitForRemoteAgentContainer(
              sourceDir,
              baseline,
              workerVersionId,
              nativeProvenance,
              sourceImage?.digest,
              retainedBeforeUpload
            ),
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
        sourceImage?.close();
      }
    },
  });
}

async function buildRecoverySourceImage(cwd) {
  const require = createRequire(path.join(cwd, "package.json"));
  const { unstable_readConfig } = await import(
    pathToFileURL(require.resolve("wrangler")).href
  );
  const config = unstable_readConfig({
    config: path.join(cwd, "services/remote-agent/wrangler.jsonc"),
    env: "prod",
  });
  const containers = config.containers;
  const container = containers?.[0];
  if (
    containers?.length !== 1 ||
    container.name !== CONTAINER_NAME ||
    container.class_name !== "AgentComputer" ||
    path.basename(container.image ?? "") !== "Dockerfile" ||
    container.image_build_context !== path.dirname(container.image) ||
    Object.keys(container.image_vars ?? {}).length > 0
  ) {
    throw new Error(
      "Source image proof requires the configured single Dockerfile build without custom build arguments."
    );
  }
  const tag = `${CONTAINER_NAME}:release-proof-${randomUUID()}`;
  const close = () => {
    const result = spawnSync("docker", ["image", "rm", tag], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      process.stderr.write(
        `Could not remove local recovery image tag ${tag}.\n`
      );
    }
  };
  try {
    process.stdout.write(
      "Building the pinned source image for immutable digest verification.\n"
    );
    run(
      "pnpm",
      [
        "exec",
        "wrangler",
        "containers",
        "build",
        container.image_build_context,
        "--tag",
        tag,
      ],
      cwd,
      { timeout: 15 * 60 * 1000 }
    );
    const image = JSON.parse(
      run("docker", ["image", "inspect", "--format", "{{json .}}", tag], cwd)
    );
    if (
      image.Os !== "linux" ||
      image.Architecture !== "amd64" ||
      !IMAGE_DIGEST.test(image.Descriptor?.digest ?? "")
    ) {
      throw new Error(
        "Docker did not expose the source-built Linux amd64 immutable manifest digest."
      );
    }
    return { digest: image.Descriptor.digest, close };
  } catch (error) {
    close();
    throw error;
  }
}

export function assertRetainedPreUploadContainer(expected, container, page) {
  const { instances, ...configuration } = describeRetainedContainer(
    container,
    page
  );
  const { instances: protectedInstances, ...baseline } = expected;
  if (
    !isDeepStrictEqual(configuration, baseline) ||
    protectedInstances.some(
      (instance) =>
        !instances.some(
          (live) => live.id === instance.id && live.version === instance.version
        )
    )
  ) {
    throw new Error(
      "The pre-upload Container configuration or protected instances changed."
    );
  }
}

function assertNativeConfigurationUnchanged(provenance, container) {
  if (
    provenance &&
    describeRemoteContainerConfiguration(container).configurationHash !==
      provenance.container.configurationHash
  ) {
    throw new Error("Native configuration changed before recovery deployment.");
  }
}

async function verifyPreUploadImage(cwd, baseline) {
  const digest = await readImageDigest(
    cwd,
    baseline.containerImage,
    baseline.workerVersionId
  );
  if (baseline.containerImage.split("@")[1] !== digest) {
    throw new Error(
      "The active Worker image tag does not match the pre-upload Container digest."
    );
  }
}

export function assertRemoteVerificationSelectors(latest, options) {
  const receipt = latest?.receipt;
  const container = receipt?.remoteAgent?.container;
  if (
    latest?.sha !== options["--source-sha"] ||
    receipt?.attemptId !== options["--attempt"] ||
    receipt?.identity?.deploymentId !== options["--expected-deployment"] ||
    receipt?.identity?.versionId !== options["--expected-worker-version"] ||
    container?.id !== options["--container-id"] ||
    container?.version !== Number(options["--container-version"]) ||
    container?.image !== options["--container-image"]
  ) {
    throw new Error(
      "Verification selectors do not match the retained Remote Agent attempt."
    );
  }
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
