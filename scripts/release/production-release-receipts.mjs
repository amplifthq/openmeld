import { randomUUID } from "node:crypto";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import { readCurrentWorkerVersionIds } from "./release-stage-probes.mjs";

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
  for (const group of groups) {
    for (const scope of group.scope === "cli"
      ? ["cli", "core"]
      : [group.scope]) {
      const previous = retained.get(scope);
      if (previous?.receipt && previous.receipt.status !== "verified") {
        throw new Error(
          `Unresolved ${scope} release attempt ${previous.receipt.attemptId} (${previous.receipt.status}); reconcile its actual deployment before retrying. No new deployment or attempt was started.`
        );
      }
    }
  }
  const attemptId = input.attemptId ?? randomUUID();
  for (const [componentIndex, group] of groups.entries()) {
    await executeComponent({ ...input, group, attemptId, componentIndex });
  }
}

function groupReleaseSteps(steps) {
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
  const record = async (status) => {
    const receipts = Object.fromEntries(
      scopes.map((scope) => [
        scope,
        {
          attemptId: input.attemptId,
          componentIndex: input.componentIndex,
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
  await record("started");
  let completed = 0;
  try {
    await input.executeSteps({
      cwd: input.cwd,
      env: input.env,
      steps: group.steps,
      adapters: input.executionAdapters,
      write: input.write,
      afterStep: async (step) => {
        await input.afterStep?.(step);
        if (step !== group.steps[completed]) {
          throw new Error("Unexpected component step completion.");
        }
        completed += 1;
        if (completed === 1) {
          application = "applied";
          identities = await observeComponentIdentity(input, scopes);
          await record("applied");
        }
      },
    });
    if (completed !== group.steps.length || application !== "applied") {
      throw new Error("Component completion evidence is missing.");
    }
  } catch (error) {
    if (error instanceof ReceiptWriteError) {
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

async function observeComponentIdentity(input, scopes) {
  const identities = new Map(
    scopes.map((scope) => [scope, { kind: "release-source" }])
  );
  if (!input.group.workerArguments) {
    return identities;
  }
  const result = await input.runCommand({
    command: "pnpm",
    args: [
      "exec",
      "wrangler",
      "deployments",
      "list",
      ...input.group.workerArguments,
      "--json",
    ],
    env: input.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      "Unable to observe the applied Worker identity; do not mark this component verified."
    );
  }
  const versions = readCurrentWorkerVersionIds(JSON.parse(result.stdout));
  if (
    !versions.length ||
    versions.some(
      (version) =>
        !Number.isFinite(version.percentage) || version.percentage <= 0
    ) ||
    Math.abs(
      versions.reduce((sum, version) => sum + version.percentage, 0) - 100
    ) > 0.001 ||
    new Set(versions.map((version) => version.versionId)).size !==
      versions.length
  ) {
    throw new Error(
      "Applied Worker traffic identity is incomplete or malformed."
    );
  }
  identities.set(input.group.scope === "cli" ? "core" : input.group.scope, {
    kind: "worker",
    versions: versions.toSorted((left, right) =>
      left.versionId.localeCompare(right.versionId)
    ),
  });
  return identities;
}
