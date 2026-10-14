#!/usr/bin/env node

import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { finalCandidateEvidenceSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import {
  FINAL_CANDIDATE_RUNNER_CHECK_NAME,
  HOSTED_CONTROL_REFUSE_DISPOSITION,
  HOSTED_CONTROL_REFUSE_SUMMARY,
  HOSTED_CONTROL_REFUSE_TITLE,
  HOSTED_RUN_DISPOSITION,
  resolveHostedFinalCandidateDisposition,
} from "./final-candidate-hosted-disposition.mjs";
import {
  appendWorkflowSummary,
  describeFinalCandidateFailure,
  readEvidence,
  shortSha,
} from "./final-candidate-output.mjs";
import {
  assertCandidateSnapshot,
  createFinalCandidatePlan,
  evidenceMatchesCandidate,
  FINAL_CANDIDATE_STATUS_CONTEXT,
} from "./final-candidate-policy.mjs";
import {
  publishCommitStatus,
  resolveCandidateState,
  resolveChangedPaths,
  updateSkippedCheckRunOutput,
} from "./final-candidate-state.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const GITHUB_REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const TRUSTED_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

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
  const candidateRoot = path.resolve(options.candidateRoot);
  const candidateRef =
    options.outputOnly === "true" ? expected.headSha : undefined;
  const branchName = requireBranch(options.branch);
  const claimedDisposition = requireHostedDisposition(
    options.hostedDisposition
  );

  let evidence = null;
  let validationError = null;
  let trustedDisposition = null;
  try {
    const liveState = resolveCandidateState({
      cwd: candidateRoot,
      expectedBaseSha: expected.baseSha,
      expectedHeadSha: expected.headSha,
      pullRequestNumber,
      repository,
      sourceRef: candidateRef,
    });
    assertCandidateSnapshot(liveState.snapshot, {
      candidateKind: "pull-request",
      requireCurrentBase: false,
    });
    if (liveState.snapshot.treeSha !== expected.treeSha) {
      throw new Error(
        `Candidate tree drifted: expected ${expected.treeSha}, found ${liveState.snapshot.treeSha}.`
      );
    }
    const trustedPlan = createFinalCandidatePlan({
      baseSha: expected.baseSha,
      bootstrapReason: null,
      branchName,
      candidateKind: "pull-request",
      changedPaths: resolveChangedPaths(
        expected.baseSha,
        expected.headSha,
        candidateRoot
      ),
      confidence,
      controlTrust: "current-main",
      headSha: expected.headSha,
      mode: "remote",
      planSourceSha: expected.baseSha,
      treeSha: expected.treeSha,
    });
    trustedDisposition = resolveHostedFinalCandidateDisposition({
      candidateRoot,
      candidateRef,
      trustedRoot: TRUSTED_ROOT,
    });
    if (trustedDisposition.disposition !== claimedDisposition) {
      throw new Error(
        `Hosted Final Candidate disposition drifted: expected ${claimedDisposition}, found ${trustedDisposition.disposition}.`
      );
    }
    if (trustedDisposition.disposition === HOSTED_CONTROL_REFUSE_DISPOSITION) {
      if (candidateJobResult !== "skipped") {
        throw new Error(
          `Control-changing candidates must skip the hosted runner, found ${candidateJobResult}.`
        );
      }
    } else {
      if (!existsSync(options.evidence)) {
        throw new Error(
          `Candidate evidence artifact is missing at ${options.evidence}.`
        );
      }
      evidence = readEvidence(options.evidence);
      assertEvidenceMatchesExecution({
        candidateJobResult,
        confidence,
        evidence,
        expected,
        pullRequestNumber,
        repository,
        trustedPlan,
      });
    }
  } catch (error) {
    validationError = error instanceof Error ? error : new Error(String(error));
  }

  const controlRefuse =
    validationError === null &&
    trustedDisposition?.disposition === HOSTED_CONTROL_REFUSE_DISPOSITION;
  const success = validationError === null && !controlRefuse;
  const summary = renderPublisherSummary({
    candidateJobResult,
    controlRefuse,
    evidence,
    expected,
    success,
    validationError,
  });
  process.stdout.write(`${summary}\n`);
  appendWorkflowSummary(summary);

  if (options.outputOnly === "true") {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `state=${success ? "success" : "failure"}\n`
    );
    const description = resolveStatusDescription({
      baseSha: expected.baseSha,
      confidence,
      controlRefuse,
      evidence,
      headSha: expected.headSha,
      success,
    });
    appendFileSync(process.env.GITHUB_OUTPUT, `description=${description}\n`);
    return finishVerification(validationError);
  }

  if (controlRefuse) {
    updateSkippedCheckRunOutput({
      checkName: FINAL_CANDIDATE_RUNNER_CHECK_NAME,
      headSha: expected.headSha,
      repository,
      summary: HOSTED_CONTROL_REFUSE_SUMMARY,
      targetUrl,
      title: HOSTED_CONTROL_REFUSE_TITLE,
    });
  }

  publishCommitStatus({
    description: resolveStatusDescription({
      baseSha: expected.baseSha,
      confidence,
      controlRefuse,
      evidence,
      headSha: expected.headSha,
      success,
    }),
    headSha: expected.headSha,
    repository,
    state: success ? "success" : "failure",
    targetUrl,
  });

  if (validationError) {
    throw validationError;
  }
}

function finishVerification(error) {
  if (error) {
    throw error;
  }
}

export function assertEvidenceMatchesExecution(input) {
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
  for (const field of [
    "branchName",
    "bootstrapReason",
    "candidateKind",
    "changedPaths",
    "controlTrust",
    "planSourceSha",
    "riskTags",
    "selectedChecks",
    "skippedChecks",
  ]) {
    if (
      JSON.stringify(parsed[field]) !== JSON.stringify(input.trustedPlan[field])
    ) {
      throw new Error(
        `Candidate evidence ${field} does not match the plan recomputed by trusted current main.`
      );
    }
  }
  if (parsed.results.length !== input.trustedPlan.selectedChecks.length) {
    throw new Error(
      "Candidate evidence omitted one or more checks from the trusted current-main plan."
    );
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
    `- Publication result: **${resolvePublicationResult(input)}**`,
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

function resolveStatusDescription(input) {
  if (input.success) {
    return `Passed ${input.confidence} @ ${shortSha(input.headSha)} on ${shortSha(input.baseSha)}`;
  }
  if (input.controlRefuse) {
    return `Control changed @ ${shortSha(input.headSha)}; protected local validation required`;
  }
  return describeFinalCandidateFailure(
    input.headSha,
    input.baseSha,
    input.evidence
  );
}

function resolvePublicationResult(input) {
  if (input.success) {
    return "success";
  }
  return input.controlRefuse
    ? "protected local validation required"
    : "failure";
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
      branch: "branch",
      candidate_root: "candidateRoot",
      confidence: "confidence",
      evidence: "evidence",
      head: "head",
      job_result: "jobResult",
      hosted_disposition: "hostedDisposition",
      pr: "pr",
      repository: "repository",
      target_url: "targetUrl",
      tree: "tree",
      output_only: "outputOnly",
    }[name];
    if (!key) {
      throw new Error(`Unknown publisher option: ${option}`);
    }
    options[key] = value;
  }
  for (const required of [
    "base",
    "branch",
    "candidateRoot",
    "confidence",
    "evidence",
    "head",
    "jobResult",
    "hostedDisposition",
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

function requireBranch(value) {
  const branch = String(value ?? "").trim();
  if (!(branch && branch.length <= 1024)) {
    throw new Error("Final Candidate publisher requires the candidate branch.");
  }
  return branch;
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

function requireHostedDisposition(value) {
  if (
    !(
      value === HOSTED_RUN_DISPOSITION ||
      value === HOSTED_CONTROL_REFUSE_DISPOSITION
    )
  ) {
    throw new Error(`Unknown hosted Final Candidate disposition: ${value}`);
  }
  return value;
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
