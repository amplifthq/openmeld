import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTurboTaskPlanCommand,
  computeReusableCheckFingerprint,
  resolveReusableTaskPlans,
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
const INTEGRATION_CHECK = {
  command: [
    "pnpm",
    "run",
    "test:integration:affected",
    "--",
    "--concurrency=1",
    "--output-logs=errors-only",
  ],
  id: "affected-integration-tests",
  reason: "A shared, service, runtime, or persistence boundary changed.",
};

test("only deterministic affected task families are eligible for reuse", () => {
  assert.deepEqual(resolveReusableTaskPlans(CHECK.id), [
    { changedOnly: true, task: "check", turboArgs: ["--concurrency=2"] },
    { changedOnly: true, task: "test", turboArgs: ["--concurrency=2"] },
  ]);
  assert.deepEqual(resolveReusableTaskPlans(INTEGRATION_CHECK.id), [
    {
      changedOnly: false,
      task: "test:integration",
      turboArgs: ["--concurrency=1", "--output-logs=errors-only"],
    },
  ]);
  assert.equal(resolveReusableTaskPlans("database-contract"), null);
  assert.equal(
    resolveReusableTaskPlans("local-components-release-ready"),
    null
  );
});

test("integration reuse reconstructs the real affected-and-dependent command", () => {
  assert.deepEqual(
    buildTurboTaskPlanCommand({
      changedOnly: false,
      task: "test:integration",
      turboArgs: ["--concurrency=1", "--output-logs=errors-only"],
    }),
    [
      process.execPath,
      "scripts/dev/turbo-affected.mjs",
      "test:integration",
      "--",
      "--dry=json",
      "--concurrency=1",
      "--output-logs=errors-only",
    ]
  );
  assert.deepEqual(
    buildTurboTaskPlanCommand({
      changedOnly: true,
      task: "test",
      turboArgs: ["--concurrency=2"],
    }),
    [
      process.execPath,
      "scripts/dev/turbo-affected.mjs",
      "--changed-only",
      "test",
      "--",
      "--dry=json",
      "--concurrency=2",
    ]
  );
});

test("reusable task fingerprints ignore task order but change with a real task input", () => {
  const first = computeReusableCheckFingerprint({
    check: CHECK,
    runtime: { nodeVersion: "v24.1.0", platform: "linux" },
    taskPlans: [
      {
        changedOnly: true,
        task: "check",
        tasks: [
          { hash: "check-b", taskId: "web#check" },
          { hash: "check-a", taskId: "schemas#check" },
        ],
        turboVersion: "2.5.6",
        turboArgs: ["--concurrency=2"],
      },
      {
        changedOnly: true,
        task: "test",
        tasks: [{ hash: "test-a", taskId: "web#test" }],
        turboVersion: "2.5.6",
        turboArgs: ["--concurrency=2"],
      },
    ],
  });
  const reordered = computeReusableCheckFingerprint({
    check: CHECK,
    runtime: { nodeVersion: "v24.1.0", platform: "linux" },
    taskPlans: [
      {
        changedOnly: true,
        task: "test",
        tasks: [{ hash: "test-a", taskId: "web#test" }],
        turboVersion: "2.5.6",
        turboArgs: ["--concurrency=2"],
      },
      {
        changedOnly: true,
        task: "check",
        tasks: [
          { hash: "check-a", taskId: "schemas#check" },
          { hash: "check-b", taskId: "web#check" },
        ],
        turboVersion: "2.5.6",
        turboArgs: ["--concurrency=2"],
      },
    ],
  });
  const changed = computeReusableCheckFingerprint({
    check: CHECK,
    runtime: { nodeVersion: "v24.1.0", platform: "linux" },
    taskPlans: [
      {
        changedOnly: true,
        task: "check",
        tasks: [
          { hash: "check-a", taskId: "schemas#check" },
          { hash: "check-changed", taskId: "web#check" },
        ],
        turboVersion: "2.5.6",
        turboArgs: ["--concurrency=2"],
      },
      {
        changedOnly: true,
        task: "test",
        tasks: [{ hash: "test-a", taskId: "web#test" }],
        turboVersion: "2.5.6",
        turboArgs: ["--concurrency=2"],
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
          changedOnly: true,
          task: "check",
          tasks: [
            { hash: "check-a", taskId: "schemas#check" },
            { hash: "check-b", taskId: "web#check" },
          ],
          turboVersion: "2.5.6",
          turboArgs: ["--concurrency=2"],
        },
        {
          changedOnly: true,
          task: "test",
          tasks: [{ hash: "test-a", taskId: "web#test" }],
          turboVersion: "2.5.6",
          turboArgs: ["--concurrency=2"],
        },
      ],
    })
  );
});

test("an unrelated base advance reuses integration evidence but changed integration inputs rerun", () => {
  const runtime = {
    architecture: "x64",
    nodeVersion: "v24.1.0",
    platform: "linux",
    runnerImage: "20260825.1",
    runnerOs: "Linux",
  };
  const unchangedTaskPlans = [
    {
      changedOnly: false,
      task: "test:integration",
      tasks: [
        {
          hash: "core-integration-a",
          taskId: "@openmeld/core#test:integration",
        },
        { hash: "web-integration-a", taskId: "openmeld-web#test:integration" },
      ],
      turboVersion: "2.9.6",
      turboArgs: ["--concurrency=1", "--output-logs=errors-only"],
    },
  ];
  const inputFingerprint = computeReusableCheckFingerprint({
    check: INTEGRATION_CHECK,
    runtime,
    taskPlans: unchangedTaskPlans,
  });
  const evidence = createEvidence({
    check: INTEGRATION_CHECK,
    inputFingerprint,
  });
  const common = {
    check: INTEGRATION_CHECK,
    currentPlan: createCurrentPlan(INTEGRATION_CHECK),
    evidenceCandidates: [evidence],
    isAncestor: (ancestor, descendant) =>
      ancestor === BASE_SHA && descendant === NEW_BASE_SHA,
    pullRequestNumber: 415,
    repository: "amplifthq/openmeld",
  };

  assert.deepEqual(
    selectReusableCheckEvidence({ ...common, inputFingerprint }),
    {
      baseSha: BASE_SHA,
      durationMs: 12_345,
      finishedAt: evidence.finishedAt,
      headSha: HEAD_SHA,
      treeSha: TREE_SHA,
    }
  );

  const changedInputFingerprint = computeReusableCheckFingerprint({
    check: INTEGRATION_CHECK,
    runtime,
    taskPlans: [
      {
        ...unchangedTaskPlans[0],
        tasks: [
          unchangedTaskPlans[0].tasks[0],
          {
            hash: "web-integration-changed",
            taskId: "openmeld-web#test:integration",
          },
        ],
      },
    ],
  });
  assert.equal(
    selectReusableCheckEvidence({
      ...common,
      inputFingerprint: changedInputFingerprint,
    }),
    null
  );
});

test("a passed integration result remains reusable when a later check or publication failed", () => {
  const evidence = createEvidence({
    check: INTEGRATION_CHECK,
    inputFingerprint: FINGERPRINT,
  });
  evidence.conclusion = "failure";
  evidence.error = "database-contract failed";
  evidence.publicationErrors = [
    {
      message: "Could not publish the final comment.",
      occurredAt: "2026-08-28T01:00:01.000Z",
      operation: "final-comment",
    },
  ];
  evidence.selectedChecks.push({
    command: ["pnpm", "run", "verify:database-contract"],
    id: "database-contract",
    reason: "Database ownership changed.",
  });
  evidence.results.push({
    command: ["pnpm", "run", "verify:database-contract"],
    durationMs: 50,
    execution: { kind: "executed" },
    exitCode: 1,
    id: "database-contract",
    reason: "Database ownership changed.",
    spawnError: null,
    status: "failed",
    stderrTail: "database contract failed",
    stdoutTail: "",
  });

  assert.notEqual(
    selectReusableCheckEvidence({
      check: INTEGRATION_CHECK,
      currentPlan: createCurrentPlan(INTEGRATION_CHECK),
      evidenceCandidates: [evidence],
      inputFingerprint: FINGERPRINT,
      isAncestor: () => true,
      pullRequestNumber: 415,
      repository: "amplifthq/openmeld",
    }),
    null
  );

  evidence.results[0].status = "failed";
  evidence.results[0].exitCode = 1;
  assert.equal(
    selectReusableCheckEvidence({
      check: INTEGRATION_CHECK,
      currentPlan: createCurrentPlan(INTEGRATION_CHECK),
      evidenceCandidates: [evidence],
      inputFingerprint: FINGERPRINT,
      isAncestor: () => true,
      pullRequestNumber: 415,
      repository: "amplifthq/openmeld",
    }),
    null
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

function createCurrentPlan(check = CHECK) {
  return {
    baseSha: NEW_BASE_SHA,
    branchName: "codex/people-followup",
    changedPaths: ["clients/web/src/app.tsx"],
    confidence: "standard",
    controlTrust: "current-main",
    selectedChecks: [check],
  };
}

function createEvidence({
  check = CHECK,
  inputFingerprint = FINGERPRINT,
} = {}) {
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
        command: check.command,
        durationMs: 12_345,
        execution: {
          inputFingerprint,
          kind: "executed",
        },
        exitCode: 0,
        id: check.id,
        reason: check.reason,
        spawnError: null,
        status: "passed",
        stderrTail: "",
        stdoutTail: "",
      },
    ],
    selectedChecks: [check],
    treeSha: TREE_SHA,
  };
}
