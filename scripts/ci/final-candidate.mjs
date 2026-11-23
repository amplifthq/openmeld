#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FINAL_CANDIDATE_EVIDENCE_VERSION } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import { settleHostedCandidateRuns } from "./final-candidate-handoff.mjs";
import {
  appendWorkflowSummary,
  describeFinalCandidateFailure,
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
  FINAL_CANDIDATE_LABELS,
  FINAL_CANDIDATE_STATUS_CONTEXT,
  formatCommand,
  resolveCandidateDependencyScope,
  resolveFinalCandidateLabel,
} from "./final-candidate-policy.mjs";
import {
  readPriorEvidenceCandidates,
  resolveReusableCheckInput,
} from "./final-candidate-reuse.mjs";
import {
  isCommitAncestor,
  publishCommitStatus,
  publishPullRequestComment,
  readPullRequest,
  resolveBranchName,
  resolveCandidateState,
  resolveChangedPaths,
  resolveCommit,
  resolveDirtyPaths,
  resolveMergeGroupState,
  resolveObject,
  resolveRepository,
  runGhJson,
} from "./final-candidate-state.mjs";

const pnpmBinary = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const GIT_CONFIG_ENV_PATTERN = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u;
const TRUSTED_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

async function run() {
  const [command = "help", ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === "help" || options.help) {
    printHelp();
    return;
  }
  if (command === "plan" || command === "dependency-scope") {
    runPlan(options, command);
    return;
  }
  if (command === "request") {
    await requestRemoteCandidate(options);
    return;
  }
  if (command === "run") {
    await runCandidate(options);
    return;
  }
  throw new Error(`Unknown Final Candidate command: ${command}`);
}

function runPlan(options, command) {
  const candidateRoot = path.resolve(options.candidateRoot ?? process.cwd());
  const headSha = resolveCommit(options.head ?? "HEAD", candidateRoot);
  const baseSha = resolveCommit(options.base ?? "origin/main", candidateRoot);
  const treeSha = resolveObject(`${headSha}^{tree}`, candidateRoot);
  const branchName = options.branch ?? resolveBranchName(candidateRoot);
  const dirtyPaths = resolveDirtyPaths(candidateRoot);
  const changedPaths = [
    ...new Set([
      ...resolveChangedPaths(baseSha, headSha, candidateRoot),
      ...dirtyPaths,
    ]),
  ].toSorted();
  const plan = createFinalCandidatePlan({
    baseSha,
    bootstrapReason: options.bootstrapReason,
    branchName,
    candidateKind: options.candidateKind,
    changedPaths,
    confidence: options.confidence,
    controlTrust: options.controlTrust,
    headSha,
    mode: options.mode,
    planSourceSha: options.planSourceSha,
    treeSha,
  });
  if (command === "dependency-scope") {
    process.stdout.write(`${resolveCandidateDependencyScope(plan)}\n`);
  } else {
    printPlan(plan, dirtyPaths);
  }
}

async function requestRemoteCandidate(options) {
  const pullRequestNumber = requirePullRequestNumber(options.pr);
  const repository = resolveRepository(options.repository);
  const candidateRoot = path.resolve(options.candidateRoot ?? process.cwd());
  const state = resolveCandidateState({
    cwd: candidateRoot,
    expectedBaseSha: options.base,
    expectedHeadSha: options.head,
    pullRequestNumber,
    repository,
  });
  assertCandidateSnapshot(state.snapshot);
  const plan = createFinalCandidatePlan({
    baseSha: state.snapshot.expectedBaseSha,
    bootstrapReason: null,
    branchName: options.branch ?? state.pullRequest.head.ref,
    changedPaths: resolveChangedPaths(
      state.snapshot.expectedBaseSha,
      state.snapshot.expectedHeadSha,
      candidateRoot
    ),
    confidence: options.confidence,
    controlTrust: "current-main",
    headSha: state.snapshot.expectedHeadSha,
    mode: "remote",
    planSourceSha: state.snapshot.expectedBaseSha,
    treeSha: state.snapshot.treeSha,
  });
  printPlan(plan, []);

  const requestedLabel = resolveFinalCandidateLabel(options.confidence);
  const endpoint = `repos/${repository}/issues/${pullRequestNumber}`;
  let triggerAttempted = false;
  await requestConfidenceLabel({
    requestedLabel,
    readState: () =>
      readRequestState(
        repository,
        pullRequestNumber,
        state.snapshot.expectedHeadSha,
        state.pullRequest.html_url,
        triggerAttempted
      ),
    removeLabel: (label) =>
      runGhJson(["api", "--method", "DELETE", `${endpoint}/labels/${label}`]),
    addLabel: (label) => {
      triggerAttempted = true;
      return runGhJson(
        ["api", "--method", "POST", `${endpoint}/labels`, "--input", "-"],
        { labels: [label] }
      );
    },
    markPending: () => {
      const posted = publishCommitStatus({
        description: requestStatusDescription(
          options.confidence,
          state.snapshot.expectedHeadSha
        ),
        headSha: state.snapshot.expectedHeadSha,
        repository,
        state: "pending",
        targetUrl: state.pullRequest.html_url,
      });
      triggerAttempted = false;
      if (!Number.isSafeInteger(posted.id) || posted.id <= 0) {
        throw new Error(
          "GitHub did not return the ID of the pending Final Candidate request."
        );
      }
      return { id: posted.id, label: requestedLabel };
    },
  });
  process.stdout.write(
    [
      "Remote Final Candidate requested.",
      "Head status: pending until the requested run reports.",
      `PR: ${state.pullRequest.html_url}`,
      `Head: ${state.snapshot.expectedHeadSha}`,
      `Base: ${state.snapshot.expectedBaseSha}`,
      `Confidence: ${options.confidence}`,
      `Request label: ${requestedLabel}`,
      "No check result exists yet. Use the trusted quiet wait command; it prints only state transitions and the final exact status.",
      "",
    ].join("\n")
  );
}

function requestStatusDescription(confidence, head) {
  return `Requested ${confidence} Final Candidate @ ${head.slice(0, 12)}; waiting for its result`;
}

function readLatestRequestMarker(repository, head, prUrl) {
  for (let page = 1; ; page++) {
    const statuses = runGhJson([
      "api",
      `repos/${repository}/commits/${head}/statuses?per_page=100&page=${page}`,
    ]);
    for (const status of statuses) {
      if (
        status.context !== FINAL_CANDIDATE_STATUS_CONTEXT ||
        status.state !== "pending"
      ) {
        continue;
      }
      if (
        status.description?.startsWith("Running ") &&
        status.description.includes(`@ ${head.slice(0, 12)} on `)
      ) {
        return null;
      }
      const confidence = Object.keys(FINAL_CANDIDATE_LABELS).find(
        (level) => status.description === requestStatusDescription(level, head)
      );
      if (confidence) {
        if (status.target_url !== prUrl) {
          return null;
        }
        return { id: status.id, label: FINAL_CANDIDATE_LABELS[confidence] };
      }
    }
    if (statuses.length < 100) {
      return null;
    }
  }
}

function readRequestState(
  repository,
  number,
  expectedHead,
  prUrl,
  triggerAttempted
) {
  for (let attempt = 0; ; attempt++) {
    let current;
    let marker;
    try {
      current = readPullRequest(repository, number);
      marker = readLatestRequestMarker(repository, expectedHead, prUrl);
    } catch (error) {
      if (attempt === 0) {
        continue;
      }
      const trigger = triggerAttempted
        ? "A request-label trigger was attempted. Check Final Candidate status before retrying."
        : "No request-label trigger was attempted for this pending status. Retry the request.";
      throw new Error(
        `Could not read PR #${number} after writing pending for ${expectedHead}. ${trigger} ${error.message}`,
        { cause: error }
      );
    }
    if (current.head.sha !== expectedHead) {
      throw new Error(
        `Pull request head changed from ${expectedHead} to ${current.head.sha}. Retry the request for the new head.`
      );
    }
    if (
      current.state !== "open" ||
      current.draft ||
      current.base.ref !== "main"
    ) {
      throw new Error(
        `PR #${number} must remain open, ready for review and targeting main to request Final Candidate.`
      );
    }
    return { labels: current.labels, marker };
  }
}

// Each label addition triggers a workflow. Remove existing request labels to
// re-arm retries, and use the add response to see competing writes. Replacing
// the entire PR label set would overwrite unrelated triage changes.
export async function requestConfidenceLabel(input) {
  const own = await input.markPending();
  let target = own;
  let mutated = false;
  const readLabels = async () => {
    const { labels, marker } = await input.readState();
    if (
      !(marker && Number.isSafeInteger(marker.id)) ||
      marker.id < target.id ||
      (marker.id === target.id && marker.label !== target.label)
    ) {
      throw new Error(
        "Cannot confirm ownership of the latest Final Candidate request. Check Final Candidate status."
      );
    }
    if (marker.id !== target.id) {
      throw new SupersededRequest(marker);
    }
    return labels;
  };
  const change = (operation) => (name) => {
    mutated = true;
    return operation(name);
  };
  for (;;) {
    try {
      await applyConfidenceLabel({
        ...input,
        requestedLabel: target.label,
        readLabels,
        addLabel: change(input.addLabel),
        removeLabel: change(input.removeLabel),
      });
      break;
    } catch (error) {
      if (!(error instanceof SupersededRequest && mutated)) {
        throw error;
      }
      // Our write could have crossed the winning marker. A fresh edge of the
      // winning level restores run order even if its label is already present.
      target = error.marker;
    }
  }
  if (target.id !== own.id) {
    throw new SupersededRequest(target);
  }
}

class SupersededRequest extends Error {
  constructor(marker) {
    super(
      `Concurrent Final Candidate request ${marker.id} superseded this request. Check Final Candidate status.`
    );
    this.marker = marker;
  }
}

function ghDidNotStart(error) {
  return error.syscall === "spawnSync gh" && error.code === "EAGAIN";
}

// Each new attachment can start a paid workflow. Allow the original trigger
// and two repairs for this immutable marker before reporting contention.
const MAX_LABEL_RECONCILIATION_PASSES = 3;

async function applyConfidenceLabel(input) {
  const requested = input.requestedLabel;
  const now = input.now ?? (() => performance.now());
  const sleep = input.sleep ?? delay;
  const competing =
    requested === FINAL_CANDIDATE_LABELS.full
      ? FINAL_CANDIDATE_LABELS.standard
      : FINAL_CANDIDATE_LABELS.full;
  const has = (labels, name) => labels.some((label) => label.name === name);
  const remove = async (name, requiredLabel) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await input.removeLabel(name);
      } catch (error) {
        const current = await input.readLabels();
        if (
          !has(current, name) ||
          (requiredLabel && !has(current, requiredLabel))
        ) {
          return current;
        }
        // A name can be detached and reattached while a response is lost.
        // EAGAIN from spawning gh proves the DELETE was never sent.
        if (!ghDidNotStart(error)) {
          throw new Error(
            `Could not confirm removal of ${name}. Its current attachment may belong to another request. Check Final Candidate status before retrying. ${error.message}`,
            { cause: error }
          );
        }
        if (attempt === 1) {
          throw error;
        }
      }
    }
  };
  const add = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await input.addLabel(requested);
      } catch (error) {
        // A lost response may have triggered a run for a superseded marker.
        // Recheck before retrying only a POST that never left this process.
        await input.readLabels();
        if (attempt === 1 || !ghDidNotStart(error)) {
          throw error;
        }
      }
    }
  };
  let missingWinner = false;
  for (let pass = 0; pass < MAX_LABEL_RECONCILIATION_PASSES; pass++) {
    // GitHub timestamps have whole-second precision. Rearm from a label
    // snapshot taken after that second so even overlapping same-mode requests
    // have a trigger distinguishable from their pending marker.
    const earliestTrigger = now() + 1000;
    for (
      let remaining = 1000;
      remaining > 0;
      remaining = earliestTrigger - now()
    ) {
      await sleep(Math.ceil(remaining));
    }
    const existing = await input.readLabels();
    if (
      missingWinner &&
      has(existing, requested) &&
      !has(existing, competing)
    ) {
      // The previous confirmation saw this label absent under this same
      // marker. Another helper has since triggered the winning level.
      return;
    }
    for (const name of [requested, competing]) {
      if (has(existing, name)) {
        await remove(name);
        // Label writes have no head precondition. Recheck after a mutation
        // before the next DELETE or the trigger POST.
        await input.readLabels();
      }
    }
    const added = await add();
    if (has(added, competing)) {
      await input.readLabels();
      await remove(competing, requested);
    }
    const current = await input.readLabels();
    if (has(current, requested) && !has(current, competing)) {
      return;
    }
    missingWinner = !has(current, requested);
    // The current marker still owns this request. A crossing mutation changed
    // its labels; restore the winning edge and confirm again.
  }
  throw new Error(
    `Final Candidate request for ${requested} did not settle after ${MAX_LABEL_RECONCILIATION_PASSES} trigger rounds. Check Final Candidate status before retrying.`
  );
}

async function runCandidate(options) {
  const context = createRunContext(options);
  let evidence;
  let originalError = null;

  try {
    prepareCandidateRun(context);
    await prepareLocalPublication(context);
    publishPendingEvidence(context);
    evidence = executePreparedCandidate(context);
  } catch (error) {
    originalError = error;
    evidence = createFailureEvidence(context, error);
  }

  const evidencePath = resolveEvidencePath(
    options.evidence,
    evidence.headSha ?? options.head
  );
  evidence.publicationErrors = [...context.publicationErrors];
  writeEvidence(evidencePath, evidence);
  if (context.localPublicationReady) {
    try {
      // Also settle runs triggered while the local checks were executing.
      await prepareLocalPublication(context, false);
    } catch (error) {
      recordPublicationError(context, "final-status", error);
      evidence.publicationErrors = [...context.publicationErrors];
      writeEvidence(evidencePath, evidence);
      throw createFinalRunError(originalError, context.publicationErrors);
    }
  }
  publishFinalEvidence(context, evidence, evidencePath);

  evidence.publicationErrors = [...context.publicationErrors];
  writeEvidence(evidencePath, evidence);
  const finalSummary = renderEvidenceSummary(evidence, evidencePath, {
    commandLogsLocation:
      context.mode === "remote"
        ? "the final-candidate-evidence workflow artifact"
        : context.commandLogsPath,
  });
  process.stdout.write(`${finalSummary}\n`);
  appendWorkflowSummary(finalSummary);

  if (originalError || context.publicationErrors.length > 0) {
    throw createFinalRunError(originalError, context.publicationErrors);
  }
}

function createRunContext(options) {
  const repository = resolveRepository(options.repository);
  const mode = options.mode ?? "local";
  const candidateKind = options.candidateKind ?? "pull-request";
  if (!(mode === "local" || mode === "remote")) {
    throw new Error(
      `Final Candidate mode must be local or remote, found ${mode}.`
    );
  }
  if (!(candidateKind === "pull-request" || candidateKind === "merge-group")) {
    throw new Error(`Unknown Final Candidate kind: ${candidateKind}.`);
  }
  if (candidateKind === "merge-group" && mode !== "remote") {
    throw new Error("Merge-group Final Candidate is hosted-only.");
  }
  if (candidateKind === "merge-group" && options.publishStatus) {
    throw new Error(
      "Merge-group Final Candidate uses GitHub's required job check, not a writable commit status."
    );
  }
  const pullRequestNumber =
    candidateKind === "pull-request"
      ? requirePullRequestNumber(options.pr)
      : null;
  return {
    candidateKind,
    candidateRoot: path.resolve(options.candidateRoot ?? process.cwd()),
    commandLogsPath: null,
    evidencePath: null,
    mode,
    localPublicationReady: false,
    options,
    execution: null,
    plan: null,
    priorEvidenceCandidates: [],
    publicationErrors: [],
    publishStatus: options.publishStatus ?? false,
    pullRequestNumber,
    repository,
    startedAt: new Date(),
    state: null,
    targetUrl: null,
    trustedRoot: TRUSTED_REPO_ROOT,
  };
}

function prepareCandidateRun(context) {
  const stateInput = {
    cwd: context.candidateRoot,
    expectedBaseSha: context.options.base,
    expectedHeadSha: context.options.head,
    repository: context.repository,
  };
  context.state =
    context.candidateKind === "merge-group"
      ? resolveMergeGroupState(stateInput)
      : resolveCandidateState({
          ...stateInput,
          pullRequestNumber: context.pullRequestNumber,
        });
  assertCandidateSnapshot(context.state.snapshot, {
    candidateKind: context.candidateKind,
  });
  context.plan = createFinalCandidatePlan({
    baseSha: context.state.snapshot.expectedBaseSha,
    bootstrapReason: context.options.bootstrapReason,
    branchName:
      context.options.branch ?? context.state.pullRequest?.head.ref ?? null,
    candidateKind: context.candidateKind,
    changedPaths: resolveChangedPaths(
      context.state.snapshot.expectedBaseSha,
      context.state.snapshot.expectedHeadSha,
      context.candidateRoot
    ),
    confidence: context.options.confidence,
    controlTrust: context.options.controlTrust,
    headSha: context.state.snapshot.expectedHeadSha,
    mode: context.mode,
    planSourceSha: context.options.planSourceSha,
    treeSha: context.state.snapshot.treeSha,
  });
  context.evidencePath = resolveEvidencePath(
    context.options.evidence,
    context.plan.headSha
  );
  context.commandLogsPath = `${context.evidencePath}.logs`;
  rmSync(context.commandLogsPath, { force: true, recursive: true });
  mkdirSync(context.commandLogsPath, { recursive: true });
  context.priorEvidenceCandidates = readPriorEvidenceCandidates(
    context.options.priorEvidenceRoot
  );
  printPlan(context.plan, []);
  context.targetUrl = resolveTargetUrl(
    context.mode,
    context.repository,
    context.state.pullRequest?.html_url ?? null
  );
}

function publishPendingEvidence(context) {
  if (!context.publishStatus) {
    return;
  }
  try {
    publishCommitStatus({
      description: `Running ${summarizeRisk(context.plan.riskTags)} @ ${shortSha(context.plan.headSha)} on ${shortSha(context.plan.baseSha)}`,
      headSha: context.plan.headSha,
      repository: context.repository,
      state: "pending",
      targetUrl: context.targetUrl,
    });
  } catch (error) {
    recordPublicationError(context, "pending-status", error);
  }
}

async function prepareLocalPublication(context, requireCurrentBase = true) {
  if (context.mode !== "local" || !context.publishStatus) {
    return;
  }
  context.localPublicationReady = false;
  await settleHostedCandidateRuns({
    repository: context.repository,
    pullRequestNumber: context.pullRequestNumber,
    headSha: context.plan.headSha,
    branchName: context.state.pullRequest.head.ref,
  });
  assertLiveCandidate(context, { requireCurrentBase });
  context.localPublicationReady = true;
}

function executePreparedCandidate(context) {
  const execution = executeCandidateChecks(context.plan.selectedChecks, {
    now: () => Date.now(),
    onReuse: (selectedCheck, reusedFrom) => {
      process.stdout.write(
        `Reused ${selectedCheck.id}: identical task inputs already passed at ${shortSha(reusedFrom.headSha)} on ${shortSha(reusedFrom.baseSha)}.\n`
      );
    },
    resolveReuse: (selectedCheck) =>
      resolveCandidateCheckReuse(selectedCheck, context),
    runCommand: (command, selectedCheck) =>
      runCandidateCommand(command, selectedCheck, context),
  });
  context.execution = execution;
  if (execution.conclusion !== "success") {
    throw new CandidateCheckError(
      describeExecutionFailure(execution),
      execution
    );
  }

  assertLiveCandidate(context, {
    requireCurrentBase: context.candidateKind === "merge-group",
  });

  return createEvidence({
    conclusion: "success",
    execution,
    finishedAt: new Date(),
    mode: context.mode,
    planSourceSha:
      context.plan?.planSourceSha ?? context.options.planSourceSha ?? null,
    plan: context.plan,
    pullRequest: context.state.pullRequest,
    repository: context.repository,
    startedAt: context.startedAt,
  });
}

function assertLiveCandidate(context, { requireCurrentBase }) {
  const stateInput = {
    cwd: context.candidateRoot,
    expectedBaseSha: context.plan.baseSha,
    expectedHeadSha: context.plan.headSha,
    repository: context.repository,
  };
  const finalState =
    context.candidateKind === "merge-group"
      ? resolveMergeGroupState(stateInput)
      : resolveCandidateState({
          ...stateInput,
          pullRequestNumber: context.pullRequestNumber,
        });
  assertCandidateSnapshot(finalState.snapshot, {
    candidateKind: context.candidateKind,
    requireCurrentBase,
  });
  if (finalState.snapshot.treeSha !== context.plan.treeSha) {
    throw new Error(
      `Candidate tree drifted: expected ${context.plan.treeSha}, found ${finalState.snapshot.treeSha}.`
    );
  }
}

function resolveCandidateCheckReuse(selectedCheck, context) {
  try {
    return resolveReusableCheckInput({
      candidateRoot: context.candidateRoot,
      check: selectedCheck,
      commandWrapper: context.options.commandWrapper,
      environment: createCandidateCommandEnvironment(),
      evidenceCandidates: context.priorEvidenceCandidates,
      isAncestor: (ancestorSha, descendantSha) =>
        isCommitAncestor(ancestorSha, descendantSha, context.candidateRoot),
      plan: context.plan,
      pullRequestNumber: context.pullRequestNumber,
      repository: context.repository,
    });
  } catch (error) {
    process.stdout.write(
      `Reuse unavailable for ${selectedCheck.id}; running it normally (${sanitizeEvidenceText(error instanceof Error ? error.message : String(error))}).\n`
    );
    return null;
  }
}

function createFailureEvidence(context, error) {
  const execution =
    error instanceof CandidateCheckError
      ? error.execution
      : (context.execution ?? {
          conclusion: "failure",
          failedCheckId: null,
          results: [],
        });
  return {
    baseSha:
      context.state?.snapshot.expectedBaseSha ?? context.options.base ?? null,
    bootstrapReason: context.plan?.bootstrapReason ?? null,
    branchName: context.plan?.branchName ?? context.options.branch ?? null,
    candidateKind: context.candidateKind,
    changedPaths: context.plan?.changedPaths ?? [],
    conclusion: "failure",
    confidence: context.plan?.confidence ?? context.options.confidence,
    controlTrust: context.plan?.controlTrust ?? context.options.controlTrust,
    error: sanitizeEvidenceText(
      error instanceof Error ? error.message : String(error)
    ),
    finishedAt: new Date().toISOString(),
    headSha:
      context.state?.snapshot.expectedHeadSha ?? context.options.head ?? null,
    mode: context.mode,
    planSourceSha:
      context.plan?.planSourceSha ?? context.options.planSourceSha ?? null,
    publicationErrors: [...context.publicationErrors],
    pullRequestNumber: context.pullRequestNumber,
    pullRequestUrl: context.state?.pullRequest?.html_url ?? null,
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

function publishFinalEvidence(context, evidence, evidencePath) {
  if (
    !context.publishStatus ||
    (context.mode === "local" && !context.localPublicationReady)
  ) {
    return;
  }
  if (context.mode === "local" && context.candidateKind === "pull-request") {
    try {
      publishPullRequestComment({
        body: renderEvidenceSummary(evidence, evidencePath, {
          finalStatusPending: true,
        }),
        pullRequestNumber: context.pullRequestNumber,
        repository: context.repository,
      });
    } catch (error) {
      recordPublicationError(context, "pull-request-comment", error);
    }
    evidence.publicationErrors = [...context.publicationErrors];
  }

  try {
    publishCommitStatus({
      description: describeFinalStatus(evidence, context.publicationErrors),
      headSha: evidence.headSha,
      repository: context.repository,
      state:
        evidence.conclusion === "success" &&
        context.publicationErrors.length === 0
          ? "success"
          : "failure",
      targetUrl: context.targetUrl,
    });
  } catch (error) {
    recordPublicationError(context, "final-status", error);
    evidence.publicationErrors = [...context.publicationErrors];
    if (context.mode === "local") {
      try {
        publishPullRequestComment({
          body: renderEvidenceSummary(evidence, evidencePath),
          pullRequestNumber: context.pullRequestNumber,
          repository: context.repository,
        });
      } catch (commentError) {
        recordPublicationError(context, "pull-request-comment", commentError);
      }
    }
  }
}

function describeFinalStatus(evidence, publicationErrors) {
  if (evidence.conclusion === "success" && publicationErrors.length === 0) {
    return `Passed ${summarizeRisk(evidence.riskTags)} @ ${shortSha(evidence.headSha)} on ${shortSha(evidence.baseSha)}`;
  }
  return describeFinalCandidateFailure(
    evidence.headSha,
    evidence.baseSha,
    evidence
  );
}

function createEvidence(input) {
  return {
    baseSha: input.plan.baseSha,
    bootstrapReason: input.plan.bootstrapReason,
    branchName: input.plan.branchName,
    candidateKind: input.plan.candidateKind,
    changedPaths: input.plan.changedPaths,
    conclusion: input.conclusion,
    confidence: input.plan.confidence,
    controlTrust: input.plan.controlTrust,
    error: null,
    finishedAt: input.finishedAt.toISOString(),
    headSha: input.plan.headSha,
    mode: input.mode,
    planSourceSha: input.plan.planSourceSha,
    publicationErrors: [],
    pullRequestNumber: input.pullRequest?.number ?? null,
    pullRequestUrl: input.pullRequest?.html_url ?? null,
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

function runCandidateCommand(command, selectedCheck, context) {
  const trustedExecutionCommand =
    selectedCheck.id === "trusted-control-entrypoints"
      ? [
          process.execPath,
          path.join(
            context.trustedRoot,
            "scripts/ci/verify-trusted-candidate-entrypoints.mjs"
          ),
          "--trusted-root",
          context.trustedRoot,
          "--candidate-root",
          context.candidateRoot,
        ]
      : command;
  const [trustedBinary, ...trustedArgs] = trustedExecutionCommand;
  const resolvedBinary = trustedBinary === "pnpm" ? pnpmBinary : trustedBinary;
  const executionCommand =
    selectedCheck.id !== "trusted-control-entrypoints" &&
    context.options.commandWrapper
      ? [
          path.resolve(context.options.commandWrapper),
          resolvedBinary,
          ...trustedArgs,
        ]
      : [resolvedBinary, ...trustedArgs];
  const startedAt = Date.now();
  process.stdout.write(
    `Running ${selectedCheck.id}: ${formatCommand(executionCommand)}\n`
  );
  const [binary, ...args] = executionCommand;
  const commandEnvironment = {
    ...createCandidateCommandEnvironment(),
    OPENMELD_AFFECTED_BASE: context.plan.baseSha,
  };
  const result = spawnSync(binary, args, {
    cwd:
      selectedCheck.id === "trusted-control-entrypoints"
        ? context.trustedRoot
        : context.candidateRoot,
    encoding: "utf8",
    env: commandEnvironment,
    maxBuffer: 1024 * 1024 * 20,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const stdout = sanitizeCommandOutput(result.stdout);
  const stderr = sanitizeCommandOutput(result.stderr);
  const failed = Boolean(result.error) || result.status !== 0;
  const durationMs = Math.max(0, Date.now() - startedAt);
  writeCommandLog({
    command: executionCommand,
    commandLogsPath: context.commandLogsPath,
    result,
    selectedCheck,
    stderr,
    stdout,
  });
  process.stdout.write(
    `${failed ? "Failed" : "Passed"} ${selectedCheck.id} (${formatCompactDuration(durationMs)}).\n`
  );
  return {
    spawnError: result.error
      ? sanitizeCommandOutput(result.error.message).trim()
      : null,
    status: result.error ? null : (result.status ?? 1),
    stderrTail: failed ? tail(stderr) : "",
    stdoutTail: failed ? tail(stdout) : "",
  };
}

function createCandidateCommandEnvironment() {
  const commandEnvironment = { ...process.env };
  for (const credentialName of [
    "GH_ENTERPRISE_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL",
    "OPENMELD_TRUSTED_GIT_GITHUB_TOKEN",
    "OPENMELD_TRUSTED_GIT_LOCAL_REMOTE_URL",
  ]) {
    delete commandEnvironment[credentialName];
  }
  for (const variableName of Object.keys(commandEnvironment)) {
    if (GIT_CONFIG_ENV_PATTERN.test(variableName)) {
      delete commandEnvironment[variableName];
    }
  }
  return commandEnvironment;
}

function writeCommandLog(input) {
  const safeCheckId = input.selectedCheck.id.replaceAll(/[^a-z0-9-]/giu, "-");
  const logPath = path.join(input.commandLogsPath, `${safeCheckId}.log`);
  const spawnError = input.result.error
    ? sanitizeCommandOutput(input.result.error.message).trim()
    : "none";
  writeFileSync(
    logPath,
    [
      `Check: ${input.selectedCheck.id}`,
      `Command: ${formatCommand(input.command)}`,
      `Exit code: ${input.result.status ?? "none"}`,
      `Spawn error: ${spawnError}`,
      "",
      "--- stdout ---",
      input.stdout || "(empty)\n",
      "--- stderr ---",
      input.stderr || "(empty)\n",
    ].join("\n"),
    "utf8"
  );
}

function formatCompactDuration(durationMs) {
  return durationMs < 1000
    ? `${durationMs} ms`
    : `${(durationMs / 1000).toFixed(1)} s`;
}

function parseOptions(args) {
  const options = {
    confidence: "standard",
    controlTrust: "current-main",
  };
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
      candidate_root: "candidateRoot",
      candidate_kind: "candidateKind",
      evidence: "evidence",
      base: "base",
      bootstrap_reason: "bootstrapReason",
      branch: "branch",
      command_wrapper: "commandWrapper",
      control_trust: "controlTrust",
      head: "head",
      mode: "mode",
      plan_source: "planSourceSha",
      pr: "pr",
      prior_evidence_root: "priorEvidenceRoot",
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
  git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- plan

Use the normal, recommended GitHub-hosted gate when Actions is available:
  git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- request --pr <number>

Read once or wait quietly without streaming full GitHub logs:
  git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- status --pr <number>
  git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- wait --pr <number>

Use the workstation fallback only when Actions quota, billing, or runners are unavailable:
  git show origin/main:scripts/ci/trusted-final-candidate.sh | bash -s -- local --pr <number>

Add --full to plan, request, or run. A hosted request uses the distinct final-candidate-full label and executes full repository checks; a standard request never does.
The first hop and normal local runs come from exact current main. Delivery-control changes require a reviewed control SHA plus explicit exact --bootstrap-control-sha and --bootstrap-reason through the trusted Git-object entrypoint.
Every run prints the exact plan plus compact check progress, durations, and results. Complete redacted command logs are stored beside local evidence or in the hosted evidence artifact; only bounded failure tails return to the terminal.
`);
}

function recordPublicationError(context, operation, error) {
  const publicationError = {
    message: sanitizeEvidenceText(
      error instanceof Error ? error.message : String(error)
    ),
    occurredAt: new Date().toISOString(),
    operation,
  };
  context.publicationErrors.push(publicationError);
  process.stderr.write(
    `Final Candidate publication failed (${operation}): ${publicationError.message}\n`
  );
}

function createFinalRunError(originalError, publicationErrors) {
  const messages = [];
  if (originalError) {
    messages.push(
      `Candidate validation failed: ${originalError instanceof Error ? originalError.message : String(originalError)}`
    );
  }
  for (const publicationError of publicationErrors) {
    messages.push(
      `Evidence publication failed (${publicationError.operation}): ${publicationError.message}`
    );
  }
  return new Error(messages.join("\n"));
}

function describeExecutionFailure(execution) {
  const failed = execution.results.find(
    (result) => result.id === execution.failedCheckId
  );
  if (!failed) {
    return `Final Candidate failed at ${execution.failedCheckId ?? "an unresolved check"}.`;
  }
  const cause = failed.spawnError
    ? `spawn error: ${failed.spawnError}`
    : `exit code ${String(failed.exitCode)}`;
  return `Final Candidate failed at ${failed.id} (${formatCommand(failed.command)}; ${cause}).`;
}

function sanitizeCommandOutput(value) {
  return String(value ?? "")
    .replaceAll(String.fromCharCode(27), "")
    .replaceAll(
      /\b(?:gh[opusr]_|github_pat_|npm_)[A-Za-z0-9_-]+\b/giu,
      "[REDACTED_TOKEN]"
    )
    .replaceAll(/\bBearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .replaceAll(
      /((?:token|secret|password|authorization|cookie|private[_-]?key)[A-Za-z0-9_-]*\s*[=:]\s*)[^\s]+/giu,
      "$1[REDACTED]"
    );
}

function tail(value) {
  return value.length <= 8192 ? value : value.slice(-8192);
}

function sanitizeEvidenceText(value) {
  return tail(sanitizeCommandOutput(value)).trim() || "Unknown failure.";
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
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
