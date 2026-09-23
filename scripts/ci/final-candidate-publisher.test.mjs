import assert from "node:assert/strict";
import test from "node:test";

import { FINAL_CANDIDATE_EVIDENCE_VERSION } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import {
  describeFinalCandidateFailure,
  shouldFailPublisherJob,
} from "./final-candidate-output.mjs";
import { createFinalCandidatePlan } from "./final-candidate-policy.mjs";
import { assertEvidenceMatchesExecution } from "./final-candidate-publisher.mjs";

const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const TREE_SHA = "3".repeat(40);
const EMPTY_EVIDENCE_PATTERN =
  /requires at least one selected check|one result for every selected check/u;
const TRUSTED_PLAN_MISMATCH_PATTERN =
  /does not match the plan recomputed by trusted current main/u;
const CONTROL_REFUSE_STATUS_PATTERN =
  /Control drifted @ 222222222222 on 111111111111; use local explicit bootstrap/u;
const PRODUCT_FAILURE_STATUS_PATTERN =
  /Failed @ 222222222222 on 111111111111; inspect evidence/u;
const trustedPlan = createFinalCandidatePlan({
  baseSha: BASE_SHA,
  branchName: "codex/malicious-candidate",
  candidateKind: "pull-request",
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
    EMPTY_EVIDENCE_PATTERN
  );
});

test("omitted or rewritten selected checks cannot publish green", () => {
  const omitted = createEvidence();
  omitted.selectedChecks = omitted.selectedChecks.slice(0, -1);
  omitted.results = omitted.results.slice(0, -1);
  assert.throws(
    () => assertEvidenceMatchesExecution(createInput(omitted)),
    TRUSTED_PLAN_MISMATCH_PATTERN
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
    TRUSTED_PLAN_MISMATCH_PATTERN
  );
});

test("control refuse publishes one honest status instead of a second product-test failure", () => {
  const evidence = createEvidence();
  const controlCheck = evidence.results.find(
    (result) => result.id === "trusted-control-entrypoints"
  );
  assert.ok(controlCheck);
  controlCheck.status = "failed";
  controlCheck.exitCode = 1;
  controlCheck.stderrTail =
    "Hosted Final Candidate cannot let the candidate rewrite its own test-control entrypoints.";

  assert.equal(shouldFailPublisherJob(false, evidence), false);
  assert.match(
    describeFinalCandidateFailure(HEAD_SHA, BASE_SHA, evidence),
    CONTROL_REFUSE_STATUS_PATTERN
  );
});

test("a product-test failure still fails the publisher job", () => {
  const evidence = createEvidence();
  const contracts = evidence.results.find(
    (result) => result.id === "repository-contracts"
  );
  assert.ok(contracts);
  contracts.status = "failed";
  contracts.exitCode = 1;

  assert.equal(shouldFailPublisherJob(false, evidence), true);
  assert.match(
    describeFinalCandidateFailure(HEAD_SHA, BASE_SHA, evidence),
    PRODUCT_FAILURE_STATUS_PATTERN
  );
});

test("a candidate cannot publish green while required contracts are absent or failed", () => {
  const missing = createEvidence();
  missing.selectedChecks = missing.selectedChecks.filter(
    (check) => check.id !== "repository-contracts"
  );
  missing.results = missing.results.filter(
    (result) => result.id !== "repository-contracts"
  );
  assert.throws(() => assertEvidenceMatchesExecution(createInput(missing)));

  const failed = createEvidence();
  const tests = failed.results.find(
    (result) => result.id === "repository-contracts"
  );
  assert.ok(tests);
  tests.status = "failed";
  tests.exitCode = 1;
  assert.throws(() => assertEvidenceMatchesExecution(createInput(failed)));
});

function createInput(evidence) {
  return {
    candidateJobResult: "success",
    confidence: "standard",
    controlTrust: "current-main",
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
    bootstrapReason: null,
    branchName: trustedPlan.branchName,
    candidateKind: "pull-request",
    changedPaths: trustedPlan.changedPaths,
    conclusion: "success",
    confidence: "standard",
    controlTrust: "current-main",
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
      execution: { inputFingerprint: null, kind: "executed" },
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
