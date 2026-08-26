#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  appendWorkflowSummary,
  printPlan,
  renderEvidenceSummary,
  resolveEvidencePath,
  resolveTargetUrl,
  shortSha,
  summarizeRisk,
  writeEvidence,
} from "./final-candidate-output.mjs";
import {
  assertCandidateSnapshot,
  createFinalCandidatePlan,
  executeCandidateChecks,
  FINAL_CANDIDATE_EVIDENCE_VERSION,
  FINAL_CANDIDATE_LABEL,
  formatCommand,
} from "./final-candidate-policy.mjs";
import {
  publishCommitStatus,
  publishPullRequestComment,
  resolveBranchName,
  resolveCandidateState,
  resolveChangedPaths,
  resolveCommit,
  resolveDirtyPaths,
  resolveObject,
  resolveRepository,
  runGh,
  runGhJson,
} from "./final-candidate-state.mjs";

const pnpmBinary = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run() {
  const [command = "help", ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === "help" || options.help) {
    printHelp();
    return;
  }
  if (command === "plan") {
    runPlan(options);
    return;
  }
  if (command === "request") {
    requestRemoteCandidate(options);
    return;
  }
  if (command === "run") {
    runCandidate(options);
    return;
  }
  throw new Error(`Unknown Final Candidate command: ${command}`);
}

function runPlan(options) {
  const headSha = resolveCommit(options.head ?? "HEAD");
  const baseSha = resolveCommit(options.base ?? "origin/main");
  const treeSha = resolveObject(`${headSha}^{tree}`);
  const branchName = options.branch ?? resolveBranchName();
  const dirtyPaths = resolveDirtyPaths();
  const changedPaths = [
    ...new Set([...resolveChangedPaths(baseSha, headSha), ...dirtyPaths]),
  ].toSorted();
  const plan = createFinalCandidatePlan({
    baseSha,
    branchName,
    changedPaths,
    confidence: options.confidence,
    headSha,
    treeSha,
  });
  printPlan(plan, dirtyPaths);
}

function requestRemoteCandidate(options) {
  const pullRequestNumber = requirePullRequestNumber(options.pr);
  const repository = resolveRepository(options.repository);
  const state = resolveCandidateState({
    expectedBaseSha: options.base,
    expectedHeadSha: options.head,
    pullRequestNumber,
    repository,
  });
  assertCandidateSnapshot(state.snapshot);
  const plan = createFinalCandidatePlan({
    baseSha: state.snapshot.expectedBaseSha,
    branchName: options.branch ?? state.pullRequest.head.ref,
    changedPaths: resolveChangedPaths(
      state.snapshot.expectedBaseSha,
      state.snapshot.expectedHeadSha
    ),
    confidence: options.confidence,
    headSha: state.snapshot.expectedHeadSha,
    treeSha: state.snapshot.treeSha,
  });
  printPlan(plan, []);

  const labels = state.pullRequest.labels.map((label) => label.name);
  if (labels.includes(FINAL_CANDIDATE_LABEL)) {
    runGh([
      "api",
      "--method",
      "DELETE",
      `repos/${repository}/issues/${pullRequestNumber}/labels/${FINAL_CANDIDATE_LABEL}`,
    ]);
    process.stdout.write(
      `Reset label ${FINAL_CANDIDATE_LABEL} so this explicit request creates a new run.\n`
    );
  }
  runGhJson(
    [
      "api",
      "--method",
      "POST",
      `repos/${repository}/issues/${pullRequestNumber}/labels`,
      "--input",
      "-",
    ],
    { labels: [FINAL_CANDIDATE_LABEL] }
  );
  process.stdout.write(
    [
      "Remote Final Candidate requested.",
      `PR: ${state.pullRequest.html_url}`,
      `Head: ${state.snapshot.expectedHeadSha}`,
      `Base: ${state.snapshot.expectedBaseSha}`,
      "No check result exists yet. Follow the workflow run and require its exact commit status before merge.",
      "",
    ].join("\n")
  );
}

function runCandidate(options) {
  const context = createRunContext(options);
  let evidence;
  let originalError = null;

  try {
    prepareCandidateRun(context);
    evidence = executePreparedCandidate(context);
  } catch (error) {
    originalError = error;
    evidence = createFailureEvidence(context, error);
  }

  const evidencePath = resolveEvidencePath(
    options.evidence,
    evidence.headSha ?? options.head
  );
  writeEvidence(evidencePath, evidence);
  const summary = renderEvidenceSummary(evidence, evidencePath);
  process.stdout.write(`${summary}\n`);
  appendWorkflowSummary(summary);
  publishFinalEvidence(context, evidence, summary);

  if (originalError) {
    throw originalError;
  }
}

function createRunContext(options) {
  const pullRequestNumber = requirePullRequestNumber(options.pr);
  const repository = resolveRepository(options.repository);
  const mode = options.mode ?? "local";
  if (!(mode === "local" || mode === "remote")) {
    throw new Error(
      `Final Candidate mode must be local or remote, found ${mode}.`
    );
  }
  return {
    mode,
    options,
    plan: null,
    publishStatus: options.publishStatus ?? false,
    pullRequestNumber,
    repository,
    startedAt: new Date(),
    state: null,
    targetUrl: null,
  };
}

function prepareCandidateRun(context) {
  context.state = resolveCandidateState({
    expectedBaseSha: context.options.base,
    expectedHeadSha: context.options.head,
    pullRequestNumber: context.pullRequestNumber,
    repository: context.repository,
  });
  assertCandidateSnapshot(context.state.snapshot);
  context.plan = createFinalCandidatePlan({
    baseSha: context.state.snapshot.expectedBaseSha,
    branchName: context.options.branch ?? context.state.pullRequest.head.ref,
    changedPaths: resolveChangedPaths(
      context.state.snapshot.expectedBaseSha,
      context.state.snapshot.expectedHeadSha
    ),
    confidence: context.options.confidence,
    headSha: context.state.snapshot.expectedHeadSha,
    treeSha: context.state.snapshot.treeSha,
  });
  printPlan(context.plan, []);
  context.targetUrl = resolveTargetUrl(
    context.mode,
    context.repository,
    context.state.pullRequest.html_url
  );
  if (context.publishStatus) {
    publishCommitStatus({
      description: `Running ${summarizeRisk(context.plan.riskTags)} @ ${shortSha(context.plan.headSha)} on ${shortSha(context.plan.baseSha)}`,
      headSha: context.plan.headSha,
      repository: context.repository,
      state: "pending",
      targetUrl: context.targetUrl,
    });
  }
}

function executePreparedCandidate(context) {
  const execution = executeCandidateChecks(context.plan.selectedChecks, {
    now: () => Date.now(),
    runCommand: runCandidateCommand,
  });
  if (execution.conclusion !== "success") {
    throw new CandidateCheckError(
      `Final Candidate failed at ${execution.failedCheckId}.`,
      execution
    );
  }

  const finalState = resolveCandidateState({
    expectedBaseSha: context.plan.baseSha,
    expectedHeadSha: context.plan.headSha,
    pullRequestNumber: context.pullRequestNumber,
    repository: context.repository,
  });
  assertCandidateSnapshot(finalState.snapshot);
  if (finalState.snapshot.treeSha !== context.plan.treeSha) {
    throw new Error(
      `Candidate tree drifted: expected ${context.plan.treeSha}, found ${finalState.snapshot.treeSha}.`
    );
  }

  return createEvidence({
    conclusion: "success",
    execution,
    finishedAt: new Date(),
    mode: context.mode,
    plan: context.plan,
    pullRequest: context.state.pullRequest,
    repository: context.repository,
    startedAt: context.startedAt,
  });
}

function createFailureEvidence(context, error) {
  const execution =
    error instanceof CandidateCheckError
      ? error.execution
      : { conclusion: "failure", failedCheckId: null, results: [] };
  return {
    baseSha:
      context.state?.snapshot.expectedBaseSha ?? context.options.base ?? null,
    branchName: context.plan?.branchName ?? context.options.branch ?? null,
    changedPaths: context.plan?.changedPaths ?? [],
    conclusion: "failure",
    confidence: context.plan?.confidence ?? context.options.confidence,
    error: error instanceof Error ? error.message : String(error),
    finishedAt: new Date().toISOString(),
    headSha:
      context.state?.snapshot.expectedHeadSha ?? context.options.head ?? null,
    mode: context.mode,
    pullRequestNumber: context.pullRequestNumber,
    repository: context.repository,
    results: execution.results,
    riskTags: context.plan?.riskTags ?? [],
    schemaVersion: FINAL_CANDIDATE_EVIDENCE_VERSION,
    selectedChecks: context.plan?.selectedChecks ?? [],
    skippedChecks: context.plan?.skippedChecks ?? [],
    startedAt: context.startedAt.toISOString(),
    treeSha: context.state?.snapshot.treeSha ?? null,
  };
}

function publishFinalEvidence(context, evidence, summary) {
  if (!context.publishStatus) {
    return;
  }
  if (context.mode === "local") {
    const comment = publishPullRequestComment({
      body: summary,
      pullRequestNumber: context.pullRequestNumber,
      repository: context.repository,
    });
    context.targetUrl = comment.html_url;
  }
  publishCommitStatus({
    description: describeFinalStatus(evidence),
    headSha: evidence.headSha,
    repository: context.repository,
    state: evidence.conclusion,
    targetUrl: context.targetUrl,
  });
}

function describeFinalStatus(evidence) {
  if (evidence.conclusion === "success") {
    return `Passed ${summarizeRisk(evidence.riskTags)} @ ${shortSha(evidence.headSha)} on ${shortSha(evidence.baseSha)}`;
  }
  return `Failed @ ${shortSha(evidence.headSha)} on ${shortSha(evidence.baseSha)}; inspect evidence`;
}

function createEvidence(input) {
  return {
    baseSha: input.plan.baseSha,
    branchName: input.plan.branchName,
    changedPaths: input.plan.changedPaths,
    conclusion: input.conclusion,
    confidence: input.plan.confidence,
    finishedAt: input.finishedAt.toISOString(),
    headSha: input.plan.headSha,
    mode: input.mode,
    pullRequestNumber: input.pullRequest.number,
    pullRequestUrl: input.pullRequest.html_url,
    repository: input.repository,
    results: input.execution.results,
    riskTags: input.plan.riskTags,
    schemaVersion: FINAL_CANDIDATE_EVIDENCE_VERSION,
    selectedChecks: input.plan.selectedChecks,
    skippedChecks: input.plan.skippedChecks,
    startedAt: input.startedAt.toISOString(),
    treeSha: input.plan.treeSha,
  };
}

function runCandidateCommand(command) {
  process.stdout.write(`\n$ ${formatCommand(command)}\n`);
  const [binary, ...args] = command;
  const resolvedBinary = binary === "pnpm" ? pnpmBinary : binary;
  const result = spawnSync(resolvedBinary, args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status ?? 1 };
}

function parseOptions(args) {
  const options = { confidence: "standard" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--full") {
      options.confidence = "full";
      continue;
    }
    if (arg === "--publish-status") {
      options.publishStatus = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected Final Candidate argument: ${arg}`);
    }
    const name = arg.slice(2).replaceAll("-", "_");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Final Candidate option ${arg} requires a value.`);
    }
    index += 1;
    const optionName = {
      evidence: "evidence",
      base: "base",
      branch: "branch",
      head: "head",
      mode: "mode",
      pr: "pr",
      repo: "repository",
      repository: "repository",
    }[name];
    if (!optionName) {
      throw new Error(`Unknown Final Candidate option: ${arg}`);
    }
    options[optionName] = value;
  }
  return options;
}

function requirePullRequestNumber(value) {
  const pullRequestNumber = Number.parseInt(String(value ?? ""), 10);
  if (!(Number.isInteger(pullRequestNumber) && pullRequestNumber > 0)) {
    throw new Error(
      "Final Candidate requires --pr <positive pull request number>."
    );
  }
  return pullRequestNumber;
}

function printHelp() {
  process.stdout.write(`OpenMeld Final Candidate

Plan the exact candidate without running checks:
  pnpm candidate plan -- --base origin/main

Request the normal GitHub-hosted gate once the committed branch contains current main:
  pnpm candidate request -- --pr <number>

Run the same gate locally and publish shared evidence when Actions is unavailable:
  pnpm candidate:local -- --pr <number>

Add --full to plan, request, or run for full local checks, unit tests, and integration tests.
Every run prints the exact head, base, tree, changed paths, selected commands, reasons, skips, durations, and result.
`);
}

class CandidateCheckError extends Error {
  constructor(message, execution) {
    super(message);
    this.name = "CandidateCheckError";
    this.execution = execution;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
