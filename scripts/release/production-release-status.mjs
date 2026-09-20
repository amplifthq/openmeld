#!/usr/bin/env node

import { execFile, execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { buildProductionReleasePlan } from "./production-release.mjs";
import { readGuardedLocalReleaseSources } from "./production-release-evidence.mjs";
import {
  RELEASE_SCOPES,
  readGithubReleaseJobs,
  readGithubReleaseRuns,
  releaseWorkflowScopes,
} from "./production-release-history.mjs";

const DEFAULT_REF = "origin/main";
const execFileAsync = promisify(execFile);
const CHECKOUT_SOURCE_REGEX =
  /git log -1 --format=%H[^\r\n]*\r?\n[^\r\n]*\b([0-9a-f]{40})\b/u;
const LINE_SPLIT_REGEX = /\r?\n/u;
const RELEASE_JOB_BATCH_SIZE = 6;
const RELEASE_TITLE_SOURCE_REGEX = /@ ([0-9a-f]{40})$/u;
const SCOPED_RELEASE_WORKFLOW_REGEX = /Scoped Production Release/u;
const EXACT_SOURCE_SHA = /^[0-9a-f]{40}$/u;
const SUCCESSFUL_JOB_SCOPES = [
  {
    patterns: [
      /Apply Production DB Migrations/u,
      /Release Production Database/u,
      /Synchronize Production Database/u,
    ],
    scope: "db",
  },
  { patterns: [/Deploy Web/u], scope: "web" },
  { patterns: [/Deploy Gateway Worker/u], scope: "gateway" },
  { patterns: [/Deploy Auth Worker/u], scope: "auth" },
  { patterns: [/Publish CLI And Release Core/u], scope: "cli" },
  {
    patterns: [/Deploy Core Worker/u, /Publish CLI And Release Core/u],
    scope: "core",
  },
  { patterns: [/Deploy Remote Agent Worker/u], scope: "remote-agent" },
];

export function parseProductionReleaseStatusArgs(argv) {
  const options = {
    changeBase: undefined,
    deployed: new Map(),
    json: false,
    ref: DEFAULT_REF,
    repo: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--ref") {
      index += 1;
      options.ref = readRequiredArgument(argv, index, arg);
      continue;
    }
    if (arg === "--change-base") {
      index += 1;
      options.changeBase = readRequiredArgument(argv, index, arg);
      continue;
    }
    if (arg === "--repo") {
      index += 1;
      options.repo = readRequiredArgument(argv, index, arg);
      continue;
    }
    if (arg === "--deployed") {
      index += 1;
      const value = readRequiredArgument(argv, index, arg);
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) {
        throw new Error("--deployed must use <scope>=<commit>.");
      }
      const scope = value.slice(0, separator);
      const sha = value.slice(separator + 1);
      if (!RELEASE_SCOPES.includes(scope)) {
        throw new Error(`Unknown production release scope: ${scope}.`);
      }
      options.deployed.set(scope, sha);
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown production release status option: ${arg}`);
  }
  return options;
}

export function resolveLatestSuccessfulReleaseSources(input) {
  const sources = new Map();
  for (const run of input.runs) {
    const jobs = input.jobsByRunId.get(run.databaseId) ?? [];
    addSuccessfulReleaseSources({
      jobs,
      run,
      sourceIsAncestor: input.sourceIsAncestor,
      sources,
    });
  }
  return sources;
}

export async function runProductionReleaseStatus(input = {}) {
  const options = parseProductionReleaseStatusArgs(input.argv ?? []);
  const adapters = { ...defaultAdapters(), ...input.adapters };
  const write = input.write ?? ((value) => process.stdout.write(value));
  const repo = options.repo ?? adapters.resolveRepo();
  const sourceSha = adapters.resolveRef(options.ref);
  const changeBaseSha = resolveChangeBaseSha({
    adapters,
    changeBase: options.changeBase,
    sourceSha,
  });
  const { sources, history } = await readHostedReleaseState(
    adapters,
    repo,
    sourceSha
  );
  try {
    mergeGuardedLocalReleaseSources({
      localSources: await adapters.readLocalReleaseSources(repo),
      sourceIsAncestor: adapters.sourceIsAncestor,
      sourceSha,
      sources,
    });
  } catch (error) {
    history.issues.push({
      scopes: RELEASE_SCOPES,
      detail: `Local deployment evidence unavailable: ${error.message}`,
    });
  }
  applyDeployedOverrides({
    deployed: options.deployed,
    sourceIsAncestor: adapters.sourceIsAncestor,
    sourceSha,
    sources,
  });

  const plansByBase = new Map();
  const components = [];
  const missingSources = [];
  const pendingScopes = [];
  for (const scope of RELEASE_SCOPES) {
    const releaseSource = sources.get(scope);
    const component = describeReleaseComponent({
      releaseSource,
      scope,
      history,
      plansByBase,
      adapters,
      sourceSha,
    });
    if (component.state === "unknown") {
      missingSources.push(scope);
    }
    if (component.state !== "current") {
      pendingScopes.push(scope);
    }
    components.push(component);
  }

  let pushReadError;
  let pushChecks = [];
  try {
    pushChecks = latestPushCheckPerWorkflow(
      await adapters.readPushChecks(repo, sourceSha)
    );
  } catch (error) {
    pushReadError = {
      name: "Source validation",
      detail: `Unable to read push checks: ${error.message}`,
    };
  }
  const pushCheckBlockers = pushChecks
    .filter((check) => !pushCheckPassed(check))
    .map((check) => ({
      detail:
        check.status === "completed"
          ? (check.conclusion ?? "unknown")
          : check.status,
      name: check.workflowName,
      url: check.url,
    }));
  const currentChange = changeBaseSha
    ? buildCurrentChangeFacts({
        baseRef: options.changeBase,
        baseSha: changeBaseSha,
        buildPlan: adapters.buildPlan,
        globalPendingScopes: pendingScopes,
        sourceSha,
      })
    : null;
  if (pushReadError) {
    pushCheckBlockers.push(pushReadError);
  }
  if (currentChange?.error) {
    pushCheckBlockers.push({
      name: "Current-change plan",
      detail: currentChange.error,
    });
  }
  const scopeBasis = currentChange ? "current-change" : "global-backlog";
  const relevantMissingSources = currentChange
    ? missingSources.filter((scope) => currentChange.scopes.includes(scope))
    : missingSources;
  const blockers = buildReleaseStatusBlockers({
    missingSources: relevantMissingSources,
    components,
    pushCheckBlockers,
  });
  const globalBlockers = buildReleaseStatusBlockers({
    missingSources,
    components,
    pushCheckBlockers,
  });
  const scopedPendingScopes = currentChange?.pendingScopes ?? pendingScopes;
  const workflowMapping = releaseWorkflowMapping(scopedPendingScopes);

  const result = {
    blockers,
    history: {
      ...history,
      complete: history.complete && history.issues.length === 0,
    },
    components,
    currentChange,
    globalBlockers,
    globalPendingScopes: pendingScopes,
    globalState: resolveReleaseState(globalBlockers, pendingScopes),
    pendingScopes,
    recommendation: workflowMapping,
    ref: options.ref,
    repo,
    scopeBasis,
    sourceSha,
    sourceValidation: describeSourceValidation(pushChecks, pushCheckBlockers),
    state: resolveReleaseState(blockers, scopedPendingScopes),
    workflowMapping,
  };
  write(
    options.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatReleaseStatus(result)
  );
  return blockers.length > 0 ? 1 : 0;
}

function mergeGuardedLocalReleaseSources(input) {
  for (const [scope, localSource] of input.localSources) {
    if (
      !(
        RELEASE_SCOPES.includes(scope) &&
        input.sourceIsAncestor(localSource.sha, input.sourceSha)
      )
    ) {
      continue;
    }
    selectLatestSource(input.sources, scope, localSource);
  }
}

function readRecordedAt(source, label) {
  const value = Date.parse(String(source.recordedAt ?? ""));
  if (Number.isNaN(value)) {
    throw new Error(`${label} requires a valid recordedAt timestamp.`);
  }
  return value;
}

function buildReleaseStatusBlockers(input) {
  const blockers = [...input.pushCheckBlockers];
  if (input.missingSources.length > 0) {
    blockers.push({
      detail: `missing successful deployment history for ${input.missingSources.join(", ")}`,
      name: "Deployment history",
      url: undefined,
    });
  }
  for (const component of input.components ?? []) {
    if (input.missingSources.includes(component.scope) && component.reason) {
      blockers.push({
        name: `${component.scope} deployment evidence`,
        detail: component.reason,
      });
    }
  }
  return blockers;
}

function resolveChangeBaseSha(input) {
  if (!input.changeBase) {
    return null;
  }
  const changeBaseSha = input.adapters.resolveRef(input.changeBase);
  if (!input.adapters.sourceIsAncestor(changeBaseSha, input.sourceSha)) {
    throw new Error(
      `Current-change base ${changeBaseSha} is not an ancestor of ${input.sourceSha}.`
    );
  }
  return changeBaseSha;
}

function buildCurrentChangeFacts(input) {
  let plan;
  try {
    plan = input.buildPlan({ base: input.baseSha, sourceSha: input.sourceSha });
  } catch (error) {
    return {
      baseRef: input.baseRef,
      baseSha: input.baseSha,
      changedPaths: [],
      scopes: [],
      pendingScopes: [],
      error: error.message,
    };
  }
  return {
    baseRef: input.baseRef,
    baseSha: input.baseSha,
    changedPaths: plan.changedPaths,
    pendingScopes: plan.scopes.filter((scope) =>
      input.globalPendingScopes.includes(scope)
    ),
    scopes: plan.scopes,
  };
}

async function readHostedReleaseState(adapters, repo, sourceSha) {
  let response;
  try {
    response = await adapters.readReleaseRuns(repo);
  } catch (error) {
    response = {
      runs: [],
      complete: false,
      issues: [
        {
          scopes: RELEASE_SCOPES,
          detail: `Hosted release history unavailable: ${error.message}`,
        },
      ],
    };
  }
  const runs = (Array.isArray(response) ? response : response.runs).filter(
    (run) => releaseWorkflowScopes(run.workflowName).length > 0
  );
  const history = {
    complete: Array.isArray(response) || response.complete,
    runCount: runs.length,
    pagesRead: response.pagesRead ?? null,
    issues: [...(response.issues ?? [])],
  };
  const sources = await readLatestSuccessfulReleaseSources({
    ...adapters,
    runs,
    repo,
    issues: history.issues,
    sourceIsAncestor: (sha) => adapters.sourceIsAncestor(sha, sourceSha),
  });
  return { sources, history };
}

function describeReleaseComponent(input) {
  const { releaseSource, scope, history, plansByBase, adapters, sourceSha } =
    input;
  const unknown = (reason) => ({
    ...releaseSource,
    scope,
    state: "unknown",
    reason,
  });
  const latestTime = releaseSource
    ? Date.parse(releaseSource.recordedAt)
    : Number.NaN;
  const unresolved = history.issues.find(
    (issue) =>
      issue.scopes.includes(scope) &&
      (!(issue.recordedAt && Number.isFinite(latestTime)) ||
        Date.parse(issue.recordedAt) >= latestTime)
  );
  if (unresolved) {
    return unknown(unresolved.detail);
  }
  if (!releaseSource) {
    return unknown("No successful deployment history was found.");
  }
  if (releaseSource.conflict) {
    return unknown(
      "Conflicting deployment events have the same completion time; reconcile their actual activation order."
    );
  }
  if (releaseSource.receipt && releaseSource.receipt.status !== "verified") {
    return unknown(
      `Local release is ${releaseSource.receipt.status}; reconcile the recorded component before releasing again.`
    );
  }
  let entry = plansByBase.get(releaseSource.sha);
  if (!entry) {
    try {
      entry = {
        plan: adapters.buildPlan({ base: releaseSource.sha, sourceSha }),
      };
    } catch (error) {
      entry = {
        error: `Historical plan from ${releaseSource.sha} failed: ${error.message}`,
      };
    }
    plansByBase.set(releaseSource.sha, entry);
  }
  if (entry.error) {
    return unknown(entry.error);
  }
  return {
    ...releaseSource,
    scope,
    state: entry.plan.scopes.includes(scope) ? "pending" : "current",
  };
}

async function readLatestSuccessfulReleaseSources(input) {
  const sources = new Map();
  for (
    let offset = 0;
    offset < input.runs.length;
    offset += RELEASE_JOB_BATCH_SIZE
  ) {
    const runs = input.runs.slice(offset, offset + RELEASE_JOB_BATCH_SIZE);
    const jobsByRun = await Promise.all(
      runs.map(async (run) => {
        try {
          return await input.readReleaseJobs(run.databaseId, input.repo);
        } catch (error) {
          return { jobs: [], complete: false, reason: error.message };
        }
      })
    );
    for (const [index, run] of runs.entries()) {
      const response = jobsByRun[index];
      if (!(Array.isArray(response) || response.complete)) {
        input.issues.push({
          scopes: releaseWorkflowScopes(run.workflowName),
          detail: `Jobs for run ${run.databaseId} are incomplete: ${response.reason}`,
          url: run.url,
        });
      }
      const jobs = Array.isArray(response) ? response : response.jobs;
      const jobsWithSources = [];
      for (const job of jobs) {
        if (job.conclusion !== "success" || !releaseJobScopes(job).length) {
          continue;
        }
        jobsWithSources.push(await readReleaseJobSource(job, run, input));
      }
      addSuccessfulReleaseSources({
        jobs: jobsWithSources,
        run,
        sourceIsAncestor: input.sourceIsAncestor,
        sources,
        issues: input.issues,
      });
    }
  }
  return sources;
}

async function readReleaseJobSource(job, run, input) {
  try {
    return {
      ...job,
      releaseSha: await input.readJobReleaseSha(job, input.repo, run),
    };
  } catch (error) {
    return { ...job, releaseSha: undefined, sourceError: error.message };
  }
}

function releaseJobScopes(job) {
  return SUCCESSFUL_JOB_SCOPES.filter((mapping) =>
    mapping.patterns.some((pattern) => pattern.test(job.name))
  ).map((mapping) => mapping.scope);
}

function addSuccessfulReleaseSources(input) {
  for (const job of input.jobs) {
    if (job.conclusion !== "success") {
      continue;
    }
    const scopes = releaseJobScopes(job);
    const recordedAt = job.completedAt ?? job.completed_at;
    try {
      readRecordedAt({ recordedAt }, "Hosted deployment completion");
      if (!EXACT_SOURCE_SHA.test(job.releaseSha ?? "")) {
        throw new Error(
          `Successful deployment source unavailable for run ${input.run.databaseId}: ${job.sourceError ?? "no exact checkout SHA"}`
        );
      }
      if (!input.sourceIsAncestor(job.releaseSha)) {
        continue;
      }
      for (const scope of scopes) {
        selectLatestSource(input.sources, scope, {
          recordedAt,
          runId: input.run.databaseId,
          jobId: job.id,
          attempt: job.run_attempt ?? input.run.attempt,
          sha: job.releaseSha,
          source: "github",
          url: input.run.url,
        });
      }
    } catch (error) {
      input.issues?.push({
        scopes,
        detail: error.message,
        recordedAt: Number.isFinite(Date.parse(recordedAt))
          ? recordedAt
          : undefined,
        url: input.run.url,
      });
    }
  }
}

function selectLatestSource(sources, scope, candidate) {
  const time = readRecordedAt(candidate, "Deployment evidence");
  const current = sources.get(scope);
  if (!current || time > readRecordedAt(current, "Deployment evidence")) {
    sources.set(scope, candidate);
    return;
  }
  if (time !== readRecordedAt(current, "Deployment evidence")) {
    return;
  }
  if (candidate.sha !== current.sha) {
    sources.set(scope, {
      ...(candidate.sha < current.sha ? candidate : current),
      conflict: true,
    });
  } else if (
    !current.conflict &&
    candidate.receipt &&
    (!current.receipt || candidate.receipt.status !== "verified")
  ) {
    sources.set(scope, candidate);
  }
}

function applyDeployedOverrides(input) {
  for (const [scope, sha] of input.deployed) {
    if (!input.sourceIsAncestor(sha, input.sourceSha)) {
      throw new Error(
        `Deployed override ${scope}=${sha} is not an ancestor of ${input.sourceSha}.`
      );
    }
    input.sources.set(scope, {
      runId: undefined,
      sha,
      source: "override",
      url: undefined,
    });
  }
}

function resolveReleaseState(blockers, pendingScopes) {
  if (blockers.length > 0) {
    return "blocked";
  }
  if (pendingScopes.length > 0) {
    return "ready";
  }
  return "current";
}

function describeSourceValidation(pushChecks, pushCheckBlockers) {
  if (pushChecks.length === 0) {
    return "no push check evidence; confirm exact Final Candidate evidence";
  }
  if (pushCheckBlockers.length === 0) {
    return "recorded push checks passed";
  }
  return "recorded push checks are not green";
}

function defaultAdapters() {
  let checkoutRepository;
  const resolveCheckoutRepository = () => {
    checkoutRepository ??= runGh([
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]).trim();
    return checkoutRepository;
  };
  return {
    buildPlan: ({ base, sourceSha }) =>
      buildProductionReleasePlan({
        base,
        changedPaths: splitLines(
          runGit(["diff", "--name-only", `${base}...${sourceSha}`])
        ),
        scope: "auto",
        sourceSha,
      }),
    readPushChecks: async (repo, sourceSha) =>
      (
        await runGhJsonAsync([
          "run",
          "list",
          "--repo",
          repo,
          "--commit",
          sourceSha,
          "--limit",
          "100",
          "--json",
          "workflowName,status,conclusion,event,url,createdAt",
        ])
      ).filter((run) => run.event === "push"),
    readLocalReleaseSources: (repo) => {
      assertGuardedLocalEvidenceRepository(repo, resolveCheckoutRepository());
      return readGuardedLocalReleaseSources();
    },
    readJobReleaseSha: async (job, repo, run) => {
      const titleSource = RELEASE_TITLE_SOURCE_REGEX.exec(
        run.displayTitle ?? ""
      )?.[1];
      if (titleSource) {
        return titleSource;
      }
      if (SCOPED_RELEASE_WORKFLOW_REGEX.test(run.workflowName)) {
        return run.headSha;
      }
      try {
        const log = await runGhAsync([
          "run",
          "view",
          "--repo",
          repo,
          "--job",
          String(job.id),
          "--log",
        ]);
        return CHECKOUT_SOURCE_REGEX.exec(log)?.[1];
      } catch (error) {
        throw new Error(
          `Cannot read checkout evidence for job ${job.id}: ${error.message}`,
          { cause: error }
        );
      }
    },
    readReleaseJobs: (runId, repo) =>
      readGithubReleaseJobs(runId, repo, (endpoint) =>
        runGhJsonAsync(["api", endpoint])
      ),
    readReleaseRuns: (repo) =>
      readGithubReleaseRuns(repo, (endpoint) =>
        runGhJsonAsync(["api", endpoint])
      ),
    resolveRef: (ref) =>
      runGit(["rev-parse", "--verify", `${ref}^{commit}`]).trim(),
    resolveRepo: resolveCheckoutRepository,
    sourceIsAncestor: (candidateSha, sourceSha) => {
      const result = spawnSync(
        resolveCommandBinary("git"),
        ["merge-base", "--is-ancestor", candidateSha, sourceSha],
        { stdio: "ignore" }
      );
      if (result.status === 0) {
        return true;
      }
      if (result.status === 1) {
        return false;
      }
      throw new Error(
        `Could not compare release source ${candidateSha} with ${sourceSha}. Fetch the missing Git history and retry.`
      );
    },
  };
}

export function assertGuardedLocalEvidenceRepository(
  selectedRepository,
  checkoutRepository
) {
  const selected = String(selectedRepository ?? "")
    .trim()
    .toLowerCase();
  const checkout = String(checkoutRepository ?? "")
    .trim()
    .toLowerCase();
  if (!(selected && checkout && selected === checkout)) {
    throw new Error(
      `Selected repository ${selectedRepository} does not match the current checkout repository ${checkoutRepository}; refusing to mix guarded local release evidence from origin.`
    );
  }
}

function latestPushCheckPerWorkflow(checks) {
  const latest = new Map();
  for (const check of checks) {
    if (!latest.has(check.workflowName)) {
      latest.set(check.workflowName, check);
    }
  }
  return [...latest.values()];
}

function pushCheckPassed(check) {
  return check.status === "completed" && check.conclusion === "success";
}

function releaseWorkflowMapping(pendingScopes) {
  if (pendingScopes.length === 0) {
    return "No matching production scope remains pending.";
  }
  if (pendingScopes.includes("cli")) {
    const remaining = pendingScopes.filter(
      (scope) => scope !== "cli" && scope !== "core"
    );
    return remaining.length === 0
      ? "CLI Release owns the CLI and required Core projection."
      : `CLI Release owns the CLI and required Core projection; ${scopedReleaseWorkflowMapping(remaining)}`;
  }
  return scopedReleaseWorkflowMapping(pendingScopes);
}

function scopedReleaseWorkflowMapping(scopes) {
  if (
    hasExactly(scopes, ["db", "web", "gateway", "auth", "core", "remote-agent"])
  ) {
    return "Scoped Production Release input: full.";
  }
  if (hasExactly(scopes, ["web", "gateway", "auth", "core", "remote-agent"])) {
    return "Scoped Production Release input: cloud.";
  }
  if (hasExactly(scopes, ["db", "auth"])) {
    return "Scoped Production Release input: database-auth.";
  }
  if (hasExactly(scopes, ["db", "core"])) {
    return "Scoped Production Release input: database-core.";
  }
  const githubScopes = scopes.map((scope) =>
    scope === "db" ? "database" : scope
  );
  if (githubScopes.length === 1) {
    return `Scoped Production Release input: ${githubScopes[0]}.`;
  }
  return `Scoped Production Release inputs are separate: ${githubScopes.join(", ")}.`;
}

function hasExactly(actual, expected) {
  return (
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

function formatReleaseStatus(result) {
  const lines = [
    "Production release status",
    `Source: ${result.sourceSha}`,
    `Repository: ${result.repo}`,
    `Deployment state (${result.scopeBasis}): ${result.state}`,
    `Global deployment backlog state: ${result.globalState}`,
    `Source validation: ${result.sourceValidation}`,
    `Scope basis: ${result.scopeBasis}`,
    `History coverage: ${result.history.complete ? "complete available history" : "incomplete; see evidence issues"}`,
    ...(result.currentChange
      ? [
          `Current change: ${result.currentChange.baseSha}...${result.sourceSha}`,
          `Current-change scopes: ${result.currentChange.scopes.length > 0 ? result.currentChange.scopes.join(", ") : "none"}`,
          `Current-change scopes still pending: ${result.currentChange.pendingScopes.length > 0 ? result.currentChange.pendingScopes.join(", ") : "none"}`,
        ]
      : [
          "Current change: not specified; pass --change-base <exact-merge-parent> to separate this delivery from historical backlog.",
        ]),
    `Global pending scopes: ${result.globalPendingScopes.length > 0 ? result.globalPendingScopes.join(", ") : "none"}`,
    `Workflow mapping (facts only): ${result.workflowMapping}`,
    "",
    "Components:",
  ];
  for (const component of result.components) {
    if (component.state === "unknown") {
      lines.push(
        `- ${component.scope}: unknown — ${component.reason ?? "deployment history not found"}`
      );
      continue;
    }
    lines.push(
      `- ${component.scope}: ${component.state} since ${component.sha.slice(0, 12)}${component.source === "override" ? " (local override)" : ""}`
    );
  }
  for (const issue of result.history.issues) {
    lines.push(`- History issue (${issue.scopes.join(", ")}): ${issue.detail}`);
  }
  lines.push("", "Blockers:");
  lines.push(
    ...(result.blockers.length > 0
      ? result.blockers.map(
          (blocker) =>
            `- ${blocker.name}: ${blocker.detail}${blocker.url ? ` (${blocker.url})` : ""}`
        )
      : ["- none"])
  );
  return `${lines.join("\n")}\n`;
}

function readRequiredArgument(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function runGh(args) {
  return execFileSync(resolveCommandBinary("gh"), args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
}

async function runGhAsync(args) {
  const result = await execFileAsync(resolveCommandBinary("gh"), args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 10,
  });
  return result.stdout;
}

async function runGhJsonAsync(args) {
  return JSON.parse(await runGhAsync(args));
}

function runGit(args) {
  return execFileSync(resolveCommandBinary("git"), args, {
    encoding: "utf8",
  });
}

function splitLines(value) {
  return String(value).split(LINE_SPLIT_REGEX).filter(Boolean);
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  if (command === "git" || command === "gh") {
    return `${command}.exe`;
  }
  return command;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runProductionReleaseStatus({
      argv: process.argv.slice(2),
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
