#!/usr/bin/env node

import { execFile, execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { buildProductionReleasePlan } from "./production-release.mjs";
import { readGuardedLocalReleaseSources } from "./production-release-evidence.mjs";

const DEFAULT_REF = "origin/main";
const execFileAsync = promisify(execFile);
const CHECKOUT_SOURCE_REGEX =
  /git log -1 --format=%H[^\r\n]*\r?\n[^\r\n]*\b([0-9a-f]{40})\b/u;
const LINE_SPLIT_REGEX = /\r?\n/u;
const RELEASE_JOB_BATCH_SIZE = 6;
const RELEASE_TITLE_SOURCE_REGEX = /@ ([0-9a-f]{40})$/u;
const SCOPED_RELEASE_WORKFLOW_REGEX = /Scoped Production Release/u;
const RELEASE_SCOPES = [
  "db",
  "web",
  "gateway",
  "auth",
  "cli",
  "core",
  "remote-agent",
];
const RELEASE_WORKFLOW_PATTERNS = [
  SCOPED_RELEASE_WORKFLOW_REGEX,
  /CLI Release/u,
  /Deploy (?:Auth|Core|Gateway|Remote Agent) Worker/u,
  /Deploy Web/u,
];
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
  const runs = (await adapters.readReleaseRuns(repo)).filter((run) =>
    RELEASE_WORKFLOW_PATTERNS.some((pattern) => pattern.test(run.workflowName))
  );
  const sources = await readLatestSuccessfulReleaseSources({
    readJobReleaseSha: adapters.readJobReleaseSha,
    readReleaseJobs: adapters.readReleaseJobs,
    repo,
    runs,
    sourceIsAncestor: (candidateSha) =>
      adapters.sourceIsAncestor(candidateSha, sourceSha),
  });
  mergeGuardedLocalReleaseSources({
    localSources: await adapters.readLocalReleaseSources(repo),
    sourceIsAncestor: adapters.sourceIsAncestor,
    sourceSha,
    sources,
  });
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
    if (!releaseSource) {
      missingSources.push(scope);
      pendingScopes.push(scope);
      components.push({ scope, state: "unknown" });
      continue;
    }
    let plan = plansByBase.get(releaseSource.sha);
    if (!plan) {
      plan = adapters.buildPlan({
        base: releaseSource.sha,
        sourceSha,
      });
      plansByBase.set(releaseSource.sha, plan);
    }
    const pending = plan.scopes.includes(scope);
    if (pending) {
      pendingScopes.push(scope);
    }
    components.push({
      ...releaseSource,
      scope,
      state: pending ? "pending" : "current",
    });
  }

  const pushChecks = latestPushCheckPerWorkflow(
    await adapters.readPushChecks(repo, sourceSha)
  );
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
  const scopeBasis = currentChange ? "current-change" : "global-backlog";
  const relevantMissingSources = currentChange
    ? missingSources.filter((scope) => currentChange.scopes.includes(scope))
    : missingSources;
  const blockers = buildReleaseStatusBlockers({
    missingSources: relevantMissingSources,
    pushCheckBlockers,
  });
  const globalBlockers = buildReleaseStatusBlockers({
    missingSources,
    pushCheckBlockers,
  });
  const scopedPendingScopes = currentChange?.pendingScopes ?? pendingScopes;
  const workflowMapping = releaseWorkflowMapping(scopedPendingScopes);

  const result = {
    blockers,
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
    const current = input.sources.get(scope);
    if (
      current &&
      readRecordedAt(localSource, "guarded local release evidence") <=
        readRecordedAt(current, "hosted release evidence")
    ) {
      continue;
    }
    input.sources.set(scope, localSource);
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
  const plan = input.buildPlan({
    base: input.baseSha,
    sourceSha: input.sourceSha,
  });
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

async function readLatestSuccessfulReleaseSources(input) {
  const sources = new Map();
  for (
    let offset = 0;
    offset < input.runs.length;
    offset += RELEASE_JOB_BATCH_SIZE
  ) {
    const runs = input.runs.slice(offset, offset + RELEASE_JOB_BATCH_SIZE);
    const jobsByRun = await Promise.all(
      runs.map((run) => input.readReleaseJobs(run.databaseId, input.repo))
    );
    for (const [index, run] of runs.entries()) {
      const jobsWithSources = [];
      for (const job of jobsByRun[index]) {
        if (jobCanFillReleaseSource(job, sources)) {
          jobsWithSources.push({
            ...job,
            releaseSha: await input.readJobReleaseSha(job, input.repo, run),
          });
        }
      }
      addSuccessfulReleaseSources({
        jobs: jobsWithSources,
        run,
        sourceIsAncestor: input.sourceIsAncestor,
        sources,
      });
      if (sources.size === RELEASE_SCOPES.length) {
        break;
      }
    }
    if (sources.size === RELEASE_SCOPES.length) {
      break;
    }
  }
  return sources;
}

function addSuccessfulReleaseSources(input) {
  for (const job of input.jobs) {
    if (
      job.conclusion !== "success" ||
      !job.releaseSha ||
      !input.sourceIsAncestor(job.releaseSha)
    ) {
      continue;
    }
    for (const mapping of SUCCESSFUL_JOB_SCOPES) {
      if (
        !input.sources.has(mapping.scope) &&
        mapping.patterns.some((pattern) => pattern.test(job.name))
      ) {
        input.sources.set(mapping.scope, {
          recordedAt: input.run.createdAt,
          runId: input.run.databaseId,
          sha: job.releaseSha,
          source: "github",
          url: input.run.url,
        });
      }
    }
  }
}

function jobCanFillReleaseSource(job, sources) {
  return (
    job.conclusion === "success" &&
    SUCCESSFUL_JOB_SCOPES.some(
      (mapping) =>
        !sources.has(mapping.scope) &&
        mapping.patterns.some((pattern) => pattern.test(job.name))
    )
  );
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
      } catch {
        return undefined;
      }
    },
    readReleaseJobs: (runId, repo) =>
      runGhJsonAsync([
        "api",
        `repos/${repo}/actions/runs/${String(runId)}/jobs?per_page=100`,
        "--jq",
        ".jobs",
      ]),
    readReleaseRuns: (repo) =>
      runGhJsonAsync([
        "run",
        "list",
        "--repo",
        repo,
        "--limit",
        "250",
        "--json",
        "databaseId,headSha,createdAt,conclusion,workflowName,displayTitle,url",
      ]),
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
      lines.push(`- ${component.scope}: deployment history not found`);
      continue;
    }
    lines.push(
      `- ${component.scope}: ${component.state} since ${component.sha.slice(0, 12)}${component.source === "override" ? " (local override)" : ""}`
    );
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
