import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertGuardedLocalEvidenceRepository,
  parseProductionReleaseStatusArgs,
  readGuardedReleaseSourcesForStatus,
  readMergedFinalCandidateEvidence,
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
const PLANNED_WEB_STAGE = /Receipt-based pending train: web/u;
const PLANNING_ONLY = /Planning snapshot only/u;
const DATABASE_RELEASE_RECOMMENDATION_REGEX =
  /Scoped Production Release input: database/u;
const EXTERNAL_VALIDATION_REGEX =
  /Source validation: exact merged PR Final Candidate passed/u;
const RECORDED_VALIDATION_REGEX =
  /Source validation: recorded push checks passed/u;
const WEB_SCOPE_PATTERN = /web/u;
const UNRELATED_MISSING_SCOPES_PATTERN = /db, gateway, auth, cli, core/u;
const REPOSITORY_MISMATCH_PATTERN =
  /does not match the current checkout repository/u;
const MISSING_EXACT_FINAL_CANDIDATE_PATTERN =
  /no exact successful OpenMeld Final Candidate status/u;
const HOSTED_RECEIPT_AUTH_FAILURE = /requires a token|workflow repository/u;

test(
  "hosted status authenticates private Git receipt reads without persisting credentials",
  {
    skip:
      process.platform === "win32" &&
      "Production release runners use Linux or macOS",
  },
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "openmeld-status-git-auth-"));
    const bin = path.join(root, "bin");
    const log = path.join(root, "git.json");
    const token = "fixture-status-token-not-real";
    const repositoryUrl = "https://github.com/amplifthq/openmeld.git";
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    try {
      execFileSync(realGit, ["init", "--quiet", root]);
      const configPath = path.join(root, ".git", "config");
      const configBefore = readFileSync(configPath, "utf8");
      mkdirSync(bin);
      const fakeGit = path.join(bin, "git");
      writeFileSync(
        fakeGit,
        [
          "#!/usr/bin/env node",
          'const {execFileSync}=require("node:child_process");',
          'const {writeFileSync}=require("node:fs");',
          "const args=process.argv.slice(2);",
          `const auth=execFileSync(${JSON.stringify(realGit)},["config","--get-urlmatch","http.extraheader",args[2]],{encoding:"utf8"}).trim();`,
          "writeFileSync(process.env.STATUS_GIT_LOG,JSON.stringify({args,auth,rawToken:process.env.GH_TOKEN,trace:process.env.GIT_TRACE_CURL}));",
          'if(args[0]!=="ls-remote" || !auth.startsWith("AUTHORIZATION: basic "))process.exit(128);',
          "",
        ].join("\n")
      );
      chmodSync(fakeGit, 0o755);
      const environment = {
        ...process.env,
        GH_TOKEN: token,
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "amplifthq/openmeld",
        GITHUB_SERVER_URL: "https://github.com",
        GIT_TRACE_CURL: "1",
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        STATUS_GIT_LOG: log,
      };
      const result = readGuardedReleaseSourcesForStatus({
        cwd: root,
        environment,
        repo: "amplifthq/openmeld",
      });
      assert.equal(result.size, 0);
      const observed = JSON.parse(readFileSync(log, "utf8"));
      assert.deepEqual(observed.args, [
        "ls-remote",
        "--refs",
        repositoryUrl,
        "refs/heads/openmeld-production-release-evidence/*",
      ]);
      assert.equal(
        observed.auth,
        `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`
      );
      assert.equal(observed.rawToken, undefined);
      assert.equal(observed.trace, undefined);
      assert.equal(readFileSync(configPath, "utf8"), configBefore);
      assert.equal(environment.GH_TOKEN, token);
      for (const overrides of [
        { GH_TOKEN: "" },
        { GITHUB_REPOSITORY: "another/repository" },
      ]) {
        assert.throws(
          () =>
            readGuardedReleaseSourcesForStatus({
              cwd: root,
              environment: { ...environment, ...overrides },
              repo: "amplifthq/openmeld",
            }),
          HOSTED_RECEIPT_AUTH_FAILURE
        );
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test("correlates the real PR #1215 squash identity with its exact Final Candidate", async () => {
  const mergeSha = "43d7b3dea65844dc87475fecb693f7864840e64e";
  const headSha = "94fa180d4a1101692f0fd7a095abb465a407a127";
  const baseSha = "2b7cbeb5d531e22bb7292482f3a2ded6f2c2613d";
  const treeSha = "cae1584e632b2f9f6eb6ee25d786f42804f25756";
  const evidence = await readMergedFinalCandidateEvidence({
    adapters: {
      readAssociatedPullRequests: async () => [
        {
          base: { ref: "main", sha: baseSha },
          head: { sha: headSha },
          html_url: "https://github.com/amplifthq/openmeld/pull/1215",
          merge_commit_sha: mergeSha,
          merged_at: "2026-09-22T02:10:39Z",
          number: 1215,
        },
      ],
      readCommitStatuses: async () => ({
        statuses: [
          {
            context: "OpenMeld Final Candidate",
            description: "Passed standard @ 94fa180d4a11 on 2b7cbeb5d531",
            state: "success",
            target_url:
              "https://github.com/amplifthq/openmeld/actions/runs/35678125482",
          },
        ],
      }),
      readGitCommit: async (_repo, sha) => ({
        parents: sha === mergeSha ? [{ sha: baseSha }] : [{ sha: baseSha }],
        tree: { sha: treeSha },
      }),
    },
    repo: "amplifthq/openmeld",
    sourceSha: mergeSha,
  });

  assert.deepEqual(evidence, {
    baseSha,
    headSha,
    kind: "merged-final-candidate",
    mergeSha,
    pullRequestNumber: 1215,
    pullRequestUrl: "https://github.com/amplifthq/openmeld/pull/1215",
    result: "passed",
    statusUrl: "https://github.com/amplifthq/openmeld/actions/runs/35678125482",
    treeSha,
  });
});

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
      releaseJob("Release Core Worker / ⚙️ Deploy Core Worker", WEB_SHA, {
        conclusion: "failure",
      }),
    ],
  ],
  [
    29_447_217_195,
    [
      releaseJob("Release Web / 🌐 Deploy Web", WEB_SHA, {
        completedAt: "2026-07-15T20:15:00Z",
      }),
    ],
  ],
  [
    29_446_538_975,
    [
      releaseJob("Release Core Worker / ⚙️ Deploy Core Worker", CORE_SHA, {
        completedAt: "2026-07-15T20:05:00Z",
      }),
    ],
  ],
  [
    29_441_305_612,
    [
      releaseJob("Publish CLI And Release Core", CLI_SHA, {
        completedAt: "2026-07-15T18:45:00Z",
      }),
    ],
  ],
  [
    29_411_679_542,
    [
      releaseJob("Apply Production DB Migrations", DATABASE_AUTH_SHA, {
        completedAt: "2026-07-15T11:35:00Z",
      }),
      releaseJob(
        "Release Auth Worker / 🛡️ Deploy Auth Worker",
        DATABASE_AUTH_SHA,
        { completedAt: "2026-07-15T11:40:00Z" }
      ),
    ],
  ],
  [
    29_406_486_374,
    [
      releaseJob("🚪 Deploy Gateway Worker", GATEWAY_REMOTE_SHA, {
        completedAt: "2026-07-15T10:05:00Z",
      }),
    ],
  ],
  [
    29_406_361_325,
    [
      releaseJob("🤖 Deploy Remote Agent Worker", GATEWAY_REMOTE_SHA, {
        completedAt: "2026-07-15T10:01:00Z",
      }),
    ],
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
      planStage: undefined,
      ref: "origin/main",
      repo: "amplifthq/openmeld",
    }
  );
});

test("one status read can plan a stage without collecting release history again", async () => {
  let reads = 0;
  let output = "";
  const code = await runProductionReleaseStatus({
    argv: ["--ref", SOURCE_SHA, "--plan-stage", "web"],
    collectStatus: () => {
      reads += 1;
      return {
        blockers: [],
        sourceValidationBlockers: [],
        sourceSha: SOURCE_SHA,
        components: [
          {
            scope: "web",
            state: "pending",
            compatibilityDependencies: [],
          },
        ],
        history: { complete: true, runCount: 1, pagesRead: 1, issues: [] },
        repo: "amplifthq/openmeld",
        ref: SOURCE_SHA,
        globalPendingScopes: ["web"],
      };
    },
    write: (value) => {
      output += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(reads, 1);
  assert.match(output, PLANNED_WEB_STAGE);
  assert.match(output, PLANNING_ONLY);
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

for (const [scope, packageProbe] of [
  ["website", "hasWebsitePackage"],
  ["docs", "hasDocsPackage"],
]) {
  test(`admits a first ${scope} publication without inventing history, but blocks missing history after the package existed`, async () => {
    const adapters = releaseStatusAdapters({ pushChecks: [] });
    for (const existedAtLastWebRelease of [false, true]) {
      adapters[packageProbe] = (sha) =>
        sha === SOURCE_SHA || existedAtLastWebRelease;
      let output = "";
      const code = await runProductionReleaseStatus({
        adapters,
        argv: ["--json"],
        write: (value) => {
          output += value;
        },
      });
      const website = JSON.parse(output).components.find(
        (component) => component.scope === scope
      );
      assert.equal(code, existedAtLastWebRelease ? 1 : 0, output);
      assert.equal(
        website.state,
        existedAtLastWebRelease ? "unknown" : "pending"
      );
      assert.equal(website.sha, undefined);
    }
  });
}

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
  assert.equal(sources.get("web")?.recordedAt, "2026-07-15T20:15:00Z");
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
          recordedAt: "2026-07-15T21:00:00Z",
          sha: SOURCE_SHA,
          source: "guarded-local",
          url: undefined,
        },
      ],
      [
        "core",
        {
          recordedAt: "2026-07-15T21:00:00Z",
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

test("uses a later guarded local rollback instead of a newer-SHA hosted release", async () => {
  let output = "";
  const adapters = releaseStatusAdapters({ pushChecks: [] });
  adapters.buildPlan = () => ({ changedPaths: [], scopes: ["web"] });
  adapters.readReleaseRuns = async () => [RELEASE_RUNS[1]];
  adapters.readLocalReleaseSources = async () =>
    new Map([
      [
        "web",
        {
          recordedAt: "2026-07-15T21:00:00Z",
          sha: GATEWAY_REMOTE_SHA,
          source: "guarded-local",
          url: undefined,
        },
      ],
    ]);
  adapters.sourceIsAncestor = (candidateSha, sourceSha) =>
    !(candidateSha === WEB_SHA && sourceSha === GATEWAY_REMOTE_SHA);

  const exitCode = await runProductionReleaseStatus({
    adapters,
    argv: ["--ref", "origin/main", "--change-base", CHANGE_BASE_SHA, "--json"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  const web = JSON.parse(output).components.find(
    (component) => component.scope === "web"
  );
  assert.equal(web.sha, GATEWAY_REMOTE_SHA);
  assert.equal(web.source, "guarded-local");
});

test("keeps a later hosted release ahead of stale guarded local evidence", async () => {
  let output = "";
  const adapters = releaseStatusAdapters({ pushChecks: [] });
  adapters.buildPlan = () => ({ changedPaths: [], scopes: ["web"] });
  adapters.readReleaseRuns = async () => [RELEASE_RUNS[1]];
  adapters.readLocalReleaseSources = async () =>
    new Map([
      [
        "web",
        {
          recordedAt: "2026-07-15T20:00:00Z",
          sha: GATEWAY_REMOTE_SHA,
          source: "guarded-local",
          url: undefined,
        },
      ],
    ]);

  const exitCode = await runProductionReleaseStatus({
    adapters,
    argv: ["--ref", "origin/main", "--change-base", CHANGE_BASE_SHA, "--json"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  const web = JSON.parse(output).components.find(
    (component) => component.scope === "web"
  );
  assert.equal(web.sha, WEB_SHA);
  assert.equal(web.source, "github");
});

test("does not mix guarded local evidence from another selected repository", () => {
  assert.doesNotThrow(() =>
    assertGuardedLocalEvidenceRepository(
      "amplifthq/openmeld",
      "AmpliftHQ/OpenMeld"
    )
  );
  assert.throws(
    () =>
      assertGuardedLocalEvidenceRepository(
        "another-owner/openmeld",
        "amplifthq/openmeld"
      ),
    REPOSITORY_MISMATCH_PATTERN
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

test("reports component source, version, artifact and result from a verified receipt", async () => {
  let output = "";
  const adapters = releaseStatusAdapters({
    pushChecks: [
      {
        conclusion: "success",
        event: "push",
        status: "completed",
        workflowName: "Push Guard",
      },
    ],
  });
  adapters.readLocalReleaseSources = async () =>
    new Map([
      [
        "web",
        {
          evidenceSha: "4".repeat(40),
          recordedAt: "2026-07-15T21:00:00Z",
          receipt: {
            application: "applied",
            identity: {
              deploymentId: "deployment-r3",
              environment: "prod",
              kind: "worker-deployment",
              sourceSha: SOURCE_SHA,
              versionId: "version-r3",
              workerName: "openmeld-web-prod",
            },
            status: "verified",
          },
          sha: SOURCE_SHA,
          source: "guarded-local",
        },
      ],
      [
        "cli",
        {
          evidenceSha: "5".repeat(40),
          recordedAt: "2026-07-15T21:00:00Z",
          receipt: {
            application: "applied",
            identity: {
              artifact: {
                archiveFormat: "gzip",
                archiveSha256: "7".repeat(64),
                archiveSizeBytes: 50,
                archiveUrl: "https://openmeld.ai/cli/openmeld.gz",
                platform: "darwin-arm64",
                sha256: "6".repeat(64),
                sizeBytes: 100,
                url: "https://openmeld.ai/cli/openmeld",
              },
              kind: "cli-release",
              npmPackage: "openmeld",
              tagName: "v0.3.217",
              version: "0.3.217",
            },
            status: "verified",
          },
          sha: SOURCE_SHA,
          source: "guarded-local",
        },
      ],
    ]);
  adapters.buildPlan = () => ({ changedPaths: [], scopes: [] });

  const exitCode = await runProductionReleaseStatus({
    adapters,
    argv: ["--ref", "origin/main", "--json"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  const web = JSON.parse(output).components.find(
    (component) => component.scope === "web"
  );
  assert.deepEqual(web.evidence, {
    artifact: "deployment-r3",
    receiptEvidenceSha: "4".repeat(40),
    result: "verified",
    runUrl: null,
    sourceSha: SOURCE_SHA,
    version: "version-r3",
  });
  const cli = JSON.parse(output).components.find(
    (component) => component.scope === "cli"
  );
  assert.deepEqual(cli.evidence, {
    artifact: "6".repeat(64),
    receiptEvidenceSha: "5".repeat(40),
    result: "verified",
    runUrl: null,
    sourceSha: SOURCE_SHA,
    version: "0.3.217",
  });
});

test("keeps hosted workflow evidence separate from an unknown artifact", async () => {
  let output = "";
  const exitCode = await runProductionReleaseStatus({
    adapters: releaseStatusAdapters({
      pushChecks: [
        {
          conclusion: "success",
          event: "push",
          status: "completed",
          workflowName: "Push Guard",
        },
      ],
    }),
    argv: ["--ref", "origin/main", "--json"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0, output);
  const hosted = JSON.parse(output).components.find(
    (component) => component.source === "github"
  );
  assert.equal(hosted.evidence.artifact, null);
  assert.equal(hosted.evidence.receiptEvidenceSha, null);
  assert.equal(hosted.evidence.runUrl, hosted.url);
});

test("fails closed when a merge without push checks cannot match exact Final Candidate identity", async () => {
  let output = "";
  const adapters = releaseStatusAdapters({ pushChecks: [] });
  adapters.readCommitStatuses = async () => ({ statuses: [] });

  const exitCode = await runProductionReleaseStatus({
    adapters,
    argv: ["--ref", "origin/main", "--json"],
    write: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 1);
  assert.match(
    JSON.parse(output).blockers[0].detail,
    MISSING_EXACT_FINAL_CANDIDATE_PATTERN
  );
  assert.deepEqual(
    JSON.parse(output).sourceValidationBlockers,
    JSON.parse(output).blockers.filter(
      (blocker) => blocker.name === "Source validation"
    )
  );
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
  const headSha = "1".repeat(40);
  const baseSha = "2".repeat(40);
  const treeSha = "3".repeat(40);
  const adapters = {
    hasWebsitePackage: () => false,
    hasDocsPackage: () => false,
    buildImpact: (input) => adapters.buildPlan(input),
    buildPlan: () => ({
      scopes: ["db", "web", "gateway", "auth", "cli", "core", "remote-agent"],
    }),
    readPushChecks: async () => pushChecks,
    readAssociatedPullRequests: async () => [
      {
        base: { ref: "main", sha: baseSha },
        head: { sha: headSha },
        html_url: "https://github.com/amplifthq/openmeld/pull/1",
        merge_commit_sha: SOURCE_SHA,
        merged_at: "2026-07-15T20:00:00Z",
        number: 1,
      },
    ],
    readCommitStatuses: async () => ({
      statuses: [
        {
          context: "OpenMeld Final Candidate",
          description: `Passed standard @ ${headSha.slice(0, 12)} on ${baseSha.slice(0, 12)}`,
          state: "success",
          target_url: "https://github.com/amplifthq/openmeld/actions/runs/1",
        },
      ],
    }),
    readGitCommit: async (_repo, sha) =>
      sha === SOURCE_SHA
        ? {
            parents: [{ sha: baseSha }],
            tree: { sha: treeSha },
          }
        : { parents: [], tree: { sha: treeSha } },
    readJobReleaseSha: async (job) => job.releaseSha,
    readLocalReleaseSources: async () => new Map(),
    readReleaseJobs: async (runId) => JOBS_BY_RUN.get(runId) ?? [],
    readReleaseRuns: async () => RELEASE_RUNS,
    resolveRef: () => SOURCE_SHA,
    resolveRepo: () => "amplifthq/openmeld",
    sourceIsAncestor: () => true,
  };
  return adapters;
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

function releaseJob(
  name,
  releaseSha,
  { completedAt, conclusion = "success" } = {}
) {
  return { completed_at: completedAt, conclusion, name, releaseSha };
}
