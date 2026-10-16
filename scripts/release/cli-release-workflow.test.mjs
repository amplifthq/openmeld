import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { requireProductionDatabaseCurrent } from "./require-production-db-current.mjs";
import {
  assertTrustedWindowsProcessArtifactRun,
  selectReusableWindowsArtifact,
} from "./reuse-windows-process-artifact.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const readRepoFile = (relativePath) =>
  readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

const APPLE_SECRET_NAMES = [
  "APPLE_DEVELOPER_ID_P12_BASE64",
  "APPLE_DEVELOPER_ID_P12_PASSWORD",
  "APPLE_NOTARY_KEY_P8_BASE64",
  "APPLE_NOTARY_KEY_ID",
  "APPLE_NOTARY_ISSUER_ID",
  "APPLE_TEAM_ID",
];
const GITHUB_EXPRESSION_PREFIX = ["$", "{{"].join("");
const GITHUB_TOKEN_EXPRESSION = `${GITHUB_EXPRESSION_PREFIX} github.token }}`;
const RELEASE_TAG_PUSH = ['git push origin "refs/tags/v$', '{version}"'].join(
  ""
);
const PENDING_DATABASE_ERROR_PATTERN =
  /Production database is behind the release source.*scope `database`.*0149_rapid_venus\.sql/su;
const DATABASE_PROBE_FAILED_ERROR_PATTERN =
  /could not prove that the Production database is current.*authentication failed/su;
const DATABASE_PROBE_INCONCLUSIVE_ERROR_PATTERN =
  /could not prove that the Production database is current/su;
const NATIVE_DATABASE_PROBE_ERROR = /PostgreSQL (journal|probe)/u;
const REQUIRED_PRODUCTION_TRAIN_INPUT =
  /production_train_scopes:\n\s+description: [^\n]+\n\s+required: true\n\s+type: string/u;

test("keeps the trusted GitHub release publication-only and focused on CLI and Core", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");

  assert.ok(!source.includes("      mode:"));
  assert.ok(!source.includes("  verify:"));
  // Build admission belongs to the producer, not a second publisher pack.
  assert.ok(
    !source.split("  cli_release:")[1].includes("pnpm run verify:release-ready")
  );
  assert.ok(
    source
      .split("  npm_consumer:")[0]
      .includes("pnpm run verify:release-ready -- --force")
  );
  assert.ok(!source.includes("      rollout:"));
  assert.ok(!source.includes("      bootstrap_routines:"));
  assert.ok(!source.includes("  database:"));
  assert.ok(!source.includes("  auth:"));
  assert.ok(!source.includes("  remote_agent:"));
  assert.ok(!source.includes("  gateway:"));
  assert.ok(!source.includes("  web:"));
  assert.ok(!source.includes("  summary:"));
  assert.ok(!source.includes("  release_ready:"));
  assert.ok(source.includes("  reject_non_main:"));
  assert.ok(source.includes("  cli_release:"));
  assert.ok(source.includes("github.ref == 'refs/heads/main'"));
  assert.ok(source.includes("group: cli-production-release"));
  assert.equal(source.match(/cancel-in-progress: false/gu)?.length, 2);
});

test("passes the explicit production train into hosted CLI admission", () => {
  const workflow = readRepoFile(".github/workflows/cli-release.yml");
  const hostedRelease = readRepoFile("scripts/release/hosted-cli-release.mjs");
  const cliRelease = readRepoFile("scripts/release/release-cli.mjs");
  const trainInput = workflow
    .split("      production_train_scopes:")[1]
    ?.split("\n\nconcurrency:")[0];

  assert.match(workflow, REQUIRED_PRODUCTION_TRAIN_INPUT);
  assert.ok(!trainInput?.includes("default:"));
  assert.ok(
    workflow.includes(
      `OPENMELD_PRODUCTION_TRAIN_SCOPES: ${GITHUB_EXPRESSION_PREFIX} inputs.production_train_scopes }}`
    )
  );
  assert.ok(hostedRelease.includes("env: releaseEnvironment"));
  assert.ok(cliRelease.includes("admitTrainArtifacts"));
  assert.ok(cliRelease.includes('selectedScopes: "cli"'));
  for (const permission of [
    "actions: read",
    "checks: read",
    "statuses: read",
    "pull-requests: read",
  ]) {
    assert.ok(workflow.includes(permission));
  }
  assert.ok(hostedRelease.includes("GH_TOKEN: token"));
});

test("reuses only a successful helper job from the official main CLI workflow", () => {
  const repository = "amplifthq/openmeld";
  const run = {
    repository: { full_name: repository },
    path: ".github/workflows/cli-release.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: "a".repeat(40),
    conclusion: "failure", // The later macOS publication may have failed.
  };
  const jobs = [
    {
      name: "Build Windows Process Helper For CLI Package",
      conclusion: "success",
    },
  ];
  assert.equal(
    assertTrustedWindowsProcessArtifactRun({ run, jobs, repository }),
    run.head_sha
  );
  for (const untrustedRun of [
    { ...run, head_branch: "feature" },
    { ...run, path: ".github/workflows/other.yml" },
    { ...run, repository: { full_name: "other/repo" } },
  ]) {
    assert.throws(() =>
      assertTrustedWindowsProcessArtifactRun({
        run: untrustedRun,
        jobs,
        repository,
      })
    );
  }
  assert.throws(() =>
    assertTrustedWindowsProcessArtifactRun({
      run,
      jobs: [{ ...jobs[0], conclusion: "failure" }],
      repository,
    })
  );
  assert.deepEqual(
    selectReusableWindowsArtifact([
      {
        name: `windows-process-${"b".repeat(40)}`,
        expired: false,
      },
    ]),
    {
      name: `windows-process-${"b".repeat(40)}`,
      sourceSha: "b".repeat(40),
    }
  );
  assert.throws(() =>
    selectReusableWindowsArtifact([
      { name: `windows-process-${"b".repeat(40)}`, expired: true },
    ])
  );

  const workflow = readRepoFile(".github/workflows/cli-release.yml");
  assert.ok(workflow.includes("windows_artifact_run_id:"));
  const windowsJob = workflow
    .split("  windows_process_artifact:")[1]
    .split("  cli_release:")[0];
  const macJob = workflow.split("  cli_release:")[1];
  assert.ok(workflow.includes("      helper_only:"));
  assert.ok(windowsJob.includes("      inputs.helper_only\n"));
  assert.ok(!windowsJob.includes("inputs.windows_artifact_run_id == ''"));
  assert.equal(
    windowsJob.match(
      /inputs\.helper_only && github\.sha \|\| inputs\.release_sha \|\| github\.sha/gu
    )?.length,
    2
  );
  assert.ok(macJob.includes("!inputs.helper_only"));
  assert.ok(!windowsJob.includes("Reuse the stamped Windows process helper"));
  assert.ok(macJob.includes("!cancelled()"));
  assert.ok(macJob.includes("inputs.windows_artifact_run_id != ''"));
  const downloads = parse(workflow).jobs.cli_release.steps.filter((step) =>
    step.uses?.startsWith("actions/download-artifact@")
  );
  assert.deepEqual(
    downloads.map((step) => step.with.name),
    [`npm-consumer-${GITHUB_EXPRESSION_PREFIX} env.RELEASE_SHA }}`]
  );
  assert.ok(
    workflow.includes(
      "(!inputs.helper_only && inputs.windows_artifact_run_id == '')"
    )
  );
  assert.ok(macJob.includes("Reuse the stamped Windows process helper"));
  assert.ok(
    macJob.includes("node scripts/release/reuse-windows-process-artifact.mjs")
  );
});

test("keeps the signed and notarized CLI publisher fail closed", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");
  const cliStart = source.indexOf("  cli_release:");
  const cliJobSource = source.slice(cliStart);

  assert.notEqual(cliStart, -1);
  assert.ok(cliJobSource.includes("runs-on: macos-15"));
  assert.ok(
    cliJobSource.includes("id-token") || source.includes("id-token: write")
  );
  assert.ok(cliJobSource.includes("npm install --global npm@11.18.0"));
  assert.ok(
    cliJobSource.includes(
      "node ../release-control/scripts/release/hosted-cli-release.mjs ."
    )
  );
  assert.ok(
    cliJobSource.includes(
      "normal|resume-after-binary-upload|resume-after-npm-publish"
    )
  );
  assert.ok(!cliJobSource.includes("tagCliRelease"));
  assert.ok(!cliJobSource.includes("pnpm run deploy:core:local-components"));
  assert.ok(cliJobSource.includes("actions/upload-artifact@v4"));
  assert.ok(cliJobSource.includes("Verify Core deployment is visible"));
  assert.ok(cliJobSource.includes('NPM_CONFIG_PROVENANCE: "false"'));
  assert.ok(!cliJobSource.includes(RELEASE_TAG_PUSH));
  for (const secretName of APPLE_SECRET_NAMES) {
    assert.ok(
      cliJobSource.includes(
        `${secretName}: ${GITHUB_EXPRESSION_PREFIX} secrets.${secretName} }}`
      ),
      `missing ${secretName}`
    );
  }
  for (const forbidden of [
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "registry-url",
    "resume_from_cli",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `forbidden workflow token: ${forbidden}`
    );
  }
});

test("blocks CLI and Core publication while Production D1 migrations are pending", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");
  const databaseGate = source.indexOf(
    "Require production database migrations current"
  );
  const acquireCliLease = source.indexOf(
    "Acquire shared CLI publication lease"
  );
  const publish = source.indexOf(
    "Publish signed and notarized CLI, binary channel, npm package, tag, and Core"
  );

  assert.ok(databaseGate >= 0);
  assert.ok(databaseGate < acquireCliLease);
  assert.ok(databaseGate < publish);
  assert.ok(
    source.includes(
      'node ../release-control/scripts/release/require-production-db-current.mjs --release-source "$PWD" --hosted-cli'
    )
  );
});

test("allows CLI/Core publication only from unambiguous no-pending migration evidence", async () => {
  const commands = [];
  assert.deepEqual(
    await requireProductionDatabaseCurrent({
      cwd: "/release-source",
      runCommand: (command) => {
        commands.push(command);
        return {
          status: 0,
          stderr: "",
          stdout: "No migrations to apply.\n",
        };
      },
    }),
    {
      status: "current",
      reason: "the remote D1 pending migration list is empty",
    }
  );
  assert.deepEqual(commands, [
    {
      command: "pnpm",
      args: [
        "-C",
        "services/auth",
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "list",
        "OPENMELD_DB",
        "--config",
        "wrangler.jsonc",
        "--env",
        "prod",
        "--remote",
      ],
      cwd: "/release-source",
    },
  ]);
});

test("fails closed when the migration probe contradicts itself", async () => {
  await assert.rejects(
    () =>
      requireProductionDatabaseCurrent({
        cwd: "/release-source",
        runCommand: () => ({
          status: 0,
          stderr: "",
          stdout:
            "No migrations to apply.\nMigrations to be applied:\n0149_rapid_venus.sql\n",
        }),
      }),
    PENDING_DATABASE_ERROR_PATTERN
  );
});

test("native PostgreSQL publication requires its journal and runtime grant evidence without probing D1", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pg-release-source-"));
  mkdirSync(path.join(cwd, "release"));
  writeFileSync(
    path.join(cwd, "release/database-backend.json"),
    '{"backend":"postgresql"}'
  );
  // The actual isolated native journal and grant checks are exercised by
  // d1-remote.test.mjs. Here the subprocess boundary must preserve their refusal.
  const evidence = {
    target: { kind: "planetscale" },
    runtimeGrantsVerified: true,
    nativeJournal: [
      { name: "0000_native_postgresql", checksum: "a".repeat(64) },
    ],
  };
  let result = { status: 0, stdout: JSON.stringify(evidence) };
  const probe = () =>
    requireProductionDatabaseCurrent({
      cwd,
      runCommand(command) {
        assert.equal(command.command, process.execPath);
        assert.deepEqual(command.args, [
          path.resolve(SCRIPT_DIR, "../../tooling/postgresql/cutover.mjs"),
          "verify",
        ]);
        assert.equal(command.cwd, cwd);
        return result;
      },
    });
  try {
    assert.equal((await probe()).status, "current");
    for (const failure of [
      { status: 1, stderr: "Native journal checksum differs" },
      {
        status: 0,
        stdout: JSON.stringify({ ...evidence, runtimeGrantsVerified: false }),
      },
      { status: 0, stdout: JSON.stringify({ ...evidence, nativeJournal: [] }) },
      {
        status: 0,
        stdout: JSON.stringify({ ...evidence, target: { kind: "local" } }),
      },
    ]) {
      result = failure;
      await assert.rejects(probe, NATIVE_DATABASE_PROBE_ERROR);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fails closed when migration evidence contradicts across output streams", async () => {
  await assert.rejects(
    () =>
      requireProductionDatabaseCurrent({
        cwd: "/release-source",
        runCommand: () => ({
          status: 0,
          stderr: "Migrations to be applied:\n0149_rapid_venus.sql\n",
          stdout: "No migrations to apply.\n",
        }),
      }),
    PENDING_DATABASE_ERROR_PATTERN
  );
});

test("blocks CLI/Core publication when Production D1 is behind", async () => {
  await assert.rejects(
    () =>
      requireProductionDatabaseCurrent({
        cwd: "/release-source",
        runCommand: () => ({
          status: 0,
          stderr: "",
          stdout: "Migrations to be applied:\n0149_rapid_venus.sql\n",
        }),
      }),
    PENDING_DATABASE_ERROR_PATTERN
  );
});

test("fails closed when the migration probe itself fails", async () => {
  await assert.rejects(
    () =>
      requireProductionDatabaseCurrent({
        cwd: "/release-source",
        runCommand: () => ({
          status: 1,
          stderr: "authentication failed",
          stdout: "",
        }),
      }),
    DATABASE_PROBE_FAILED_ERROR_PATTERN
  );
});

test("fails closed when a successful migration probe has no decisive evidence", async () => {
  for (const stdout of [
    "",
    "Wrangler completed without a migration summary.\n",
  ]) {
    await assert.rejects(
      () =>
        requireProductionDatabaseCurrent({
          cwd: "/release-source",
          runCommand: () => ({ status: 0, stderr: "", stdout }),
        }),
      DATABASE_PROBE_INCONCLUSIVE_ERROR_PATTERN
    );
  }
});

test("injects production credentials only into the steps that consume them", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");
  const cliStart = source.indexOf("  cli_release:");
  const stepsStart = source.indexOf("    steps:", cliStart);
  const publishStart = source.indexOf(
    "      - name: Publish signed and notarized CLI",
    stepsStart
  );
  const preserveStart = source.indexOf(
    "      - name: Preserve a failed Core startup profile",
    publishStart
  );
  const publishStep = source.slice(publishStart, preserveStart);

  assert.notEqual(cliStart, -1);
  assert.notEqual(stepsStart, -1);
  assert.notEqual(publishStart, -1);
  assert.notEqual(preserveStart, -1);
  assert.ok(!source.slice(cliStart, stepsStart).includes("secrets."));
  for (const secretName of APPLE_SECRET_NAMES) {
    assert.ok(publishStep.includes(`secrets.${secretName}`));
  }
  assert.ok(publishStep.includes("secrets.CLOUDFLARE_ACCOUNT_ID"));
  assert.ok(publishStep.includes("secrets.CLOUDFLARE_API_TOKEN"));
});

test("keeps private-repository tag auth inside trusted control and away from release commands", () => {
  const workflow = readRepoFile(".github/workflows/cli-release.yml");
  const hostedRelease = readRepoFile("scripts/release/hosted-cli-release.mjs");
  const releaseEngine = readRepoFile("scripts/release/release-cli.mjs");

  assert.ok(
    workflow.includes(
      `OPENMELD_TRUSTED_GIT_GITHUB_TOKEN: ${GITHUB_TOKEN_EXPRESSION}`
    )
  );
  assert.ok(hostedRelease.includes("createTrustedGitEnvironment"));
  assert.ok(hostedRelease.includes("localGitEnvironment"));
  assert.ok(hostedRelease.includes("authenticatedGitEnvironment"));
  assert.ok(
    hostedRelease.includes(
      'Reflect.deleteProperty(process.env, "OPENMELD_TRUSTED_GIT_GITHUB_TOKEN")'
    )
  );
  assert.ok(hostedRelease.includes("env: releaseEnvironment"));
  assert.ok(releaseEngine.includes('"push",\n        "--no-verify"'));
});

test("shares CLI and Core production leases with the local release lane", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");

  assert.ok(source.includes("Acquire shared CLI publication lease"));
  assert.ok(source.includes("Acquire shared Core projection lease"));
  assert.ok(source.includes("Release shared Core projection lease"));
  assert.ok(source.includes("Release shared CLI publication lease"));
  assert.ok(source.includes("scope: cli"));
  assert.ok(source.includes("scope: core"));
  assert.equal(
    source.match(
      /uses: \.\/release-control\/\.github\/actions\/production-scope-lease/gu
    )?.length,
    4
  );
  for (const leaseStep of source
    .split("uses: ./release-control/.github/actions/production-scope-lease")
    .slice(1)) {
    assert.ok(
      leaseStep
        .split("\n\n")[0]
        ?.includes(`github_token: ${GITHUB_TOKEN_EXPRESSION}`)
    );
  }
  assert.equal(
    source.match(/working_directory: release-source/gu)?.length >= 4,
    true
  );
});

test("uses the exact release SHA for CLI publication and recovery", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");
  assert.ok(
    source.includes(
      `RELEASE_SHA: ${GITHUB_EXPRESSION_PREFIX} inputs.release_sha || github.sha }}`
    )
  );
  assert.ok(
    source.includes(`ref: ${GITHUB_EXPRESSION_PREFIX} env.RELEASE_SHA }}`)
  );
  assert.ok(source.includes("path: release-control"));
  assert.ok(source.includes("path: release-source"));
  assert.ok(
    source.indexOf("path: release-control") <
      source.indexOf("path: release-source")
  );
  assert.ok(source.includes("working-directory: release-source"));
  assert.equal(
    source.match(/persist-credentials: false/gu)?.length,
    source.match(/uses: actions\/checkout@v5/gu)?.length
  );
  assert.ok(
    source.includes("node scripts/release/build-windows-process-helper.mjs")
  );
  assert.ok(
    source.includes("node scripts/release/reuse-windows-process-artifact.mjs")
  );
  assert.ok(
    source.indexOf("Reuse the stamped Windows process helper") <
      source.indexOf(
        "Publish signed and notarized CLI, binary channel, npm package, tag, and Core"
      )
  );
});

test("validates current main first-parent membership before publication", () => {
  const source = readRepoFile(".github/workflows/cli-release.yml");

  const releaseStart = source.indexOf("  cli_release:");
  const releaseSource = source.slice(releaseStart);
  const mainlineValidation = releaseSource.indexOf(
    "node scripts/release/require-mainline-release-sha.mjs"
  );
  const publish = releaseSource.indexOf(
    "Publish signed and notarized CLI, binary channel, npm package, tag, and Core"
  );
  assert.ok(
    releaseSource.includes(`if [ "\${GITHUB_REF}" != "refs/heads/main" ]`)
  );
  assert.ok(
    releaseSource.includes(
      "release_sha must be an exact 40-character lowercase commit SHA"
    )
  );
  assert.ok(releaseSource.includes("operation: fetch-main"));
  assert.ok(
    releaseSource.includes(
      "uses: ./release-control/.github/actions/trusted-git-network"
    )
  );
  assert.ok(mainlineValidation >= 0);
  assert.ok(publish > mainlineValidation);
});

test("keeps the Remote Agent release check on the repository-pinned formatter", () => {
  const remoteAgentPackage = JSON.parse(
    readRepoFile("services/remote-agent/package.json")
  );

  assert.equal(
    remoteAgentPackage.scripts.check,
    "biome check . && pnpm run typecheck"
  );
});

test("builds Web workspace dependencies before a production Vite build", () => {
  const packageJson = JSON.parse(readRepoFile("clients/web/package.json"));

  assert.equal(
    packageJson.scripts["build:prod"],
    "pnpm -C ../.. exec turbo run build --filter=openmeld-web^... && CLOUDFLARE_ENV=prod node ./scripts/build-production.mjs"
  );
});

test("builds Worker workspace dependencies before every production deploy", () => {
  const workers = [
    ["services/auth/package.json", "@openmeld/auth-worker"],
    ["services/core/package.json", "@openmeld/core"],
    ["services/gateway/package.json", "@openmeld/gateway"],
    ["services/remote-agent/package.json", "@openmeld/remote-agent"],
  ];

  for (const [packagePath, packageName] of workers) {
    const packageJson = JSON.parse(readRepoFile(packagePath));
    const expectedBuild = `pnpm -C ../.. exec turbo run build --filter=${packageName}^...`;

    assert.equal(
      packageJson.scripts["build:workspace-dependencies"],
      expectedBuild,
      `${packageName} must own its production dependency build`
    );
    assert.ok(
      packageJson.scripts.deploy.startsWith(
        "pnpm run build:workspace-dependencies && "
      ),
      `${packageName} must build workspace dependencies before deployment`
    );
  }
});
