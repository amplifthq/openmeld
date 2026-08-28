import assert from "node:assert/strict";
import test from "node:test";

import {
  computeReusableCheckFingerprint,
  selectReusableCheckEvidence,
} from "./final-candidate-reuse.mjs";

const BASE_SHA = "1".repeat(40);
const NEW_BASE_SHA = "2".repeat(40);
const HEAD_SHA = "3".repeat(40);
const TREE_SHA = "4".repeat(40);
const FINGERPRINT = "a".repeat(64);
const CHECK = {
  command: ["pnpm", "run", "verify:pr"],
  id: "affected-checks-and-unit-tests",
  reason: "Unit tests prove the affected workspaces.",
};

test("reusable task fingerprints ignore task order but change with a real task input", () => {
  const first = computeReusableCheckFingerprint({
    check: CHECK,
    runtime: { nodeVersion: "v24.1.0", platform: "linux" },
    taskPlans: [
      {
        task: "check",
        tasks: [
          { hash: "check-b", taskId: "web#check" },
          { hash: "check-a", taskId: "schemas#check" },
        ],
        turboVersion: "2.5.6",
      },
      {
        task: "test",
        tasks: [{ hash: "test-a", taskId: "web#test" }],
        turboVersion: "2.5.6",
      },
    ],
  });
  const reordered = computeReusableCheckFingerprint({
    check: CHECK,
    runtime: { nodeVersion: "v24.1.0", platform: "linux" },
    taskPlans: [
      {
        task: "test",
        tasks: [{ hash: "test-a", taskId: "web#test" }],
        turboVersion: "2.5.6",
      },
      {
        task: "check",
        tasks: [
          { hash: "check-a", taskId: "schemas#check" },
          { hash: "check-b", taskId: "web#check" },
        ],
        turboVersion: "2.5.6",
      },
    ],
  });
  const changed = computeReusableCheckFingerprint({
    check: CHECK,
    runtime: { nodeVersion: "v24.1.0", platform: "linux" },
    taskPlans: [
      {
        task: "check",
        tasks: [
          { hash: "check-a", taskId: "schemas#check" },
          { hash: "check-changed", taskId: "web#check" },
        ],
        turboVersion: "2.5.6",
      },
      {
        task: "test",
        tasks: [{ hash: "test-a", taskId: "web#test" }],
        turboVersion: "2.5.6",
      },
    ],
  });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.notEqual(
    first,
    computeReusableCheckFingerprint({
      check: CHECK,
      runtime: { nodeVersion: "v24.2.0", platform: "linux" },
      taskPlans: [
        {
          task: "check",
          tasks: [
            { hash: "check-a", taskId: "schemas#check" },
            { hash: "check-b", taskId: "web#check" },
          ],
          turboVersion: "2.5.6",
        },
        {
          task: "test",
          tasks: [{ hash: "test-a", taskId: "web#test" }],
          turboVersion: "2.5.6",
        },
      ],
    })
  );
});

test("a current candidate reuses only matching successful evidence from an ancestor base", () => {
  const evidence = createEvidence();
  const reusable = selectReusableCheckEvidence({
    check: CHECK,
    currentPlan: createCurrentPlan(),
    evidenceCandidates: [evidence],
    inputFingerprint: FINGERPRINT,
    isAncestor: (ancestor, descendant) =>
      ancestor === BASE_SHA && descendant === NEW_BASE_SHA,
    pullRequestNumber: 415,
    repository: "amplifthq/openmeld",
  });

  assert.deepEqual(reusable, {
    baseSha: BASE_SHA,
    durationMs: 12_345,
    finishedAt: evidence.finishedAt,
    headSha: HEAD_SHA,
    treeSha: TREE_SHA,
  });
});

test("reuse fails closed when task inputs, pull request, or base ancestry differ", () => {
  const evidence = createEvidence();
  const common = {
    check: CHECK,
    currentPlan: createCurrentPlan(),
    evidenceCandidates: [evidence],
    inputFingerprint: FINGERPRINT,
    isAncestor: () => true,
    pullRequestNumber: 415,
    repository: "amplifthq/openmeld",
  };

  assert.equal(
    selectReusableCheckEvidence({
      ...common,
      inputFingerprint: "b".repeat(64),
    }),
    null
  );
  assert.equal(
    selectReusableCheckEvidence({ ...common, pullRequestNumber: 416 }),
    null
  );
  assert.equal(
    selectReusableCheckEvidence({ ...common, isAncestor: () => false }),
    null
  );
});

function createCurrentPlan() {
  return {
    baseSha: NEW_BASE_SHA,
    branchName: "codex/people-followup",
    changedPaths: ["clients/web/src/app.tsx"],
    confidence: "standard",
    controlTrust: "current-main",
    selectedChecks: [CHECK],
  };
}

function createEvidence() {
  return {
    baseSha: BASE_SHA,
    branchName: "codex/people-followup",
    candidateKind: "pull-request",
    changedPaths: ["clients/web/src/app.tsx"],
    conclusion: "success",
    confidence: "standard",
    controlTrust: "current-main",
    finishedAt: "2026-08-28T01:00:00.000Z",
    headSha: HEAD_SHA,
    mode: "remote",
    planSourceSha: BASE_SHA,
    publicationErrors: [],
    pullRequestNumber: 415,
    repository: "amplifthq/openmeld",
    results: [
      {
        command: CHECK.command,
        durationMs: 12_345,
        execution: {
          inputFingerprint: FINGERPRINT,
          kind: "executed",
        },
        exitCode: 0,
        id: CHECK.id,
        reason: CHECK.reason,
        spawnError: null,
        status: "passed",
        stderrTail: "",
        stdoutTail: "",
      },
    ],
    selectedChecks: [CHECK],
    treeSha: TREE_SHA,
  };
}
