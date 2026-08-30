import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProductionReleaseStatusArgs,
  resolveLatestSuccessfulReleaseSources,
  runProductionReleaseStatus,
} from "./production-release-status.mjs";

const SOURCE_SHA = "79178c150dc976b13f05d84a7711465c44447e3c";
const CHANGE_BASE_SHA = "06fd4b88b75ef576db88289305a550c9e85efad5";
const WEB_SHA = "c20057269eba7a1505fe3374d2c8c6e6b903bb00";
const CORE_SHA = "dabcc83d83747b50c4756c5ceb3190012baf5c69";
const CLI_SHA = "19c16cee2acbddddff77b8fac9afdbfb14c11b86";
const GATEWAY_REMOTE_SHA = "9683abd4aeed3f13a8df79e4e7b3763f75faec14";
const DATABASE_AUTH_SHA = "e82eaa4ebd1d023da2e8446c91db1a90abdeb011";
const RELEASE_SCOPES_FOR_TEST = [
  "db",
  "web",
  "gateway",
  "auth",
  "cli",
  "core",
  "remote-agent",
];
const BLOCKED_STATE_REGEX = /Deployment state \(global-backlog\): blocked/u;
const READY_STATE_REGEX = /Deployment state \(global-backlog\): ready/u;
const FULL_PENDING_SCOPES_REGEX =
  /Global pending scopes: db, web, gateway, auth, cli, core, remote-agent/u;
const PUSH_GUARD_FAILURE_REGEX = /Historical Push Guard: failure/u;
const FULL_RELEASE_RECOMMENDATION_REGEX =
  /CLI Release owns the CLI and required Core projection; Scoped Production Release inputs are separate: database, web, gateway, auth, remote-agent/u;
const DATABASE_RELEASE_RECOMMENDATION_REGEX =
  /Scoped Production Release input: database/u;
const EXTERNAL_VALIDATION_REGEX =
  /Source validation: no push check evidence; confirm exact Final Candidate evidence/u;
const RECORDED_VALIDATION_REGEX =
  /Source validation: recorded push checks passed/u;
const WEB_SCOPE_PATTERN = /web/u;
const UNRELATED_MISSING_SCOPES_PATTERN = /db, gateway, auth, cli, core/u;

const RELEASE_RUNS = [
  releaseRun({
    conclusion: "failure",
    createdAt: "2026-07-15T20:24:31Z",
    databaseId: 29_448_168_904,
    headSha: WEB_SHA,
    workflowName: "🚀 Scoped Production Release",
  }),
  releaseRun({
    conclusion: "success",
    createdAt: "2026-07-15T20:09:17Z",
    databaseId: 29_447_217_195,
    headSha: WEB_SHA,
    workflowName: "🚀 Scoped Production Release",
  }),
  releaseRun({
    conclusion: "success",
    createdAt: "2026-07-15T19:58:43Z",
    databaseId: 29_446_538_975,
    headSha: CORE_SHA,
    workflowName: "🚀 Scoped Production Release",
  }),
  releaseRun({
    conclusion: "success",
    createdAt: "2026-07-15T18:37:37Z",
    databaseId: 29_441_305_612,
    headSha: SOURCE_SHA,
    workflowName: "📦 CLI Release",
  }),
  releaseRun({
    conclusion: "success",
    createdAt: "2026-07-15T11:27:17Z",
    databaseId: 29_411_679_542,
    headSha: DATABASE_AUTH_SHA,
    workflowName: "📦 CLI Release",
  }),
  releaseRun({
    conclusion: "success",
    createdAt: "2026-07-15T09:58:54Z",
    databaseId: 29_406_486_374,
    headSha: GATEWAY_REMOTE_SHA,
    workflowName: "🚪 Deploy Gateway Worker",
  }),
  releaseRun({
    conclusion: "success",
    createdAt: "2026-07-15T09:56:47Z",
    databaseId: 29_406_361_325,
    headSha: GATEWAY_REMOTE_SHA,
    workflowName: "🤖 Deploy Remote Agent Worker",
  }),
];

const JOBS_BY_RUN = new Map([
  [
    29_448_168_904,
    [
      releaseJob(
        "Release Core Worker / ⚙️ Deploy Core Worker",
        WEB_SHA,
        "failure"
      ),
    ],
  ],
  [29_447_217_195, [releaseJob("Release Web / 🌐 Deploy Web", WEB_SHA)]],
  [
    29_446_538_975,
    [releaseJob("Release Core Worker / ⚙️ Deploy Core Worker", CORE_SHA)],
  ],
  [29_441_305_612, [releaseJob("Publish CLI And Release Core", CLI_SHA)]],
  [
    29_411_679_542,
    [
      releaseJob("Apply Production DB Migrations", DATABASE_AUTH_SHA),
      releaseJob(
        "Release Auth Worker / 🛡️ Deploy Auth Worker",
        DATABASE_AUTH_SHA
      ),
    ],
  ],
  [
    29_406_486_374,
    [releaseJob("🚪 Deploy Gateway Worker", GATEWAY_REMOTE_SHA)],
  ],
  [
    29_406_361_325,
    [releaseJob("🤖 Deploy Remote Agent Worker", GATEWAY_REMOTE_SHA)],
  ],
]);

test("parses the read-only remote release status command", () => {
  assert.deepEqual(
    parseProductionReleaseStatusArgs([
      "--",
      "--ref",
      "origin/main",
      "--repo",
      "amplifthq/openmeld",
      "--deployed",
      `web=${WEB_SHA}`,
      "--json",
    ]),
    {
      changeBase: undefined,
      deployed: new Map([["web", WEB_SHA]]),
      json: true,
      ref: "origin/main",
      repo: "amplifthq/openmeld",
    }
  );
});

test("separates the exact current-change scopes from the global deployment backlog", async () => {
  let output = "";
  const adapters = releaseStatusAdapters({ pushChecks: [] });
  adapters.resolveRef = (ref) =>
    ref === "change-base" ? CHANGE_BASE_SHA : SOURCE_SHA;
  adapters.buildPlan = ({ base }) => ({
    changedPaths:
      base === CHANGE_BASE_SHA
        ? ["clients/web/src/routes/people.tsx"]
        : ["historical-backlog"],
    scopes: base === CHANGE_BASE_SHA ? ["web"] : [...RELEASE_SCOPES_FOR_TEST],
  });

  const exitCode = await runProductionReleaseStatus({
    adapters,
    argv: ["--ref", "origin/main", "--change-base", "change-base", "--json"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  const result = JSON.parse(output);
  assert.deepEqual(result.currentChange.scopes, ["web"]);
  assert.deepEqual(result.currentChange.pendingScopes, ["web"]);
  assert.deepEqual(result.globalPendingScopes, RELEASE_SCOPES_FOR_TEST);
  assert.equal(result.scopeBasis, "current-change");
  assert.match(result.workflowMapping, WEB_SCOPE_PATTERN);
});

test("does not block one current-change scope on unrelated missing deployment history", async () => {
  let output = "";
  const adapters = releaseStatusAdapters({ pushChecks: [] });
  adapters.resolveRef = (ref) =>
    ref === "change-base" ? CHANGE_BASE_SHA : SOURCE_SHA;
  adapters.buildPlan = ({ base }) => ({
    changedPaths: base === CHANGE_BASE_SHA ? ["clients/web/src/app.tsx"] : [],
    scopes: ["web"],
  });
  adapters.readReleaseRuns = async () => [RELEASE_RUNS[1]];

  const exitCode = await runProductionReleaseStatus({
    adapters,
    argv: ["--ref", "origin/main", "--change-base", "change-base", "--json"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  const result = JSON.parse(output);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.state, "ready");
  assert.equal(result.globalState, "blocked");
  assert.match(
    result.globalBlockers[0].detail,
    UNRELATED_MISSING_SCOPES_PATTERN
  );
});

test("uses successful deploy jobs even when a parent workflow later fails", () => {
  const sources = resolveLatestSuccessfulReleaseSources({
    jobsByRunId: JOBS_BY_RUN,
    runs: RELEASE_RUNS,
    sourceIsAncestor: () => true,
  });

  assert.deepEqual(
    Object.fromEntries(
      [...sources].map(([scope, source]) => [scope, source.sha])
    ),
    {
      auth: DATABASE_AUTH_SHA,
      cli: CLI_SHA,
      core: CORE_SHA,
      db: DATABASE_AUTH_SHA,
      gateway: GATEWAY_REMOTE_SHA,
      "remote-agent": GATEWAY_REMOTE_SHA,
      web: WEB_SHA,
    }
  );
});

test("recognizes guarded local release evidence without manual deployed overrides", async () => {
  let output = "";
  const adapters = releaseStatusAdapters({ pushChecks: [] });
  adapters.buildPlan = () => ({ changedPaths: [], scopes: [] });
  adapters.readReleaseRuns = async () =>
    RELEASE_RUNS.filter((run) => run.databaseId !== 29_441_305_612);
  adapters.readLocalReleaseSources = async () =>
    new Map([
      [
        "cli",
        {
          sha: SOURCE_SHA,
          source: "guarded-local",
          url: undefined,
        },
      ],
      [
        "core",
        {
          sha: SOURCE_SHA,
          source: "guarded-local",
          url: undefined,
        },
      ],
    ]);

  const exitCode = await runProductionReleaseStatus({
    adapters,
    argv: ["--ref", "origin/main", "--json"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  const result = JSON.parse(output);
  assert.equal(result.globalState, "current");
  assert.deepEqual(result.globalPendingScopes, []);
  assert.equal(
    result.components.find((component) => component.scope === "cli").source,
    "guarded-local"
  );
  assert.equal(
    result.components.find((component) => component.scope === "core").source,
    "guarded-local"
  );
});

test("reports pending full release scopes and fails closed on a red push check", async () => {
  let output = "";
  const exitCode = await runProductionReleaseStatus({
    adapters: releaseStatusAdapters({
      pushChecks: [
        {
          conclusion: "failure",
          event: "push",
          status: "completed",
          url: "https://github.com/amplifthq/openmeld/actions/runs/29475487257",
          workflowName: "Historical Push Guard",
        },
      ],
    }),
    argv: ["--ref", "origin/main"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output, BLOCKED_STATE_REGEX);
  assert.match(output, FULL_PENDING_SCOPES_REGEX);
  assert.match(output, PUSH_GUARD_FAILURE_REGEX);
  assert.match(output, FULL_RELEASE_RECOMMENDATION_REGEX);
});

test("reports a remote full release as ready when push checks are green", async () => {
  let output = "";
  const exitCode = await runProductionReleaseStatus({
    adapters: releaseStatusAdapters({
      pushChecks: [
        {
          conclusion: "success",
          event: "push",
          status: "completed",
          url: "https://github.com/amplifthq/openmeld/actions/runs/29475487258",
          workflowName: "Historical Push Guard",
        },
      ],
    }),
    argv: ["--ref", "origin/main"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  assert.match(output, READY_STATE_REGEX);
  assert.match(output, RECORDED_VALIDATION_REGEX);
  assert.match(output, FULL_RELEASE_RECOMMENDATION_REGEX);
});

test("does not require a conditional post-merge workflow for unrelated commits", async () => {
  let output = "";
  const exitCode = await runProductionReleaseStatus({
    adapters: releaseStatusAdapters({ pushChecks: [] }),
    argv: ["--ref", "origin/main"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  assert.match(output, READY_STATE_REGEX);
  assert.match(output, EXTERNAL_VALIDATION_REGEX);
});

test("uses the GitHub database scope name in a partial recommendation", async () => {
  let output = "";
  const adapters = releaseStatusAdapters({ pushChecks: [] });
  adapters.buildPlan = () => ({ scopes: ["db"] });

  const exitCode = await runProductionReleaseStatus({
    adapters,
    argv: ["--ref", "origin/main"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  assert.match(output, DATABASE_RELEASE_RECOMMENDATION_REGEX);
});

function releaseStatusAdapters({ pushChecks }) {
  return {
    buildPlan: () => ({
      scopes: ["db", "web", "gateway", "auth", "cli", "core", "remote-agent"],
    }),
    readPushChecks: async () => pushChecks,
    readJobReleaseSha: async (job) => job.releaseSha,
    readLocalReleaseSources: async () => new Map(),
    readReleaseJobs: async (runId) => JOBS_BY_RUN.get(runId) ?? [],
    readReleaseRuns: async () => RELEASE_RUNS,
    resolveRef: () => SOURCE_SHA,
    resolveRepo: () => "amplifthq/openmeld",
    sourceIsAncestor: () => true,
  };
}

function releaseRun(input) {
  return {
    conclusion: input.conclusion,
    createdAt: input.createdAt,
    databaseId: input.databaseId,
    headSha: input.headSha,
    url: `https://github.com/amplifthq/openmeld/actions/runs/${String(input.databaseId)}`,
    workflowName: input.workflowName,
  };
}

function releaseJob(name, releaseSha, conclusion = "success") {
  return { conclusion, name, releaseSha };
}
