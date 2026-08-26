import assert from "node:assert/strict";
import test from "node:test";

import { FINAL_CANDIDATE_EVIDENCE_VERSION } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";

import {
  assertCandidateSnapshot,
  createFinalCandidatePlan,
  evidenceMatchesCandidate,
  executeCandidateChecks,
} from "./final-candidate-policy.mjs";

const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const TREE_SHA = "3".repeat(40);
const DIRTY_WORKTREE_PATTERN = /worktree is dirty/u;
const MAIN_ADVANCED_PATTERN = /Main advanced/u;
const MISSING_ANCESTRY_PATTERN = /does not contain current main/u;
const NO_EXECUTABLE_SOURCE_PATTERN = /No executable workspace source/u;
const PULL_REQUEST_HEAD_DRIFT_PATTERN = /Pull request head drifted/u;

const createPlan = (changedPaths, overrides = {}) =>
  createFinalCandidatePlan({
    baseSha: BASE_SHA,
    branchName: "codex/example",
    changedPaths,
    headSha: HEAD_SHA,
    treeSha: TREE_SHA,
    ...overrides,
  });

const checkIds = (plan) => plan.selectedChecks.map((check) => check.id);

test("selects a cheap documentation-only gate without pretending unit tests add value", () => {
  const plan = createPlan(["AGENTS.md", "developing/README.md"]);

  assert.deepEqual(checkIds(plan), [
    "diff-integrity",
    "documentation-contracts",
  ]);
  assert.deepEqual(plan.riskTags, ["documentation"]);
  assert.match(
    plan.skippedChecks.find(
      (check) => check.id === "affected-checks-and-unit-tests"
    ).reason,
    NO_EXECUTABLE_SOURCE_PATTERN
  );
});

test("keeps unit tests for ordinary executable changes", () => {
  const plan = createPlan(["clients/web/src/app.tsx"]);

  assert.deepEqual(checkIds(plan), [
    "diff-integrity",
    "repository-contracts",
    "affected-checks-and-unit-tests",
  ]);
  assert.ok(
    plan.selectedChecks
      .find((check) => check.id === "affected-checks-and-unit-tests")
      .reason.includes("independent defect-finding value")
  );
  assert.ok(!checkIds(plan).includes("affected-integration-tests"));
});

test("adds integration, database, and deferred release gates for a shared schema change", () => {
  const plan = createPlan([
    "packages/db/drizzle/0129_example.sql",
    "packages/schemas/src/http/example.ts",
  ]);

  assert.deepEqual(checkIds(plan), [
    "diff-integrity",
    "repository-contracts",
    "affected-checks-and-unit-tests",
    "affected-integration-tests",
    "database-contract",
    "local-components-release-ready",
  ]);
  assert.deepEqual(
    plan.selectedChecks.find(
      (check) => check.id === "local-components-release-ready"
    ).command,
    [
      "pnpm",
      "run",
      "verify:release-ready",
      "--",
      "--defer-release",
      "--base",
      BASE_SHA,
    ]
  );
  assert.deepEqual(plan.riskTags, [
    "executable",
    "cross-boundary",
    "database",
    "local-components",
  ]);
});

test("uses strict release-ready verification only on an exact versioned release branch", () => {
  const plan = createPlan(
    ["clients/openmeld-cli/package.json", "release/local-components.json"],
    { branchName: "codex/release-0.4.0-1234abcd" }
  );

  assert.deepEqual(
    plan.selectedChecks.find(
      (check) => check.id === "local-components-release-ready"
    ).command,
    ["pnpm", "run", "verify:release-ready"]
  );
});

test("delivery infrastructure runs its behavior contracts without an empty Turbo lane", () => {
  const plan = createPlan([
    ".github/workflows/final-candidate.yml",
    "scripts/ci/final-candidate.mjs",
  ]);

  assert.deepEqual(checkIds(plan), [
    "diff-integrity",
    "repository-code-quality",
    "repository-contracts",
  ]);
  assert.ok(plan.riskTags.includes("delivery-infrastructure"));
});

test("a scripts and Web mixed diff keeps affected checks and unit tests", () => {
  const plan = createPlan([
    "scripts/ci/final-candidate.mjs",
    "clients/web/src/app.tsx",
  ]);

  assert.deepEqual(checkIds(plan), [
    "diff-integrity",
    "repository-code-quality",
    "repository-contracts",
    "affected-checks-and-unit-tests",
  ]);
});

test("a package manifest and product mixed diff keeps affected checks and unit tests", () => {
  const plan = createPlan(["package.json", "services/core/src/index.ts"]);

  assert.ok(checkIds(plan).includes("affected-checks-and-unit-tests"));
  assert.ok(checkIds(plan).includes("affected-integration-tests"));
});

test("a pure delivery infrastructure diff skips only the empty affected lane", () => {
  const plan = createPlan(["package.json", "scripts/ci/final-candidate.mjs"]);

  assert.ok(!checkIds(plan).includes("affected-checks-and-unit-tests"));
  assert.ok(
    plan.skippedChecks.some(
      (entry) => entry.id === "affected-checks-and-unit-tests"
    )
  );
});

test("an explicitly stronger plan replaces affected lanes with full confidence", () => {
  const plan = createPlan(["clients/web/src/app.tsx"], {
    confidence: "full",
  });

  assert.deepEqual(checkIds(plan), [
    "diff-integrity",
    "repository-contracts",
    "full-repository-confidence",
  ]);
  assert.ok(plan.riskTags.includes("full-confidence"));
});

test("candidate state rejects stale head, stale main, missing ancestry, and dirty trees", () => {
  const valid = {
    actualHeadSha: HEAD_SHA,
    baseIsAncestorOfHead: true,
    currentMainSha: BASE_SHA,
    dirtyPaths: [],
    expectedBaseSha: BASE_SHA,
    expectedHeadSha: HEAD_SHA,
    pullRequestBaseRef: "main",
    pullRequestBaseSha: BASE_SHA,
    pullRequestDraft: false,
    pullRequestHeadSha: HEAD_SHA,
    pullRequestState: "open",
    treeSha: TREE_SHA,
  };

  assert.doesNotThrow(() => assertCandidateSnapshot(valid));
  assert.throws(
    () =>
      assertCandidateSnapshot({
        ...valid,
        pullRequestHeadSha: "4".repeat(40),
      }),
    PULL_REQUEST_HEAD_DRIFT_PATTERN
  );
  assert.throws(
    () =>
      assertCandidateSnapshot({
        ...valid,
        currentMainSha: "5".repeat(40),
      }),
    MAIN_ADVANCED_PATTERN
  );
  assert.throws(
    () => assertCandidateSnapshot({ ...valid, baseIsAncestorOfHead: false }),
    MISSING_ANCESTRY_PATTERN
  );
  assert.throws(
    () => assertCandidateSnapshot({ ...valid, dirtyPaths: ["changed.ts"] }),
    DIRTY_WORKTREE_PATTERN
  );
});

test("a real command failure blocks the candidate and stops later checks", () => {
  const executed = [];
  let clock = 0;
  const result = executeCandidateChecks(
    [
      { command: ["first"], id: "first", reason: "first" },
      { command: ["fails"], id: "fails", reason: "fails" },
      { command: ["never"], id: "never", reason: "never" },
    ],
    {
      now: () => {
        clock += 10;
        return clock;
      },
      runCommand: (command) => {
        executed.push(command[0]);
        return {
          spawnError: null,
          status: command[0] === "fails" ? 7 : 0,
          stderrTail: command[0] === "fails" ? "real failure\n" : "",
          stdoutTail: "",
        };
      },
    }
  );

  assert.equal(result.conclusion, "failure");
  assert.equal(result.failedCheckId, "fails");
  assert.deepEqual(executed, ["first", "fails"]);
  assert.deepEqual(
    result.results.map((check) => check.status),
    ["passed", "failed"]
  );
  assert.equal(result.results.at(-1).exitCode, 7);
  assert.equal(result.results.at(-1).stderrTail, "real failure\n");
});

test("a command spawn error is preserved as the failed check cause", () => {
  let clock = 0;
  const result = executeCandidateChecks(
    [{ command: ["missing-command"], id: "spawn", reason: "spawn" }],
    {
      now: () => {
        clock += 5;
        return clock;
      },
      runCommand: () => {
        throw new Error("spawn ENOENT");
      },
    }
  );

  assert.equal(result.conclusion, "failure");
  assert.equal(result.results[0].status, "failed");
  assert.equal(result.results[0].exitCode, null);
  assert.equal(result.results[0].spawnError, "spawn ENOENT");
  assert.equal(result.results[0].durationMs, 5);
});

test("evidence is reusable only for the same successful head, base, and tree", () => {
  const evidence = {
    baseSha: BASE_SHA,
    branchName: "codex/example",
    changedPaths: ["clients/web/src/app.tsx"],
    conclusion: "success",
    confidence: "standard",
    error: null,
    finishedAt: "2026-08-26T00:00:01.000Z",
    headSha: HEAD_SHA,
    mode: "local",
    publicationErrors: [],
    pullRequestNumber: 1,
    pullRequestUrl: "https://github.com/amplifthq/openmeld/pull/1",
    repository: "amplifthq/openmeld",
    results: [],
    riskTags: ["executable"],
    schemaVersion: FINAL_CANDIDATE_EVIDENCE_VERSION,
    selectedChecks: [],
    skippedChecks: [],
    startedAt: "2026-08-26T00:00:00.000Z",
    treeSha: TREE_SHA,
  };

  assert.equal(
    evidenceMatchesCandidate(evidence, {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      treeSha: TREE_SHA,
    }),
    true
  );
  assert.equal(
    evidenceMatchesCandidate(evidence, {
      baseSha: "6".repeat(40),
      headSha: HEAD_SHA,
      treeSha: TREE_SHA,
    }),
    false
  );
  assert.equal(
    evidenceMatchesCandidate(evidence, {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      treeSha: "7".repeat(40),
    }),
    false
  );
  assert.equal(
    evidenceMatchesCandidate(
      { ...evidence, conclusion: "failure" },
      { baseSha: BASE_SHA, headSha: HEAD_SHA, treeSha: TREE_SHA }
    ),
    false
  );
  assert.equal(
    evidenceMatchesCandidate(
      {
        ...evidence,
        publicationErrors: [
          {
            message: "status API unavailable",
            occurredAt: "2026-08-26T00:00:02.000Z",
            operation: "final-status",
          },
        ],
      },
      { baseSha: BASE_SHA, headSha: HEAD_SHA, treeSha: TREE_SHA }
    ),
    false
  );
});
