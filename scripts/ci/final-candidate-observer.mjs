#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  expectsResultPublication,
  ResultListingChangedError,
  resultPublicationFinished,
} from "./final-candidate-run-context.mjs";

const ACTIONS_BUDGET_PATTERN =
  /Actions budget is preventing further use|spending limit needs to be increased|recent account payments have failed/iu;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const FINAL_CANDIDATE_CONTEXT = "OpenMeld Final Candidate";
const FINAL_CANDIDATE_WORKFLOW = "final-candidate.yml";
const DEFAULT_INTERVAL_SECONDS = 30;
const DEFAULT_TIMEOUT_SECONDS = 75 * 60;
const SHARED_GATE_REPAIR = /; repair [1-9]\d*$/u;

export function buildFinalCandidateObservation(
  input,
  sharedStatus = observedCommitStatus(input)
) {
  const exactStatus = resolveExactStatus(sharedStatus, input.pullRequest);
  const run =
    requestConfidence(sharedStatus, input.pullRequest) &&
    !isPendingRequestForRun(sharedStatus, input.pullRequest, input.run)
      ? null
      : input.run;
  const jobs = run ? input.jobs : [];
  const annotationMessages = jobs.flatMap((job) =>
    (input.annotationsByCheckRunId.get(job.id) ?? []).map((annotation) =>
      String(annotation.message ?? "").trim()
    )
  );
  const budgetMessage = annotationMessages.find((message) =>
    ACTIONS_BUDGET_PATTERN.test(message)
  );
  const candidateRunner = jobs.find(
    (job) => job.name === "Final Candidate Runner"
  );
  const candidateChecksStarted = Boolean(candidateRunner?.steps?.length);
  const common = {
    baseSha: input.pullRequest.base.sha,
    candidateChecksStarted,
    exactStatus,
    sharedGateStatus:
      input.commitStatuses.find(
        (status) => status.context === FINAL_CANDIDATE_CONTEXT
      )?.state ?? "missing",
    headSha: input.pullRequest.head.sha,
    hostedAvailability: budgetMessage ? "unavailable" : "available",
    pullRequestNumber: input.pullRequest.number,
    pullRequestUrl: input.pullRequest.html_url,
    runConclusion: run?.conclusion ?? null,
    runId: run?.id ?? null,
    runStatus: run?.status ?? null,
    runUrl: run?.html_url ?? null,
  };

  if (exactStatus === "success") {
    return successfulStatusObservation(
      common,
      input.pullRequest,
      sharedStatus,
      budgetMessage
    );
  }
  if (budgetMessage) {
    return {
      ...common,
      detail: budgetMessage,
      reason: "actions-budget",
      state: "hosted-unavailable",
    };
  }
  if (run && run.status !== "completed") {
    return { ...common, reason: "run-in-progress", state: "waiting" };
  }
  if (
    sharedStatus?.context === receiptContext(input.pullRequest) &&
    ["failure", "error"].includes(exactStatus)
  ) {
    return {
      ...common,
      state: "failure",
      reason: "request-result-failed",
      evidenceUrl: sharedStatus.target_url,
    };
  }
  if (!run) {
    return { ...common, reason: "run-not-created", state: "waiting" };
  }
  return completedRunObservation(common);
}

function successfulStatusObservation(common, pr, status, budgetMessage) {
  if (common.runStatus && common.runStatus !== "completed") {
    return { ...common, reason: "run-in-progress", state: "waiting" };
  }
  return {
    ...common,
    evidenceUrl:
      status.target_url === pr.html_url || sourceTarget(status, pr)
        ? status.target_url
        : null,
    ...(budgetMessage ? { detail: budgetMessage } : {}),
    reason: "exact-status-success",
    state: "success",
  };
}

function completedRunObservation(common) {
  if (common.runConclusion === "success") {
    if (common.exactStatus === "pending") {
      return { ...common, reason: "exact-status-pending", state: "waiting" };
    }
    return {
      ...common,
      reason:
        common.exactStatus === "stale-success"
          ? "exact-status-stale"
          : "exact-status-missing",
      state: "failure",
    };
  }
  return {
    ...common,
    reason: `run-${common.runConclusion ?? "failed"}`,
    state: "failure",
  };
}

function requestConfidence(status, pr) {
  if (status?.state !== "pending" || status.target_url !== pr.html_url) {
    return null;
  }
  return ["standard", "full"].find(
    (confidence) =>
      status.description ===
      `Requested ${confidence} Final Candidate @ ${pr.head.sha.slice(0, 12)}; waiting for its result`
  );
}

const SOURCE_TARGET = /^(\d+)(?:\/attempts\/(\d+))?$/u;
function sourceTarget(status, pr) {
  const prefix = `${pr.html_url.slice(0, pr.html_url.lastIndexOf("/pull/"))}/actions/runs/`;
  if (!status.target_url?.startsWith(prefix)) {
    return null;
  }
  const match = SOURCE_TARGET.exec(status.target_url.slice(prefix.length));
  return match
    ? { id: Number(match[1]), attempt: match[2] ? Number(match[2]) : null }
    : null;
}

function matchesAttempt(status, target, run) {
  if (!(target && run) || target.id !== run.id) {
    return false;
  }
  if (target.attempt !== null) {
    return target.attempt === run.run_attempt;
  }
  return (
    run.run_attempt === 1 ||
    Date.parse(status.created_at) > Date.parse(run.run_started_at)
  );
}

// GitHub's combined status only retains the last write per context. A hosted
// publisher can race a new request, so keep the request from the ordered ledger
// until a terminal status can be attributed to it.
function isRequestOrTakeover(status, pr) {
  if (SHARED_GATE_REPAIR.test(status.description)) {
    return false;
  }
  return (
    requestConfidence(status, pr) ||
    (status.state === "pending" &&
      status.target_url === pr.html_url &&
      status.description?.startsWith("Running ") &&
      status.description.includes(`@ ${pr.head.sha.slice(0, 12)} on `))
  );
}

function receiptContext(pr) {
  return `${FINAL_CANDIDATE_CONTEXT} PR #${pr.number}`;
}

function automaticCommitStatus(input, shared) {
  const pr = input.pullRequest;
  const prPrefix = `${pr.html_url.slice(0, pr.html_url.lastIndexOf("/pull/"))}/pull/`;
  // A PR-targeted pending or local takeover on this SHA may belong to a
  // different PR. Source-run URLs identify hosted results independently.
  const status = shared.find((candidate) => {
    if (candidate.target_url?.startsWith(prPrefix)) {
      return candidate.target_url === pr.html_url;
    }
    const target = sourceTarget(candidate, pr);
    if (!target || target.id === input.run?.id) {
      return true;
    }
    const source = lookupHistoricalSource(input, target);
    return (
      expectsResultPublication(source, pr.number, pr.head.sha) ||
      (source?.pull_requests?.length === 1 &&
        source.pull_requests[0].number === pr.number &&
        source.head_sha === pr.head.sha)
    );
  });
  const run = input.run;
  if (
    status &&
    expectsResultPublication(run, pr.number, pr.head.sha) &&
    sourceTarget(status, pr)?.id === run.id &&
    !matchesAttempt(status, sourceTarget(status, pr), run)
  ) {
    return (
      shared.find((candidate) =>
        matchesAttempt(candidate, sourceTarget(candidate, pr), run)
      ) ?? null
    );
  }
  return status ?? null;
}

function observedCommitStatus(input) {
  const pr = input.pullRequest;
  const scoped = receiptContext(pr);
  const statuses = input.commitStatuses.filter(
    (status) =>
      (status.context === FINAL_CANDIDATE_CONTEXT ||
        status.context === scoped) &&
      !SHARED_GATE_REPAIR.test(status.description)
  );
  const shared = statuses.filter(
    (status) => status.context === FINAL_CANDIDATE_CONTEXT
  );
  const latest = shared[0];
  const marker = shared.find((status) => isRequestOrTakeover(status, pr));
  const confidence = requestConfidence(marker, pr);
  if (!confidence) {
    return automaticCommitStatus(input, shared);
  }
  const terminal = statuses
    .slice(0, statuses.indexOf(marker))
    .find((status) => resultForRequest(input, status, marker, confidence));
  if (!terminal) {
    return marker;
  }
  const target = sourceTarget(terminal, pr);
  const current = latest && sourceTarget(latest, pr);
  if (matchesAttempt(latest, current, input.run) && current.id > target.id) {
    return latest;
  }
  if (
    target.id === input.run?.id &&
    !matchesAttempt(terminal, target, input.run)
  ) {
    return marker;
  }
  return terminal;
}

function resultForRequest(input, status, marker, confidence) {
  const pr = input.pullRequest;
  const target = sourceTarget(status, pr);
  if (!(target && ["success", "failure", "error"].includes(status.state))) {
    return false;
  }
  if (
    status.state === "success" &&
    !status.description?.startsWith(
      `Passed ${confidence} @ ${pr.head.sha.slice(0, 12)} on `
    )
  ) {
    return false;
  }
  // A hosted receipt identifies the request even when an automatic run with
  // a different confidence has since become the latest source for this head.
  if (status.description?.includes("; request ")) {
    return (
      target.attempt !== null &&
      Number.isSafeInteger(marker.id) &&
      status.description.endsWith(`; request ${marker.id}`)
    );
  }
  if (status.context === receiptContext(pr)) {
    return false;
  }
  const source =
    input.run?.id === target.id
      ? input.run
      : lookupHistoricalSource(input, target);
  return Boolean(
    source &&
      expectsResultPublication(source, pr.number, pr.head.sha) &&
      source.display_title.includes(` [${confidence}] on `) &&
      Date.parse(source.created_at) > Date.parse(marker.created_at) &&
      matchesAttempt(status, target, source)
  );
}

const GH_HTTP_NOT_FOUND = /(?:^|\n)gh: [^\r\n]*\(HTTP 404\)$/u;
function lookupHistoricalSource(input, target) {
  try {
    return input.readStatusSource?.(target);
  } catch (error) {
    if (
      error?.status === 1 &&
      GH_HTTP_NOT_FOUND.test(String(error.stderr).trimEnd())
    ) {
      return null;
    }
    throw error;
  }
}

function resolveExactStatus(status, pullRequest) {
  if (!status) {
    return "missing";
  }
  if (status.state !== "success") {
    return status.state;
  }
  // The trusted publisher bound the base and proved it is part of main. A
  // success on an older base stays valid: merge queue owns freshness.
  const expectedIdentity = `@ ${pullRequest.head.sha.slice(0, 12)} on `;
  return String(status.description ?? "").includes(expectedIdentity)
    ? "success"
    : "stale-success";
}

export function observationExitCode(observation) {
  if (observation.state === "success") {
    return 0;
  }
  if (observation.state === "hosted-unavailable") {
    return 3;
  }
  if (observation.state === "failure") {
    return 1;
  }
  return null;
}

export function renderFinalCandidateObservation(observation) {
  let hostedLane = observation.state;
  if (observation.hostedAvailability === "unavailable") {
    hostedLane = "unavailable (Actions budget)";
  } else if (observation.state === "waiting") {
    hostedLane = "waiting";
  }
  const lines = [
    "Final Candidate status",
    `PR: ${observation.pullRequestUrl}`,
    `Head: ${observation.headSha}`,
    `Base: ${observation.baseSha}`,
    `Hosted lane: ${hostedLane}`,
    `Candidate checks started: ${observation.candidateChecksStarted ? "yes" : "no"}`,
    `Exact status: ${observation.exactStatus}`,
    `Shared commit status: ${observation.sharedGateStatus}`,
  ];
  if (observation.runId) {
    lines.push(
      `Run: ${String(observation.runId)} (${observation.runStatus}/${observation.runConclusion ?? "none"})`
    );
  }
  const evidenceUrl =
    observation.state === "success" ||
    observation.reason === "request-result-failed"
      ? observation.evidenceUrl
      : observation.runUrl;
  if (evidenceUrl) {
    lines.push(`Evidence: ${evidenceUrl}`);
  }
  if (observation.detail) {
    lines.push(`GitHub fact: ${observation.detail}`);
  }
  if (
    observation.state === "hosted-unavailable" &&
    observation.exactStatus !== "success"
  ) {
    lines.push(
      "Available fallback: the trusted local fallback can publish the same exact status after its resource preflight."
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parseFinalCandidateObserverArgs(argv) {
  const [command = "status", ...args] = argv;
  if (!(command === "status" || command === "wait" || command === "help")) {
    throw new Error("Final Candidate observer command must be status or wait.");
  }
  const options = {
    command,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    pullRequestNumber: null,
    repository: null,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.command = "help";
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    index += 1;
    applyObserverOption(options, argument, value);
  }
  if (options.command !== "help" && !options.pullRequestNumber) {
    throw new Error("Final Candidate status requires --pr <number>.");
  }
  return options;
}

function applyObserverOption(options, argument, value) {
  if (argument === "--pr") {
    options.pullRequestNumber = requirePositiveInteger(value, argument);
    return;
  }
  if (argument === "--repo" || argument === "--repository") {
    options.repository = value;
    return;
  }
  if (argument === "--interval-seconds") {
    options.intervalSeconds = requirePositiveInteger(value, argument);
    return;
  }
  if (argument === "--timeout-seconds") {
    options.timeoutSeconds = requirePositiveInteger(value, argument);
    return;
  }
  throw new Error(`Unknown Final Candidate observer option: ${argument}`);
}

export async function runFinalCandidateObserver(input = {}) {
  const options = parseFinalCandidateObserverArgs(input.argv ?? []);
  const write = input.write ?? ((value) => process.stdout.write(value));
  if (options.command === "help") {
    write(renderHelp());
    return 0;
  }
  const adapters = { ...defaultAdapters(), ...input.adapters };
  const repository = options.repository ?? adapters.resolveRepository();
  const startedAt = adapters.now();
  const annotationCache = { attempt: null, byJob: new Map() };
  let previousFingerprint = null;

  while (true) {
    const observation = await readObservation({
      adapters,
      annotationCache,
      pullRequestNumber: options.pullRequestNumber,
      repository,
    });
    const fingerprint = observationFingerprint(observation);
    if (fingerprint !== previousFingerprint) {
      write(renderFinalCandidateObservation(observation));
      previousFingerprint = fingerprint;
    }
    const exitCode = observationExitCode(observation);
    if (exitCode !== null || options.command === "status") {
      return exitCode ?? 2;
    }
    if (adapters.now() - startedAt >= options.timeoutSeconds * 1000) {
      write(
        "Final Candidate wait timed out; no merge or release conclusion was inferred.\n"
      );
      return 2;
    }
    await adapters.sleep(options.intervalSeconds * 1000);
  }
}

async function readObservation(input) {
  const pullRequest = await input.adapters.readPullRequest(
    input.repository,
    input.pullRequestNumber
  );
  if (pullRequest.number !== input.pullRequestNumber) {
    throw new Error("GitHub returned a different pull request number.");
  }
  if (!EXACT_SHA_PATTERN.test(String(pullRequest.head?.sha ?? ""))) {
    throw new Error("GitHub did not return an exact pull request head SHA.");
  }
  if (!EXACT_SHA_PATTERN.test(String(pullRequest.base?.sha ?? ""))) {
    throw new Error("GitHub did not return an exact pull request base SHA.");
  }
  const run = await input.adapters.readLatestRun(
    input.repository,
    pullRequest.head.sha,
    pullRequest.number
  );
  const jobs = run
    ? await input.adapters.readJobs(input.repository, run.id, run.run_attempt)
    : [];
  const annotationsByCheckRunId = new Map();
  const attempt = run ? `${run.id}:${run.run_attempt}` : null;
  for (const job of jobs) {
    if (job.conclusion !== "failure") {
      continue;
    }
    const cached =
      attempt === input.annotationCache.attempt
        ? input.annotationCache.byJob.get(job.id)
        : undefined;
    annotationsByCheckRunId.set(
      job.id,
      cached ?? (await input.adapters.readAnnotations(input.repository, job.id))
    );
  }
  input.annotationCache.attempt = attempt;
  input.annotationCache.byJob = annotationsByCheckRunId;
  const commitStatuses = await input.adapters.readCommitStatuses(
    input.repository,
    pullRequest.head.sha,
    pullRequest
  );
  const facts = {
    annotationsByCheckRunId,
    commitStatuses,
    jobs,
    pullRequest,
    run,
    readStatusSource: (target) =>
      input.adapters.readStatusSource(input.repository, target),
  };
  return await observeResultPublication(input, facts);
}

function isPendingRequestForRun(status, pr, run) {
  // A new request can be pending before its source run is visible. GitHub
  // timestamps have second precision, so equality cannot establish ordering.
  const confidence = requestConfidence(status, pr);
  return Boolean(
    confidence &&
      expectsResultPublication(run, pr.number, pr.head.sha) &&
      Date.parse(status.created_at) < Date.parse(run.created_at) &&
      run.display_title.includes(` [${confidence}] on `)
  );
}

async function observeResultPublication(input, facts) {
  const { pullRequest, run } = facts;
  const sharedStatus = observedCommitStatus(facts);
  const observation = buildFinalCandidateObservation(facts, sharedStatus);
  if (
    !(
      expectsResultPublication(run, pullRequest.number, pullRequest.head.sha) &&
      ((observation.reason === "exact-status-missing" &&
        observation.exactStatus === "missing") ||
        (observation.reason === "exact-status-pending" &&
          isPendingRequestForRun(sharedStatus, pullRequest, run)))
    )
  ) {
    return observation;
  }
  let finished;
  try {
    finished = await input.adapters.resultPublicationFinished(
      input.repository,
      run
    );
  } catch (error) {
    if (!(error instanceof ResultListingChangedError)) {
      throw error;
    }
    finished = false;
  }
  if (!finished) {
    return { ...observation, reason: "result-not-published", state: "waiting" };
  }
  // Status and workflow evidence are separate reads. A push or rerun during
  // publication belongs to the next observation.
  const statuses = await input.adapters.readCommitStatuses(
    input.repository,
    pullRequest.head.sha,
    pullRequest
  );
  const latest = await input.adapters.readLatestRun(
    input.repository,
    pullRequest.head.sha,
    pullRequest.number
  );
  const live = await input.adapters.readPullRequest(
    input.repository,
    pullRequest.number
  );
  if (
    live.number !== pullRequest.number ||
    live.head?.sha !== pullRequest.head.sha ||
    latest?.id !== run.id ||
    latest.run_attempt !== run.run_attempt ||
    latest.status !== run.status ||
    latest.conclusion !== run.conclusion
  ) {
    return { ...observation, reason: "source-changed", state: "waiting" };
  }
  const finalFacts = {
    ...facts,
    commitStatuses: statuses,
  };
  const finalStatus = observedCommitStatus(finalFacts);
  const final = buildFinalCandidateObservation(finalFacts, finalStatus);
  if (
    final.reason === "exact-status-pending" &&
    isPendingRequestForRun(finalStatus, pullRequest, run)
  ) {
    return {
      ...final,
      reason: "result-status-unpublished",
      state: "failure",
      detail:
        "The result workflow finished while its requested status was still pending.",
    };
  }
  return final;
}

function defaultAdapters() {
  return {
    now: () => Date.now(),
    readAnnotations: (repository, checkRunId) =>
      runGhJson([
        "api",
        `repos/${repository}/check-runs/${String(checkRunId)}/annotations`,
      ]),
    readCommitStatuses: readCommitStatusHistory,
    readStatusSource: (repository, target) =>
      runGhJson([
        "api",
        `repos/${repository}/actions/runs/${target.id}${target.attempt ? `/attempts/${target.attempt}` : ""}`,
      ]),
    readJobs: (repository, runId, attempt) =>
      runGhJson([
        "api",
        `repos/${repository}/actions/runs/${String(runId)}/attempts/${String(attempt)}/jobs`,
        "-X",
        "GET",
        "-f",
        "per_page=100",
      ]).jobs,
    readLatestRun: readLatestCandidateRun,
    resultPublicationFinished: (repository, source) =>
      resultPublicationFinished(repository, source, runGhJson),
    readPullRequest: (repository, pullRequestNumber) =>
      runGhJson([
        "api",
        `repos/${repository}/pulls/${String(pullRequestNumber)}`,
      ]),
    resolveRepository: () =>
      runGhJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner,
    sleep: (milliseconds) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  };
}

function readCommitStatusHistory(repository, headSha, pr) {
  const history = [];
  for (let page = 1; ; page++) {
    const result = runGhJson([
      "api",
      `repos/${repository}/commits/${headSha}/statuses?per_page=100&page=${page}`,
      "--jq",
      `{count:length,statuses:[.[] | select(.context == "${FINAL_CANDIDATE_CONTEXT}" or .context == "${receiptContext(pr)}") | {state,context,description,target_url,created_at,id}]}`,
    ]);
    history.push(...result.statuses);
    if (
      result.count < 100 ||
      result.statuses.some((status) => isRequestOrTakeover(status, pr))
    ) {
      return history;
    }
  }
}

export function readLatestCandidateRun(
  repository,
  headSha,
  prNumber,
  read = runGhJson
) {
  const prefix = `Final Candidate PR #${prNumber} @ ${headSha} [`;
  for (let page = 1; ; page++) {
    const { workflow_runs: runs, total_count: total } = read([
      "api",
      `repos/${repository}/actions/workflows/${FINAL_CANDIDATE_WORKFLOW}/runs?event=pull_request&head_sha=${headSha}&per_page=100&page=${page}`,
    ]);
    const match = runs.find((run) => {
      if (
        run.head_sha !== headSha ||
        run.display_title?.startsWith("Ignored Final Candidate")
      ) {
        return false;
      }
      const linked = run.pull_requests?.some((pr) => pr.number === prNumber);
      if (run.display_title?.startsWith("Final Candidate PR ")) {
        // Older inline publishers named the confidence but did not name a base.
        const ownTitle =
          expectsResultPublication(run, prNumber, headSha) ||
          run.display_title === `${prefix}standard]` ||
          run.display_title === `${prefix}full]`;
        return ownTitle && (!run.pull_requests?.length || linked);
      }
      return run.pull_requests?.length === 1 && linked;
    });
    if (match || runs.length < 100 || page * 100 >= total) {
      return match ?? null;
    }
  }
}

function observationFingerprint(observation) {
  return [
    observation.headSha,
    observation.baseSha,
    observation.state,
    observation.reason,
    observation.runId,
    observation.runStatus,
    observation.runConclusion,
    observation.exactStatus,
    observation.sharedGateStatus,
  ].join(":");
}

function requirePositiveInteger(value, option) {
  const parsed = Number.parseInt(String(value), 10);
  if (!(Number.isInteger(parsed) && parsed > 0)) {
    throw new Error(`${option} requires a positive integer.`);
  }
  return parsed;
}

function runGhJson(args) {
  const stdout = execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 2,
  });
  return JSON.parse(stdout);
}

function renderHelp() {
  return "OpenMeld Final Candidate status\n\nUsage:\n  ... trusted-final-candidate.sh status --pr <number>\n  ... trusted-final-candidate.sh wait --pr <number>\n\nThe wait command polls quietly and prints only state transitions plus the final result. Full logs remain in GitHub.\n";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runFinalCandidateObserver({
      argv: process.argv.slice(2),
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
