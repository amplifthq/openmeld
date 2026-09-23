import { createHash, randomUUID } from "node:crypto";
import { productionComponentReceiptSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import {
  createWorkerDeploymentCapture,
  readCliProjection,
  resolveReceiptWorkerTarget,
  verifyWorkerDeployment,
} from "./worker-deployment-evidence.mjs";

const EXACT_SOURCE_SHA = /^[0-9a-f]{40}$/u;

class ReceiptWriteError extends Error {}

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
    prepared.push({ ...context, previous });
  }
  const attemptId = input.attemptId ?? randomUUID();
  for (const [componentIndex, context] of prepared.entries()) {
    if (context.previous) {
      await resumeComponent(context);
    } else {
      await executeComponent({ ...context, attemptId, componentIndex });
    }
  }
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
          args: step.args,
          internalOperation: step.internalOperation,
        })),
      })
    )
    .digest("hex");
}

export function describeGuardedReceiptRecoveryCandidate(source) {
  const receipt = productionComponentReceiptSchema.safeParse(source?.receipt);
  if (
    !(
      EXACT_SOURCE_SHA.test(source?.sha ?? "") &&
      receipt.success &&
      ["applied", "failed"].includes(receipt.data.status)
    ) ||
    receipt.data.application !== "applied" ||
    receipt.data.identity?.kind !== "worker-deployment" ||
    receipt.data.identity.sourceSha !== source.sha
  ) {
    return null;
  }
  return {
    admission: "candidate",
    attemptId: receipt.data.attemptId,
    componentIndex: receipt.data.componentIndex,
    kind: "guarded-health-resume",
    operationKey: receipt.data.operationKey,
    sourceSha: source.sha,
  };
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
  await verifyWorkerDeployment({ ...input, expected: previous.workerIdentity });
}

async function resumeComponent(input) {
  const receipt = input.previous.receipt;
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

async function executeComponent(input) {
  const { group } = input;
  const scopes = group.scope === "cli" ? ["cli", "core"] : [group.scope];
  let application = "unknown";
  let identities = new Map();
  const startedAt = new Date().toISOString();
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
            await record("started");
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
            await record("applied");
          }
        },
      });
      if (completed !== group.steps.length || application !== "applied") {
        throw new Error("Component completion evidence is missing.");
      }
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
    await record("verified");
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
