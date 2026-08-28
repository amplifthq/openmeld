import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { finalCandidateEvidenceSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";

const REUSABLE_CHECK_TASK_PLANS = new Map([
  [
    "affected-checks-and-unit-tests",
    [
      { changedOnly: true, task: "check", turboArgs: ["--concurrency=2"] },
      { changedOnly: true, task: "test", turboArgs: ["--concurrency=2"] },
    ],
  ],
  [
    "affected-integration-tests",
    [
      {
        changedOnly: false,
        task: "test:integration",
        turboArgs: ["--concurrency=1", "--output-logs=errors-only"],
      },
    ],
  ],
]);
const REUSE_PROTOCOL_VERSION = 2;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const INPUT_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_PRIOR_EVIDENCE_FILES = 10;
const MAX_PRIOR_EVIDENCE_BYTES = 2 * 1024 * 1024;

export function readPriorEvidenceCandidates(root) {
  if (!root) {
    return [];
  }
  const resolvedRoot = path.resolve(root);
  let entries;
  try {
    entries = readdirSync(resolvedRoot, {
      recursive: true,
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (
      candidates.length >= MAX_PRIOR_EVIDENCE_FILES ||
      !entry.isFile() ||
      entry.name !== "final-candidate-evidence.json"
    ) {
      continue;
    }
    const evidencePath = path.resolve(entry.parentPath, entry.name);
    if (!evidencePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      continue;
    }
    try {
      if (statSync(evidencePath).size > MAX_PRIOR_EVIDENCE_BYTES) {
        continue;
      }
      const parsed = finalCandidateEvidenceSchema.safeParse(
        JSON.parse(readFileSync(evidencePath, "utf8"))
      );
      if (parsed.success) {
        candidates.push(parsed.data);
      }
    } catch {
      // Prior evidence is an optimization only. Invalid files cause a rerun.
    }
  }
  return candidates;
}

export function resolveReusableCheckInput(input) {
  const reusableTaskPlans = resolveReusableTaskPlans(input.check.id);
  if (
    !reusableTaskPlans ||
    input.plan.mode !== "remote" ||
    input.plan.controlTrust !== "current-main" ||
    !input.commandWrapper
  ) {
    return null;
  }

  const taskPlans = reusableTaskPlans.map(({ changedOnly, task, turboArgs }) =>
    resolveTurboTaskPlan({
      baseSha: input.plan.baseSha,
      candidateRoot: input.candidateRoot,
      changedOnly,
      commandWrapper: input.commandWrapper,
      environment: input.environment,
      task,
      turboArgs,
    })
  );
  if (taskPlans.every((taskPlan) => taskPlan.tasks.length === 0)) {
    return null;
  }

  const inputFingerprint = computeReusableCheckFingerprint({
    check: input.check,
    runtime: {
      architecture: process.arch,
      nodeVersion: process.version,
      platform: process.platform,
      runnerImage: input.environment.ImageVersion ?? null,
      runnerOs: input.environment.RUNNER_OS ?? null,
    },
    taskPlans,
  });
  const reusedFrom = selectReusableCheckEvidence({
    check: input.check,
    currentPlan: input.plan,
    evidenceCandidates: input.evidenceCandidates,
    inputFingerprint,
    isAncestor: input.isAncestor,
    pullRequestNumber: input.pullRequestNumber,
    repository: input.repository,
  });
  return { inputFingerprint, reusedFrom };
}

export function resolveReusableTaskPlans(checkId) {
  const taskPlans = REUSABLE_CHECK_TASK_PLANS.get(checkId);
  return taskPlans?.map((taskPlan) => ({ ...taskPlan })) ?? null;
}

export function buildTurboTaskPlanCommand(input) {
  return [
    process.execPath,
    "scripts/dev/turbo-affected.mjs",
    ...(input.changedOnly ? ["--changed-only"] : []),
    input.task,
    "--",
    "--dry=json",
    ...input.turboArgs,
  ];
}

export function computeReusableCheckFingerprint(input) {
  const canonicalPlans = input.taskPlans
    .map((taskPlan) => ({
      changedOnly: taskPlan.changedOnly,
      task: taskPlan.task,
      tasks: taskPlan.tasks
        .map((task) => ({ hash: task.hash, taskId: task.taskId }))
        .toSorted((left, right) => left.taskId.localeCompare(right.taskId)),
      turboVersion: taskPlan.turboVersion,
      turboArgs: taskPlan.turboArgs,
    }))
    .toSorted((left, right) => left.task.localeCompare(right.task));
  return createHash("sha256")
    .update(
      JSON.stringify({
        check: {
          command: input.check.command,
          id: input.check.id,
          reason: input.check.reason,
        },
        protocolVersion: REUSE_PROTOCOL_VERSION,
        runtime: input.runtime ?? null,
        taskPlans: canonicalPlans,
      })
    )
    .digest("hex");
}

export function selectReusableCheckEvidence(input) {
  if (!INPUT_FINGERPRINT_PATTERN.test(input.inputFingerprint)) {
    return null;
  }
  for (const evidence of input.evidenceCandidates.toSorted(
    (left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt)
  )) {
    if (!evidenceCanBeReused(evidence, input)) {
      continue;
    }
    const result = evidence.results.find(
      (candidateResult) => candidateResult.id === input.check.id
    );
    if (result.execution.kind === "reused") {
      return result.execution.source;
    }
    return {
      baseSha: evidence.baseSha,
      durationMs: result.durationMs,
      finishedAt: evidence.finishedAt,
      headSha: evidence.headSha,
      treeSha: evidence.treeSha,
    };
  }
  return null;
}

function evidenceCanBeReused(evidence, input) {
  if (
    evidence.mode !== "remote" ||
    evidence.controlTrust !== "current-main" ||
    evidence.candidateKind !== "pull-request" ||
    evidence.repository !== input.repository ||
    evidence.pullRequestNumber !== input.pullRequestNumber ||
    evidence.branchName !== input.currentPlan.branchName ||
    evidence.confidence !== input.currentPlan.confidence ||
    !EXACT_SHA_PATTERN.test(evidence.baseSha ?? "") ||
    !EXACT_SHA_PATTERN.test(evidence.headSha ?? "") ||
    !EXACT_SHA_PATTERN.test(evidence.treeSha ?? "") ||
    !input.isAncestor(evidence.baseSha, input.currentPlan.baseSha) ||
    JSON.stringify(evidence.changedPaths) !==
      JSON.stringify(input.currentPlan.changedPaths)
  ) {
    return false;
  }
  const selectedCheck = evidence.selectedChecks.find(
    (candidateCheck) => candidateCheck.id === input.check.id
  );
  const result = evidence.results.find(
    (candidateResult) => candidateResult.id === input.check.id
  );
  return (
    JSON.stringify(selectedCheck) === JSON.stringify(input.check) &&
    result?.status === "passed" &&
    result.exitCode === 0 &&
    result.spawnError === null &&
    result.execution?.inputFingerprint === input.inputFingerprint
  );
}

function resolveTurboTaskPlan(input) {
  const command = buildTurboTaskPlanCommand(input);
  const result = spawnSync(path.resolve(input.commandWrapper), command, {
    cwd: path.resolve(input.candidateRoot),
    encoding: "utf8",
    env: {
      ...input.environment,
      OPENMELD_AFFECTED_BASE: input.baseSha,
    },
    maxBuffer: 1024 * 1024 * 50,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not describe ${input.task} inputs for safe reuse: ${result.error?.message ?? result.stderr.trim() ?? `exit ${String(result.status)}`}`
    );
  }
  const plan = JSON.parse(result.stdout);
  if (!(Array.isArray(plan.tasks) && typeof plan.turboVersion === "string")) {
    throw new Error(`Turbo returned an invalid ${input.task} input plan.`);
  }
  const tasks = plan.tasks.map((task) => {
    if (!(typeof task.taskId === "string" && typeof task.hash === "string")) {
      throw new Error(`Turbo returned an incomplete ${input.task} task hash.`);
    }
    return { hash: task.hash, taskId: task.taskId };
  });
  return {
    changedOnly: input.changedOnly,
    task: input.task,
    tasks,
    turboArgs: input.turboArgs,
    turboVersion: plan.turboVersion,
  };
}
