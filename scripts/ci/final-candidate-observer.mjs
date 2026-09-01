#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ACTIONS_BUDGET_PATTERN =
  /Actions budget is preventing further use|spending limit needs to be increased|recent account payments have failed/iu;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const FINAL_CANDIDATE_CONTEXT = "OpenMeld Final Candidate";
const FINAL_CANDIDATE_WORKFLOW = "final-candidate.yml";
const DEFAULT_INTERVAL_SECONDS = 30;
const DEFAULT_TIMEOUT_SECONDS = 75 * 60;

export function buildFinalCandidateObservation(input) {
  const sharedStatus = input.commitStatuses.find(
    (status) => status.context === FINAL_CANDIDATE_CONTEXT
  );
  const exactStatus = resolveExactStatus(sharedStatus, input.pullRequest);
  const annotationMessages = input.jobs.flatMap((job) =>
    (input.annotationsByCheckRunId.get(job.id) ?? []).map((annotation) =>
      String(annotation.message ?? "").trim()
    )
  );
  const budgetMessage = annotationMessages.find((message) =>
    ACTIONS_BUDGET_PATTERN.test(message)
  );
  const candidateRunner = input.jobs.find(
    (job) => job.name === "Final Candidate Runner"
  );
  const candidateChecksStarted = Boolean(candidateRunner?.steps?.length);
  const common = {
    baseSha: input.pullRequest.base.sha,
    candidateChecksStarted,
    exactStatus,
    headSha: input.pullRequest.head.sha,
    hostedAvailability: budgetMessage ? "unavailable" : "available",
    pullRequestNumber: input.pullRequest.number,
    pullRequestUrl: input.pullRequest.html_url,
    runConclusion: input.run?.conclusion ?? null,
    runId: input.run?.id ?? null,
    runStatus: input.run?.status ?? null,
    runUrl: input.run?.html_url ?? null,
  };

  if (exactStatus === "success") {
    return {
      ...common,
      ...(budgetMessage ? { detail: budgetMessage } : {}),
      reason: "exact-status-success",
      state: "success",
    };
  }
  if (!input.run) {
    return { ...common, reason: "run-not-created", state: "waiting" };
  }
  if (budgetMessage) {
    return {
      ...common,
      detail: budgetMessage,
      reason: "actions-budget",
      state: "hosted-unavailable",
    };
  }
  if (input.run.status !== "completed") {
    return { ...common, reason: "run-in-progress", state: "waiting" };
  }
  if (input.run.conclusion === "success") {
    return {
      ...common,
      reason:
        exactStatus === "stale-success"
          ? "exact-status-stale"
          : "exact-status-missing",
      state: "failure",
    };
  }
  return {
    ...common,
    reason: `run-${input.run.conclusion ?? "failed"}`,
    state: "failure",
  };
}

function resolveExactStatus(status, pullRequest) {
  if (!status) {
    return "missing";
  }
  if (status.state !== "success") {
    return status.state;
  }
  const expectedIdentity = `@ ${pullRequest.head.sha.slice(0, 12)} on ${pullRequest.base.sha.slice(0, 12)}`;
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
  ];
  if (observation.runId) {
    lines.push(
      `Run: ${String(observation.runId)} (${observation.runStatus}/${observation.runConclusion ?? "none"})`,
      `Evidence: ${observation.runUrl}`
    );
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
  let previousFingerprint = null;

  while (true) {
    const observation = await readObservation({
      adapters,
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
  if (!EXACT_SHA_PATTERN.test(String(pullRequest.head?.sha ?? ""))) {
    throw new Error("GitHub did not return an exact pull request head SHA.");
  }
  if (!EXACT_SHA_PATTERN.test(String(pullRequest.base?.sha ?? ""))) {
    throw new Error("GitHub did not return an exact pull request base SHA.");
  }
  const run = await input.adapters.readLatestRun(
    input.repository,
    pullRequest.head.sha
  );
  const jobs = run
    ? await input.adapters.readJobs(input.repository, run.id)
    : [];
  const annotationsByCheckRunId = new Map();
  for (const job of jobs) {
    if (job.conclusion !== "failure") {
      continue;
    }
    annotationsByCheckRunId.set(
      job.id,
      await input.adapters.readAnnotations(input.repository, job.id)
    );
  }
  const commitStatuses = await input.adapters.readCommitStatuses(
    input.repository,
    pullRequest.head.sha
  );
  return buildFinalCandidateObservation({
    annotationsByCheckRunId,
    commitStatuses,
    jobs,
    pullRequest,
    run,
  });
}

function defaultAdapters() {
  return {
    now: () => Date.now(),
    readAnnotations: (repository, checkRunId) =>
      runGhJson([
        "api",
        `repos/${repository}/check-runs/${String(checkRunId)}/annotations`,
      ]),
    readCommitStatuses: (repository, headSha) =>
      runGhJson(["api", `repos/${repository}/commits/${headSha}/status`])
        .statuses,
    readJobs: (repository, runId) =>
      runGhJson([
        "api",
        `repos/${repository}/actions/runs/${String(runId)}/jobs`,
        "-X",
        "GET",
        "-f",
        "per_page=100",
      ]).jobs,
    readLatestRun: (repository, headSha) => {
      const runs = runGhJson([
        "api",
        `repos/${repository}/actions/workflows/${FINAL_CANDIDATE_WORKFLOW}/runs`,
        "-X",
        "GET",
        "-f",
        `head_sha=${headSha}`,
        "-f",
        "event=pull_request_target",
        "-f",
        "per_page=10",
      ]).workflow_runs;
      return runs.find((run) => run.head_sha === headSha) ?? null;
    },
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
