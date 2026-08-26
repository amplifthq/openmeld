import assert from "node:assert/strict";
import test from "node:test";

import { FINAL_CANDIDATE_EVIDENCE_VERSION } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import { createFinalCandidatePlan } from "./final-candidate-policy.mjs";
import { assertEvidenceMatchesExecution } from "./final-candidate-publisher.mjs";

const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const TREE_SHA = "3".repeat(40);
const trustedPlan = createFinalCandidatePlan({
  baseSha: BASE_SHA,
  branchName: "codex/malicious-candidate",
  changedPaths: ["clients/web/src/app.tsx"],
  confidence: "standard",
  headSha: HEAD_SHA,
  mode: "remote",
  planSourceSha: BASE_SHA,
  treeSha: TREE_SHA,
});

test("trusted publisher accepts only the complete current-main plan", () => {
  assert.doesNotThrow(() =>
    assertEvidenceMatchesExecution(createInput(createEvidence()))
  );
});

test("schema-valid-looking empty success evidence cannot publish green", () => {
  const evidence = {
    ...createEvidence(),
    results: [],
    selectedChecks: [],
  };

  assert.throws(
    () => assertEvidenceMatchesExecution(createInput(evidence)),
    /requires at least one selected check|one result for every selected check/u
  );
});

test("omitted or rewritten selected checks cannot publish green", () => {
  const omitted = createEvidence();
  omitted.selectedChecks = omitted.selectedChecks.slice(0, -1);
  omitted.results = omitted.results.slice(0, -1);
  assert.throws(
    () => assertEvidenceMatchesExecution(createInput(omitted)),
    /does not match the plan recomputed by trusted current main/u
  );

  const rewritten = createEvidence();
  rewritten.selectedChecks[1] = {
    ...rewritten.selectedChecks[1],
    command: ["true"],
  };
  rewritten.results[1] = {
    ...rewritten.results[1],
    command: ["true"],
  };
  assert.throws(
    () => assertEvidenceMatchesExecution(createInput(rewritten)),
    /does not match the plan recomputed by trusted current main/u
  );
});

function createInput(evidence) {
  return {
    candidateJobResult: "success",
    confidence: "standard",
    evidence,
    expected: {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      treeSha: TREE_SHA,
    },
    pullRequestNumber: 325,
    repository: "amplifthq/openmeld",
    trustedPlan,
  };
}

function createEvidence() {
  return {
    baseSha: BASE_SHA,
    branchName: trustedPlan.branchName,
    changedPaths: trustedPlan.changedPaths,
    conclusion: "success",
    confidence: "standard",
    error: null,
    finishedAt: "2026-08-26T00:00:01.000Z",
    headSha: HEAD_SHA,
    mode: "remote",
    planSourceSha: BASE_SHA,
    publicationErrors: [],
    pullRequestNumber: 325,
    pullRequestUrl: "https://github.com/amplifthq/openmeld/pull/325",
    repository: "amplifthq/openmeld",
    results: trustedPlan.selectedChecks.map((selectedCheck) => ({
      ...selectedCheck,
      durationMs: 1,
      exitCode: 0,
      spawnError: null,
      status: "passed",
      stderrTail: "",
      stdoutTail: "",
    })),
    riskTags: trustedPlan.riskTags,
    schemaVersion: FINAL_CANDIDATE_EVIDENCE_VERSION,
    selectedChecks: structuredClone(trustedPlan.selectedChecks),
    skippedChecks: trustedPlan.skippedChecks,
    startedAt: "2026-08-26T00:00:00.000Z",
    treeSha: TREE_SHA,
  };
}
