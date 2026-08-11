import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProductionReleaseStatusArgs,
  resolveLatestSuccessfulReleaseSources,
  runProductionReleaseStatus,
} from "./production-release-status.mjs";

const SOURCE_SHA = "79178c150dc976b13f05d84a7711465c44447e3c";
const WEB_SHA = "c20057269eba7a1505fe3374d2c8c6e6b903bb00";
const CORE_SHA = "dabcc83d83747b50c4756c5ceb3190012baf5c69";
const CLI_SHA = "19c16cee2acbddddff77b8fac9afdbfb14c11b86";
const GATEWAY_REMOTE_SHA = "9683abd4aeed3f13a8df79e4e7b3763f75faec14";
const DATABASE_AUTH_SHA = "e82eaa4ebd1d023da2e8446c91db1a90abdeb011";
const BLOCKED_STATE_REGEX = /Deployment state: blocked/u;
const READY_STATE_REGEX = /Deployment state: ready/u;
const FULL_PENDING_SCOPES_REGEX =
  /Pending scopes: db, web, gateway, auth, cli, core, remote-agent/u;
const MANIFEST_FAILURE_REGEX = /Local Components Manifest: failure/u;
const FULL_RELEASE_RECOMMENDATION_REGEX =
  /CLI Release: run CLI release directly; Scoped Production Release separate runs: database, then web, then gateway, then auth, then remote-agent/u;
const DATABASE_RELEASE_RECOMMENDATION_REGEX =
  /Scoped Production Release: database/u;
const EXTERNAL_VALIDATION_REGEX =
  /Source validation: no push check evidence; confirm Fast PR or equivalent/u;
const RECORDED_VALIDATION_REGEX =
  /Source validation: recorded push checks passed/u;

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
      deployed: new Map([["web", WEB_SHA]]),
      json: true,
      ref: "origin/main",
      repo: "amplifthq/openmeld",
    }
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
          workflowName: "Local Components Manifest",
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
  assert.match(output, MANIFEST_FAILURE_REGEX);
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
          workflowName: "Local Components Manifest",
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
