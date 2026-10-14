import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { productionComponentReceiptSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import {
  readRetainedRemoteContainer,
  verifyRemoteAgentNativeCompletion,
} from "./remote-agent-container-evidence.mjs";
import {
  createWorkerDeploymentCapture,
  readCliProjection,
  resolveReceiptWorkerTarget,
  verifyWorkerDeployment,
} from "./worker-deployment-evidence.mjs";

const EXACT_SOURCE_SHA = /^[0-9a-f]{40}$/u;

class ReceiptWriteError extends Error {
  constructor(message, options) {
    super(`${message} Cause: ${options.cause.message}`, options);
  }
}

// Run the existing deploy/health steps unchanged, adding component receipts while
// the caller still owns all selected production leases. Never claim batch success.
export async function executeRecordedProductionDeploySteps(input) {
  if (!EXACT_SOURCE_SHA.test(input.sourceSha ?? "")) {
    throw new Error("Component release evidence requires an exact source SHA.");
  }
  if (typeof input.executeSteps !== "function") {
    throw new Error(
      "Component release evidence requires the existing guarded step executor."
    );
  }
  const groups = groupReleaseSteps(input.steps);
  if (
    groups.some((group) => group.workerArguments) &&
    typeof input.runCommand !== "function"
  ) {
    throw new Error(
      "Component release evidence requires a Worker identity reader."
    );
  }
  // Read retained cross-machine state under the caller's existing scope leases,
  // before replacing an attempt or executing any deployment.
  if (input.publishEvidence && !input.readEvidence) {
    throw new Error(
      "A custom receipt publisher requires its matching evidence reader."
    );
  }
  const retained = await (input.readEvidence ?? readGuardedLocalReleaseSources)(
    {
      cwd: input.cwd,
      environment: input.env,
    }
  );
  // Resolve every component/recovery decision before effects in any component.
  // An unresolved late component must not restart earlier ones.
  const prepared = [];
  for (const group of groups) {
    const target = group.workerArguments
      ? await (input.resolveWorkerTarget ?? resolveReceiptWorkerTarget)({
          ...input,
          group,
        })
      : null;
    const operationKey = releaseComponentOperationKey({
      sourceSha: input.sourceSha,
      group,
      target,
    });
    const context = { ...input, group, target, operationKey };
    const previous = selectGuardedReceiptRecovery(context, retained);
    if (previous) {
      await verifyRetainedComponent(context, previous);
    }
    context.remoteAgent = await prepareRetainedNative(
      context,
      retained.get("remote-agent"),
      groups.length,
      previous
    );
    prepared.push({ ...context, previous });
  }
  const attemptId = input.attemptId ?? randomUUID();
  for (const [componentIndex, context] of prepared.entries()) {
    if (context.previous) {
      await resumeComponent({ ...context, attemptId, componentIndex });
    } else {
      await executeComponent({ ...context, attemptId, componentIndex });
    }
  }
}

async function prepareRetainedNative(input, baseline, groupCount, previous) {
  if (!input.retainContainers || previous) {
    return undefined;
  }
  if (
    groupCount !== 1 ||
    input.group.scope !== "remote-agent" ||
    baseline?.receipt?.status !== "verified" ||
    baseline.receipt.identity?.kind !== "worker-deployment" ||
    !EXACT_SOURCE_SHA.test(baseline.evidenceSha ?? "")
  ) {
    throw new Error(
      "Worker-only release requires the verified previous Remote Agent receipt."
    );
  }
  await verifyWorkerDeployment({
    ...input,
    sourceSha: baseline.sha,
    expected: baseline.receipt.identity,
  });
  return {
    phase: "worker-only",
    container: await (
      input.readRetainedContainer ?? readRetainedRemoteContainer
    )(input),
    baselineEvidenceSha: baseline.evidenceSha,
    baselineSourceSha: baseline.sha,
  };
}

export function releaseComponentOperationKey(input) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceSha: input.sourceSha,
        scope: input.group.scope,
        target: input.target,
        steps: input.group.steps.map((step) => ({
          command: step.command,
          args:
            input.group.scope === "remote-agent"
              ? step.args?.filter((arg) => arg !== "--containers-rollout=none")
              : step.args,
          internalOperation: step.internalOperation,
        })),
      })
    )
    .digest("hex");
}

export function describeGuardedReceiptRecoveryCandidate(
  source,
  scope,
  input = {}
) {
  const receipt = productionComponentReceiptSchema.safeParse(source?.receipt);
  if (scope === "remote-agent" && receipt.success && receipt.data.remoteAgent) {
    if (
      !["retained", "rollout"].includes(receipt.data.remoteAgent.phase) ||
      receipt.data.status !== "applied" ||
      source.sha !== input.sourceSha
    ) {
      return null;
    }
    return {
      admission: "candidate",
      kind:
        receipt.data.remoteAgent.phase === "rollout"
          ? "guarded-remote-native-verification"
          : "guarded-remote-container-continuation",
      sourceSha: source.sha,
      operationKey: receipt.data.operationKey,
      attemptId: receipt.data.attemptId,
      componentIndex: receipt.data.componentIndex,
    };
  }
  const rollback =
    scope === "db" && readPostgresqlRollbackBaseline(source, input);
  if (rollback) {
    return {
      admission: "candidate",
      attemptId: receipt.data.attemptId,
      componentIndex: receipt.data.componentIndex,
      kind: "guarded-postgresql-forward-retry",
      operationKey: receipt.data.operationKey,
      sourceSha: input.sourceSha,
      retainedSourceSha: source.sha,
    };
  }
  const database = scope === "db" && isDatabaseRecoverySource(source);
  const retry =
    scope === "core" && readUnchangedCoreRetryBaseline(source, source?.sha);
  if (
    !(
      EXACT_SOURCE_SHA.test(source?.sha ?? "") &&
      receipt.success &&
      ["applied", "failed"].includes(receipt.data.status)
    ) ||
    (!(retry || database) &&
      (receipt.data.application !== "applied" ||
        receipt.data.identity?.kind !== "worker-deployment" ||
        receipt.data.identity.sourceSha !== source.sha))
  ) {
    return null;
  }
  return {
    admission: "candidate",
    attemptId: receipt.data.attemptId,
    componentIndex: receipt.data.componentIndex,
    kind: retry ? "guarded-core-upload-retry" : "guarded-health-resume",
    operationKey: receipt.data.operationKey,
    sourceSha: source.sha,
  };
}

const POSTGRESQL_RETRY_PATHS = [
  "packages/db/postgresql/migrations",
  "tooling/postgresql/resources.json",
];

export function readPostgresqlRollbackBaseline(source, input) {
  const baseline = source?.verifiedHistoryBaseline;
  const receipt = productionComponentReceiptSchema.safeParse(source?.receipt);
  const prior = productionComponentReceiptSchema.safeParse(baseline?.receipt);
  const group = {
    scope: "db",
    steps: ["migrate", "grant-runtime", "verify"].map((command) => ({
      command: "node",
      args: ["tooling/postgresql/cutover.mjs", command],
    })),
  };
  if (
    !(
      EXACT_SOURCE_SHA.test(input.sourceSha ?? "") &&
      EXACT_SOURCE_SHA.test(source?.sha ?? "") &&
      EXACT_SOURCE_SHA.test(source?.evidenceSha ?? "") &&
      EXACT_SOURCE_SHA.test(baseline?.sha ?? "") &&
      EXACT_SOURCE_SHA.test(baseline?.evidenceSha ?? "")
    ) ||
    source.sha === input.sourceSha ||
    !receipt.success ||
    receipt.data.status !== "failed" ||
    receipt.data.application !== "unknown" ||
    receipt.data.identity ||
    !prior.success ||
    prior.data.status !== "verified" ||
    prior.data.identity?.kind !== "release-source" ||
    !(Date.parse(baseline.recordedAt) <= Date.parse(receipt.data.startedAt)) ||
    receipt.data.operationKey !==
      releaseComponentOperationKey({
        sourceSha: source.sha,
        group,
        target: null,
      }) ||
    prior.data.operationKey !==
      releaseComponentOperationKey({
        sourceSha: baseline.sha,
        group,
        target: null,
      })
  ) {
    return null;
  }
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: input.cwd, stdio: "ignore" });
    if (result.error || ![0, 1].includes(result.status)) {
      throw new Error(
        "Cannot verify PostgreSQL retry source history; fetch and reconcile before retrying."
      );
    }
    return result.status === 0;
  };
  const ancestor =
    input.sourceIsAncestor ??
    ((from, to) => git(["merge-base", "--is-ancestor", from, to]));
  const unchanged =
    input.compareGitPathContents ??
    (({ fromSha, toSha, paths }) =>
      git(["diff", "--quiet", fromSha, toSha, "--", ...paths]));
  if (
    !(
      ancestor(baseline.sha, source.sha) &&
      ancestor(source.sha, input.sourceSha) &&
      unchanged({
        fromSha: source.sha,
        toSha: input.sourceSha,
        paths: POSTGRESQL_RETRY_PATHS,
      }) &&
      unchanged({
        fromSha: baseline.sha,
        toSha: source.sha,
        paths: ["tooling/postgresql/resources.json"],
      })
    )
  ) {
    return null;
  }
  return baseline;
}

function isDatabaseRecoverySource(source) {
  const receipt = productionComponentReceiptSchema.safeParse(source?.receipt);
  return (
    EXACT_SOURCE_SHA.test(source?.sha ?? "") &&
    receipt.success &&
    ["applied", "failed"].includes(receipt.data.status) &&
    (!receipt.data.identity || receipt.data.identity.kind === "release-source")
  );
}

function isNativeDatabaseOperation(group) {
  return (
    group.scope === "db" &&
    group.steps.length === 3 &&
    ["migrate", "grant-runtime", "verify"].every((command, index) => {
      const step = group.steps[index];
      return (
        step.command === "node" &&
        !step.internalOperation &&
        !step.workerDeploymentArgs &&
        !step.receiptWorkerDeploymentArgs &&
        JSON.stringify(step.args) ===
          JSON.stringify(["tooling/postgresql/cutover.mjs", command])
      );
    })
  );
}

export function readUnchangedCoreRetryBaseline(source, sourceSha) {
  const baseline = source?.verifiedHistoryBaseline;
  const receipt = productionComponentReceiptSchema.safeParse(source?.receipt);
  const prior = productionComponentReceiptSchema.safeParse(baseline?.receipt);
  if (
    source?.sha !== sourceSha ||
    !receipt.success ||
    receipt.data.status !== "failed" ||
    receipt.data.application !== "unknown" ||
    receipt.data.identity ||
    !prior.success ||
    prior.data.status !== "verified" ||
    prior.data.identity?.kind !== "worker-deployment" ||
    prior.data.identity.workerName !== "openmeld-core-prod" ||
    prior.data.identity.sourceSha !== baseline.sha ||
    !(Date.parse(baseline.recordedAt) <= Date.parse(receipt.data.startedAt))
  ) {
    return null;
  }
  return baseline;
}

function selectRetainedRemoteRecovery(input, previous, workerIdentity) {
  const receipt = previous?.receipt;
  if (
    !receipt?.remoteAgent ||
    (receipt.status === "verified" && receipt.remoteAgent.phase === "complete")
  ) {
    return null;
  }
  if (
    input.group.scope === "remote-agent" &&
    previous.sha === input.sourceSha &&
    receipt.operationKey === input.operationKey &&
    receipt.status === "applied" &&
    ["retained", "rollout"].includes(receipt.remoteAgent.phase) &&
    receipt.application === "applied" &&
    workerIdentity?.kind === "worker-deployment" &&
    workerIdentity.sourceSha === input.sourceSha &&
    !input.redeploy
  ) {
    return {
      ...previous,
      workerIdentity,
      retainedRemote: receipt.remoteAgent.phase === "retained",
      remoteVerificationOnly: receipt.remoteAgent.phase === "rollout",
    };
  }
  throw new Error(
    "Unresolved retained Container release; reconcile its exact Worker and native identities before any deployment."
  );
}

export function selectGuardedReceiptRecovery(input, retained) {
  const scopes =
    input.group.scope === "cli" ? ["cli", "core"] : [input.group.scope];
  const pending = scopes
    .map((scope) => retained.get(scope))
    .filter(
      (source) => source?.receipt && source.receipt.status !== "verified"
    );
  const previous = retained.get(input.group.scope);
  const receipt = previous?.receipt;
  const workerSource = retained.get(
    input.group.scope === "cli" ? "core" : input.group.scope
  );
  const workerIdentity = workerSource?.receipt?.identity;
  const retainedRemote = selectRetainedRemoteRecovery(
    input,
    previous,
    workerIdentity
  );
  if (retainedRemote) {
    return retainedRemote;
  }
  if (
    pending.length &&
    isNativeDatabaseOperation(input.group) &&
    isDatabaseRecoverySource(previous) &&
    previous.sha === input.sourceSha &&
    receipt.operationKey === input.operationKey &&
    !input.redeploy
  ) {
    return { ...previous, databaseRecovery: true };
  }
  const sameTarget =
    input.target &&
    previous?.sha === input.sourceSha &&
    receipt?.operationKey === input.operationKey &&
    receipt.application === "applied" &&
    workerSource?.sha === input.sourceSha &&
    workerSource.receipt.operationKey === input.operationKey &&
    workerSource.receipt.attemptId === receipt.attemptId &&
    workerSource.receipt.componentIndex === receipt.componentIndex &&
    workerSource.receipt.status === receipt.status &&
    workerIdentity?.kind === "worker-deployment" &&
    workerIdentity.sourceSha === input.sourceSha &&
    workerIdentity.workerName === input.target.workerName &&
    workerIdentity.environment === "prod" &&
    workerIdentity.projectionTag === input.target.projectionTag;
  const recovery = () => ({
    ...previous,
    workerIdentity,
    peerReceipts: Object.fromEntries(
      scopes.map((scope) => [scope, retained.get(scope).receipt])
    ),
  });
  if (pending.length) {
    const databaseBaseline =
      isNativeDatabaseOperation(input.group) &&
      !input.redeploy &&
      readPostgresqlRollbackBaseline(previous, input);
    if (databaseBaseline) {
      return { ...previous, databaseRetry: true, databaseBaseline };
    }
    const baseline =
      input.group.scope === "core" &&
      readUnchangedCoreRetryBaseline(previous, input.sourceSha);
    if (
      baseline &&
      input.target?.workerName === "openmeld-core-prod" &&
      receipt.operationKey === input.operationKey &&
      !input.redeploy
    ) {
      return {
        ...previous,
        retry: true,
        workerIdentity: baseline.receipt.identity,
      };
    }
    if (
      sameTarget &&
      ["applied", "failed"].includes(receipt.status) &&
      !input.redeploy
    ) {
      return recovery();
    }
    throw new Error(
      `Unresolved ${input.group.scope} release attempt; reconcile the retained source, deployment and target before retrying. No new attempt or deployment was started.`
    );
  }
  if (sameTarget && receipt.status === "verified" && !input.redeploy) {
    return recovery();
  }
  return null;
}

async function verifyRetainedComponent(input, previous) {
  if (previous.retainedRemote) {
    await (input.readRetainedContainer ?? readRetainedRemoteContainer)(
      input,
      previous.receipt.remoteAgent.container
    );
  }
  if (previous.databaseRetry) {
    const result = await input.runCommand({
      command: "node",
      args: [
        "tooling/postgresql/cutover.mjs",
        "verify-retry-baseline",
        previous.databaseBaseline.sha,
      ],
      cwd: input.cwd,
      env: input.env,
    });
    let proof;
    try {
      proof = JSON.parse(result.stdout);
    } catch {
      /* Fail closed below. */
    }
    if (
      result.status !== 0 ||
      proof?.baselineSourceSha !== previous.databaseBaseline.sha ||
      proof?.runtimeGrantsVerified !== true
    ) {
      throw new Error(
        "PostgreSQL retry baseline is not unchanged; preserve the unresolved attempt and reconcile the live target."
      );
    }
    previous.rollbackProof = {
      kind: "reconciled-postgresql-rollback",
      verifiedAt: new Date().toISOString(),
      supersededReceipt: {
        evidenceSha: previous.evidenceSha,
        sourceSha: previous.sha,
      },
      baselineReceipt: {
        evidenceSha: previous.databaseBaseline.evidenceSha,
        sourceSha: previous.databaseBaseline.sha,
      },
    };
    return;
  }
  if (previous.databaseRecovery) {
    await input.executeSteps({
      cwd: input.cwd,
      env: input.env,
      steps: input.group.steps.slice(2),
      adapters: input.executionAdapters,
      write: input.write,
      beforeStep: input.beforeStep,
      afterStep: input.afterStep,
    });
    return;
  }
  if (input.group.scope === "cli") {
    const { readCompletedCliRelease } = await import(
      "./release-cli-resume.mjs"
    );
    const result = await (input.readCliCompletion ?? readCompletedCliRelease)({
      cwd: input.cwd,
      env: input.env,
    });
    const projection = readCliProjection(result, input);
    if (
      projection.versionId !== previous.workerIdentity.versionId ||
      projection.deploymentId !== previous.workerIdentity.deploymentId
    ) {
      throw new Error(
        "Retained CLI/Core identity changed; reconcile instead of restarting publication."
      );
    }
  }
  await verifyWorkerDeployment({
    ...input,
    ...(previous.retry
      ? {
          sourceSha: previous.workerIdentity.sourceSha,
          target: {
            ...input.target,
            projectionTag: previous.workerIdentity.projectionTag,
          },
        }
      : {}),
    expected: previous.workerIdentity,
  });
}

async function resumeComponent(input) {
  const receipt = input.previous.receipt;
  if (input.previous.remoteVerificationOnly) {
    await resumeRemoteAgentVerification(input);
    return;
  }
  if (input.previous.retainedRemote) {
    if (input.retainContainers) {
      return;
    }
    await executeComponent({
      ...input,
      attemptId: receipt.attemptId,
      componentIndex: receipt.componentIndex,
      remoteAgent: { ...receipt.remoteAgent, phase: "rollout" },
      continuedRemote: true,
    });
    return;
  }
  if (input.previous.databaseRetry) {
    await executeComponent({
      ...input,
      attemptId: input.attemptId,
      componentIndex: input.componentIndex,
    });
    return;
  }
  if (input.previous.databaseRecovery) {
    await (input.publishEvidence ?? publishGuardedLocalReleaseEvidence)({
      cwd: input.cwd,
      environment: input.env,
      sourceSha: input.sourceSha,
      scopes: ["db"],
      receipts: {
        db: {
          ...receipt,
          status: "verified",
          application: "applied",
          identity: { kind: "release-source" },
        },
      },
      ...(input.now ? { now: input.now() } : {}),
    });
    return;
  }
  if (input.previous.retry) {
    await executeComponent({
      ...input,
      attemptId: receipt.attemptId,
      componentIndex: receipt.componentIndex,
    });
    return;
  }
  if (receipt.status === "verified") {
    return;
  }
  await input.executeSteps({
    cwd: input.cwd,
    env: input.env,
    steps: input.group.steps.slice(1),
    adapters: input.executionAdapters,
    write: input.write,
    beforeStep: input.beforeStep,
    afterStep: input.afterStep,
  });
  await verifyWorkerDeployment({
    ...input,
    expected: input.previous.workerIdentity,
  });
  await (input.publishEvidence ?? publishGuardedLocalReleaseEvidence)({
    cwd: input.cwd,
    environment: input.env,
    sourceSha: input.sourceSha,
    scopes: Object.keys(input.previous.peerReceipts),
    receipts: Object.fromEntries(
      Object.entries(input.previous.peerReceipts).map(([scope, prior]) => [
        scope,
        { ...prior, status: "verified" },
      ])
    ),
    ...(input.now ? { now: input.now() } : {}),
  });
}

// Both guarded deploy and current-main recovery use this one receipt writer.
// The caller holds the Remote Agent lease and has selected the exact attempt.
export async function resumeRemoteAgentVerification(input) {
  const previous = selectGuardedReceiptRecovery(
    input,
    new Map([["remote-agent", input.previous]])
  );
  if (!previous?.remoteVerificationOnly) {
    throw new Error(
      "Remote Agent verification requires an applied native rollout."
    );
  }
  const receipt = previous.receipt;
  await verifyWorkerDeployment({ ...input, expected: previous.workerIdentity });
  await (input.verifyNativeCompletion ?? verifyRemoteAgentNativeCompletion)(
    input,
    receipt.remoteAgent.container,
    previous.workerIdentity
  );
  await verifyWorkerDeployment({ ...input, expected: previous.workerIdentity });
  try {
    await (input.publishEvidence ?? publishGuardedLocalReleaseEvidence)({
      cwd: input.cwd,
      environment: input.env,
      sourceSha: input.sourceSha,
      scopes: ["remote-agent"],
      receipts: {
        "remote-agent": {
          ...receipt,
          status: "verified",
          remoteAgent: { ...receipt.remoteAgent, phase: "complete" },
        },
      },
      ...(input.now ? { now: input.now() } : {}),
    });
  } catch (error) {
    throw new ReceiptWriteError(
      "Could not persist remote-agent verified evidence. Retry guarded verification of the recorded attempt.",
      { cause: error }
    );
  }
}

export function groupReleaseSteps(steps) {
  const groups = [];
  let group;
  for (const step of steps) {
    if (!step.releaseScope) {
      throw new Error("A release step is missing its component boundary.");
    }
    group ??= {
      scope: step.releaseScope,
      steps: [],
      workerArguments: undefined,
    };
    if (group.scope !== step.releaseScope) {
      throw new Error("A component is missing its final health boundary.");
    }
    group.steps.push(step);
    group.workerArguments =
      step.receiptWorkerDeploymentArgs ??
      group.workerArguments ??
      step.workerDeploymentArgs;
    if (step.completesReleaseScope) {
      groups.push(group);
      group = undefined;
    }
  }
  if (group) {
    throw new Error("A component is missing its final health boundary.");
  }
  return groups;
}

async function retainNativeAfterWorker(input, workerIdentity) {
  if (!input.retainContainers) {
    return;
  }
  await (input.readRetainedContainer ?? readRetainedRemoteContainer)(
    input,
    input.remoteAgent.container
  );
  input.remoteAgent = {
    ...input.remoteAgent,
    phase: "retained",
    workerIdentity,
  };
}

async function verifyNativeStage(input, identity) {
  if (input.retainContainers) {
    await (input.readRetainedContainer ?? readRetainedRemoteContainer)(
      input,
      input.remoteAgent.container
    );
  } else if (input.continuedRemote) {
    await (input.verifyNativeCompletion ?? verifyRemoteAgentNativeCompletion)(
      input,
      input.remoteAgent.container,
      identity
    );
    input.remoteAgent = { ...input.remoteAgent, phase: "complete" };
  }
}

function recordComponentCompletion(input, record) {
  if (!input.retainContainers) {
    return record("verified");
  }
  (input.write ?? ((line) => process.stdout.write(`${line}\n`)))(
    "Remote Agent Worker applied. Container configuration unchanged; native rollout remains pending. Verify original file synchronization before explicitly continuing the full Remote Agent release."
  );
}

async function executeComponent(input) {
  const { group } = input;
  const scopes = group.scope === "cli" ? ["cli", "core"] : [group.scope];
  let application = "unknown";
  let identities = new Map();
  const startedAt =
    input.previous?.retry || input.continuedRemote
      ? input.previous.receipt.startedAt
      : new Date().toISOString();
  const capture = input.target ? createWorkerDeploymentCapture(input) : null;
  const record = async (status) => {
    const receipts = Object.fromEntries(
      scopes.map((scope) => [
        scope,
        {
          attemptId: input.attemptId,
          componentIndex: input.componentIndex,
          operationKey: input.operationKey,
          startedAt,
          status,
          application,
          ...(identities.has(scope) ? { identity: identities.get(scope) } : {}),
          ...(input.remoteAgent ? { remoteAgent: input.remoteAgent } : {}),
        },
      ])
    );
    try {
      await (input.publishEvidence ?? publishGuardedLocalReleaseEvidence)({
        cwd: input.cwd,
        environment: input.env,
        sourceSha: input.sourceSha,
        scopes,
        receipts,
        ...(status === "started" && input.previous?.rollbackProof
          ? { reconciliation: { db: input.previous.rollbackProof } }
          : {}),
        ...(input.now ? { now: input.now() } : {}),
      });
    } catch (error) {
      throw new ReceiptWriteError(
        `Could not persist ${group.scope} ${status} evidence. Stop and reconcile the recorded attempt before retrying.`,
        { cause: error }
      );
    }
  };
  try {
    await executeNewComponent();
  } finally {
    capture?.close();
  }

  async function executeNewComponent() {
    let completed = 0;
    let started = false;
    try {
      await input.executeSteps({
        cwd: input.cwd,
        env: capture?.env ?? input.env,
        steps: group.steps,
        beforeStep: async (step, workerDeploymentState) => {
          if (capture && group.scope !== "cli" && completed === 0) {
            capture.recordDeploymentBaseline(workerDeploymentState);
          }
          await input.beforeStep?.(step);
          if (!started) {
            if (!input.previous?.retry) {
              await record("started");
            }
            started = true;
          }
        },
        adapters: input.executionAdapters,
        write: input.write,
        afterStep: async (step, result) => {
          await input.afterStep?.(step);
          if (step !== group.steps[completed]) {
            throw new Error("Unexpected component step completion.");
          }
          completed += 1;
          if (completed === 1) {
            application = "applied";
            identities = new Map(
              scopes
                .filter((scope) => !capture || scope === "cli")
                .map((scope) => [
                  scope,
                  scope === "cli"
                    ? requireCliReleaseIdentity(result)
                    : { kind: "release-source" },
                ])
            );
            if (capture) {
              const expected = capture.read(
                group.scope === "cli" ? result : undefined
              );
              const identity = await verifyWorkerDeployment({
                ...input,
                expected,
              });
              identities.set(
                group.scope === "cli" ? "core" : group.scope,
                identity
              );
            }
            await retainNativeAfterWorker(input, identities.get(group.scope));
            await record("applied");
          }
        },
      });
      if (completed !== group.steps.length || application !== "applied") {
        throw new Error("Component completion evidence is missing.");
      }
      await verifyNativeStage(input, identities.get(group.scope));
      if (input.target) {
        await verifyWorkerDeployment({
          ...input,
          expected: identities.get(
            group.scope === "cli" ? "core" : group.scope
          ),
        });
      }
    } catch (error) {
      if (error instanceof ReceiptWriteError) {
        throw error;
      }
      if (!started) {
        throw error;
      }
      try {
        await record("failed");
      } catch (receiptError) {
        throw new AggregateError(
          [error, receiptError],
          `Component ${group.scope} failed and its failure receipt could not be persisted; reconcile the retained attempt.`
        );
      }
      throw error;
    }
    await recordComponentCompletion(input, record);
  }
}

function requireCliReleaseIdentity(result) {
  if (result?.receiptIdentity?.kind !== "cli-release") {
    throw new Error(
      "CLI publication completed without its verified version and artifact identity."
    );
  }
  return result.receiptIdentity;
}
