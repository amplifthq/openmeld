#!/usr/bin/env node

import { existsSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { finalCandidateEvidenceSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import {
  appendWorkflowSummary,
  readEvidence,
  shortSha,
} from "./final-candidate-output.mjs";
import {
  assertCandidateSnapshot,
  evidenceMatchesCandidate,
  FINAL_CANDIDATE_STATUS_CONTEXT,
} from "./final-candidate-policy.mjs";
import {
  publishCommitStatus,
  resolveCandidateState,
} from "./final-candidate-state.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const GITHUB_REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;

function run() {
  const options = parseOptions(process.argv.slice(2));
  const expected = {
    baseSha: requireExactSha("base", options.base),
    headSha: requireExactSha("head", options.head),
    treeSha: requireExactSha("tree", options.tree),
  };
  const pullRequestNumber = requirePullRequestNumber(options.pr);
  const repository = requireRepository(options.repository);
  const candidateJobResult = requireJobResult(options.jobResult);
  const confidence = requireConfidence(options.confidence);
  const targetUrl = requireTargetUrl(options.targetUrl);

  let evidence = null;
  let validationError = null;
  try {
    if (!existsSync(options.evidence)) {
      throw new Error(
        `Candidate evidence artifact is missing at ${options.evidence}.`
      );
    }
    evidence = readEvidence(options.evidence);
    const liveState = resolveCandidateState({
      expectedBaseSha: expected.baseSha,
      expectedHeadSha: expected.headSha,
      pullRequestNumber,
      repository,
    });
    assertCandidateSnapshot(liveState.snapshot);
    if (liveState.snapshot.treeSha !== expected.treeSha) {
      throw new Error(
        `Candidate tree drifted: expected ${expected.treeSha}, found ${liveState.snapshot.treeSha}.`
      );
    }
    assertEvidenceMatchesExecution({
      candidateJobResult,
      confidence,
      evidence,
      expected,
      pullRequestNumber,
      repository,
    });
  } catch (error) {
    validationError = error instanceof Error ? error : new Error(String(error));
  }

  const success = validationError === null;
  const summary = renderPublisherSummary({
    candidateJobResult,
    evidence,
    expected,
    success,
    validationError,
  });
  process.stdout.write(`${summary}\n`);
  appendWorkflowSummary(summary);

  publishCommitStatus({
    description: success
      ? `Passed ${confidence} @ ${shortSha(expected.headSha)} on ${shortSha(expected.baseSha)}`
      : `Failed @ ${shortSha(expected.headSha)} on ${shortSha(expected.baseSha)}; inspect workflow evidence`,
    headSha: expected.headSha,
    repository,
    state: success ? "success" : "failure",
    targetUrl,
  });

  if (!success) {
    throw validationError;
  }
}

function assertEvidenceMatchesExecution(input) {
  const parsed = finalCandidateEvidenceSchema.parse(input.evidence);
  if (input.candidateJobResult !== "success") {
    throw new Error(
      `Candidate job concluded ${input.candidateJobResult}; a failing, canceled, or skipped job cannot publish green.`
    );
  }
  if (parsed.mode !== "remote") {
    throw new Error(
      `Hosted publisher requires remote evidence, found ${parsed.mode}.`
    );
  }
  if (parsed.confidence !== input.confidence) {
    throw new Error(
      `Candidate confidence mismatch: requested ${input.confidence}, evidence recorded ${parsed.confidence}.`
    );
  }
  if (
    parsed.repository !== input.repository ||
    parsed.pullRequestNumber !== input.pullRequestNumber
  ) {
    throw new Error("Candidate evidence belongs to another repository or PR.");
  }
  if (!evidenceMatchesCandidate(parsed, input.expected)) {
    throw new Error(
      "Candidate evidence is not a reusable success for the exact live head, base, and tree."
    );
  }
}

function renderPublisherSummary(input) {
  return [
    "## OpenMeld Final Candidate Publisher",
    "",
    `- Status context: \`${FINAL_CANDIDATE_STATUS_CONTEXT}\``,
    `- Publication result: **${input.success ? "success" : "failure"}**`,
    `- Candidate job: \`${input.candidateJobResult}\``,
    `- Head: \`${input.expected.headSha}\``,
    `- Base: \`${input.expected.baseSha}\``,
    `- Tree: \`${input.expected.treeSha}\``,
    `- Evidence conclusion: \`${input.evidence?.conclusion ?? "missing"}\``,
    ...(input.validationError
      ? [`- Validation error: ${input.validationError.message}`]
      : []),
  ].join("\n");
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option?.startsWith("--")) {
      throw new Error(`Unexpected publisher argument: ${option ?? ""}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    index += 1;
    const name = option.slice(2).replaceAll("-", "_");
    const key = {
      base: "base",
      confidence: "confidence",
      evidence: "evidence",
      head: "head",
      job_result: "jobResult",
      pr: "pr",
      repository: "repository",
      target_url: "targetUrl",
      tree: "tree",
    }[name];
    if (!key) {
      throw new Error(`Unknown publisher option: ${option}`);
    }
    options[key] = value;
  }
  for (const required of [
    "base",
    "confidence",
    "evidence",
    "head",
    "jobResult",
    "pr",
    "repository",
    "targetUrl",
    "tree",
  ]) {
    if (!options[required]) {
      throw new Error(`Final Candidate publisher requires --${required}.`);
    }
  }
  return options;
}

function requireExactSha(name, value) {
  if (!EXACT_SHA_PATTERN.test(String(value ?? ""))) {
    throw new Error(`Final Candidate publisher requires an exact ${name} SHA.`);
  }
  return value;
}

function requirePullRequestNumber(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!(Number.isInteger(parsed) && parsed > 0)) {
    throw new Error("Final Candidate publisher requires a positive PR number.");
  }
  return parsed;
}

function requireRepository(value) {
  if (!GITHUB_REPOSITORY_PATTERN.test(String(value ?? ""))) {
    throw new Error("Final Candidate publisher requires owner/repository.");
  }
  return value;
}

function requireJobResult(value) {
  if (!new Set(["cancelled", "failure", "skipped", "success"]).has(value)) {
    throw new Error(`Unknown candidate job result: ${value}`);
  }
  return value;
}

function requireConfidence(value) {
  if (!(value === "standard" || value === "full")) {
    throw new Error(`Unknown Final Candidate confidence: ${value}`);
  }
  return value;
}

function requireTargetUrl(value) {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error("Final Candidate publisher requires a valid target URL.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
