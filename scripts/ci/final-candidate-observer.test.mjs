import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildFinalCandidateObservation,
  observationExitCode,
  renderFinalCandidateObservation,
} from "./final-candidate-observer.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const BUDGET_FIXTURE = JSON.parse(
  readFileSync(
    path.join(
      SCRIPT_DIRECTORY,
      "fixtures",
      "github-actions-budget-final-candidate.json"
    ),
    "utf8"
  )
);

const PULL_REQUEST = {
  base: { sha: "dbddbfd609613848e6534a4091affa2781ed7550" },
  head: { sha: BUDGET_FIXTURE.run.head_sha },
  html_url: "https://github.com/amplifthq/openmeld/pull/429",
  number: 429,
};
const HOSTED_BUDGET_PATTERN = /Hosted lane: unavailable \(Actions budget\)/u;
const CHECKS_NOT_STARTED_PATTERN = /Candidate checks started: no/u;
const LOCAL_FALLBACK_PATTERN = /trusted local fallback/u;
const CANDIDATE_FAILURE_PATTERN = /candidate validation failed/iu;
const EXACT_SUCCESS_PATTERN = /Exact status: success/u;
const AVAILABLE_FALLBACK_PATTERN = /Available fallback/u;

test("classifies a captured GitHub Actions budget refusal without blaming candidate code", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(
      Object.entries(BUDGET_FIXTURE.annotationsByCheckRunId).map(
        ([id, annotations]) => [Number(id), annotations]
      )
    ),
    commitStatuses: [],
    jobs: BUDGET_FIXTURE.jobs,
    pullRequest: PULL_REQUEST,
    run: BUDGET_FIXTURE.run,
  });

  assert.equal(observation.state, "hosted-unavailable");
  assert.equal(observation.reason, "actions-budget");
  assert.equal(observation.candidateChecksStarted, false);
  assert.equal(observationExitCode(observation), 3);
  const output = renderFinalCandidateObservation(observation);
  assert.match(output, HOSTED_BUDGET_PATTERN);
  assert.match(output, CHECKS_NOT_STARTED_PATTERN);
  assert.match(output, LOCAL_FALLBACK_PATTERN);
  assert.doesNotMatch(output, CANDIDATE_FAILURE_PATTERN);
});

test("requires the exact shared status before reporting hosted success", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(),
    commitStatuses: [
      {
        context: "OpenMeld Final Candidate",
        description: `Passed executable @ ${PULL_REQUEST.head.sha.slice(0, 12)} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
        state: "success",
        target_url: "https://github.com/amplifthq/openmeld/actions/runs/42",
      },
    ],
    jobs: [
      {
        conclusion: "success",
        id: 1,
        name: "Final Candidate Runner",
        status: "completed",
        steps: [{ conclusion: "success", name: "Validate" }],
      },
    ],
    pullRequest: PULL_REQUEST,
    run: {
      conclusion: "success",
      head_sha: PULL_REQUEST.head.sha,
      html_url: "https://github.com/amplifthq/openmeld/actions/runs/42",
      id: 42,
      status: "completed",
    },
  });

  assert.equal(observation.state, "success");
  assert.equal(observation.reason, "exact-status-success");
  assert.equal(observationExitCode(observation), 0);
});

test("keeps an existing exact success truthful when a later hosted retry hits budget", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(
      Object.entries(BUDGET_FIXTURE.annotationsByCheckRunId).map(
        ([id, annotations]) => [Number(id), annotations]
      )
    ),
    commitStatuses: [
      {
        context: "OpenMeld Final Candidate",
        description: `Passed executable @ ${PULL_REQUEST.head.sha.slice(0, 12)} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
        state: "success",
        target_url: "https://github.com/amplifthq/openmeld/pull/429",
      },
    ],
    jobs: BUDGET_FIXTURE.jobs,
    pullRequest: PULL_REQUEST,
    run: BUDGET_FIXTURE.run,
  });

  assert.equal(observation.state, "success");
  assert.equal(observation.hostedAvailability, "unavailable");
  assert.equal(observationExitCode(observation), 0);
  const output = renderFinalCandidateObservation(observation);
  assert.match(output, HOSTED_BUDGET_PATTERN);
  assert.match(output, EXACT_SUCCESS_PATTERN);
  assert.doesNotMatch(output, AVAILABLE_FALLBACK_PATTERN);
});

test("rejects a green status that belongs to an older validation base", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(),
    commitStatuses: [
      {
        context: "OpenMeld Final Candidate",
        description: `Passed executable @ ${PULL_REQUEST.head.sha.slice(0, 12)} on 111111111111`,
        state: "success",
      },
    ],
    jobs: [],
    pullRequest: PULL_REQUEST,
    run: {
      conclusion: "success",
      head_sha: PULL_REQUEST.head.sha,
      html_url: "https://github.com/amplifthq/openmeld/actions/runs/44",
      id: 44,
      status: "completed",
    },
  });

  assert.equal(observation.state, "failure");
  assert.equal(observation.exactStatus, "stale-success");
  assert.equal(observation.reason, "exact-status-stale");
});

test("keeps a completed run without exact status visibly failed", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(),
    commitStatuses: [],
    jobs: [],
    pullRequest: PULL_REQUEST,
    run: {
      conclusion: "success",
      head_sha: PULL_REQUEST.head.sha,
      html_url: "https://github.com/amplifthq/openmeld/actions/runs/43",
      id: 43,
      status: "completed",
    },
  });

  assert.equal(observation.state, "failure");
  assert.equal(observation.reason, "exact-status-missing");
  assert.equal(observationExitCode(observation), 1);
});
