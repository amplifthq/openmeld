import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const readRepoFile = (relativePath) =>
  readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
const GITHUB_EXPRESSION_PREFIX = ["$", "{{"].join("");
const RELEASE_SHA_CHECKOUT = `ref: ${GITHUB_EXPRESSION_PREFIX} inputs.release_sha || github.sha }}`;
const PINNED_SCOPED_RELEASE_SHA = `${GITHUB_EXPRESSION_PREFIX} inputs.release_sha }}`;
const SCOPED_RELEASE_SHA_INPUT =
  /release_sha:\n\s+description: [^\n]+\n\s+required: true\n\s+type: string/u;
const MAINLINE_RELEASE_ERROR_PATTERN =
  /release_sha must identify a commit on the main first-parent chain/u;
const YAML_JOB_BOUNDARY = /\n {2}[a-z_]+:/u;
const SHELL_GITHUB_SHA = ["$", "{GITHUB_SHA}"].join("");
const UNPINNED_ULTRACITE_COMMAND = /ultracite (?:check|fix)/u;
const PNPM_BINARY = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const COMPONENT_WORKFLOWS = [
  ["auth", ".github/workflows/deploy-auth-worker.yml", "/health"],
  ["core", ".github/workflows/deploy-core-worker.yml", "deployments list"],
  ["gateway", ".github/workflows/deploy-gateway-worker.yml", "/health"],
  [
    "remote-agent",
    ".github/workflows/deploy-remote-agent-worker.yml",
    "deployments list",
  ],
  ["web", ".github/workflows/deploy-web.yml", "/guide.md"],
];

const createIsolatedGitEnvironment = () => {
  const environment = { ...process.env };
  const repositoryLocalVariables = execFileSync(
    "git",
    ["rev-parse", "--local-env-vars"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }
  )
    .trim()
    .split("\n");
  for (const variableName of repositoryLocalVariables) {
    delete environment[variableName];
  }
  return environment;
};

const PACKAGE_MANIFEST_PATTERNS = [
  "package.json",
  "clients/*/package.json",
  "packages/*/package.json",
  "runtime/*/package.json",
  "runtime/*/*/package.json",
  "services/*/package.json",
];

test("keeps the manual production dispatcher scoped by default", () => {
  const source = readRepoFile(".github/workflows/release-on-main.yml");

  assert.ok(source.includes("default: web"));
  for (const scope of [
    "database",
    "database-auth",
    "database-core",
    "web",
    "gateway",
    "auth",
    "core",
    "remote-agent",
    "cloud",
    "full",
  ]) {
    assert.ok(source.includes(`          - ${scope}`));
  }
  assert.ok(!source.includes("Deploy Auth Worker when target is selected"));
  assert.ok(!source.includes("Deploy Core Worker when target is selected"));
  assert.ok(!source.includes("release_ready:"));
  assert.ok(!source.includes("  select:"));
  assert.ok(!source.includes("  guard:"));
  assert.ok(!source.includes("  summary:"));
  assert.ok(source.includes("  preview:"));
  assert.ok(source.includes("  reject_non_main:"));
  assert.ok(
    source.includes(
      "inputs.mode == 'deploy' && github.ref != 'refs/heads/main'"
    )
  );
  assert.ok(
    (source.match(/github\.ref == 'refs\/heads\/main'/gu)?.length ?? 0) >= 6
  );
  assert.ok(source.includes(`if [ "\${GITHUB_REF}" != "refs/heads/main" ]`));
});

test("pins a scoped production release to one explicit main commit", () => {
  const source = readRepoFile(".github/workflows/release-on-main.yml");
  const validationScript = readRepoFile(
    "scripts/release/require-mainline-release-sha.mjs"
  );

  assert.match(source, SCOPED_RELEASE_SHA_INPUT);
  assert.ok(source.includes("  validate_release_source:"));
  assert.ok(
    validationScript.includes(
      "release_sha must be an exact 40-character lowercase commit SHA"
    )
  );
  assert.ok(
    source.includes("node scripts/release/require-mainline-release-sha.mjs \\")
  );
  assert.ok(
    validationScript.includes(
      "release_sha must identify a commit on the main first-parent chain"
    )
  );
  assert.ok(validationScript.includes('"--first-parent"'));
  assert.ok(!source.includes("git merge-base --is-ancestor"));
  assert.ok(source.includes(`ref: ${PINNED_SCOPED_RELEASE_SHA}`));
  assert.equal(
    source.split(`release_sha: ${PINNED_SCOPED_RELEASE_SHA}`).length - 1,
    COMPONENT_WORKFLOWS.length
  );
  assert.ok(
    !source.includes(`release_sha: ${GITHUB_EXPRESSION_PREFIX} github.sha }}`)
  );
  assert.ok(!source.includes(`- Commit: \`${SHELL_GITHUB_SHA}\``));
  const previewJob = source.split("\n  preview:")[1]?.split("\n  database:")[0];
  assert.ok(previewJob?.includes(PINNED_SCOPED_RELEASE_SHA));

  for (const jobName of [
    "preview",
    "database",
    "auth",
    "web",
    "gateway",
    "core",
    "remote_agent",
  ]) {
    const job = source.split(`\n  ${jobName}:`)[1]?.split(YAML_JOB_BOUNDARY)[0];
    assert.ok(
      job?.includes("validate_release_source"),
      `${jobName} must wait for source validation`
    );
  }
});

test("accepts only commits on the main first-parent chain as release sources", () => {
  const repositoryPath = mkdtempSync(
    path.join(tmpdir(), "openmeld-mainline-release-")
  );
  const validationScript = path.join(
    REPO_ROOT,
    "scripts/release/require-mainline-release-sha.mjs"
  );
  const isolatedGitEnvironment = createIsolatedGitEnvironment();
  const runGit = (...args) =>
    execFileSync("git", args, {
      cwd: repositoryPath,
      encoding: "utf8",
      env: isolatedGitEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const writeCommit = (fileName, contents, message) => {
    writeFileSync(path.join(repositoryPath, fileName), contents);
    runGit("add", fileName);
    runGit("commit", "-m", message);
    return runGit("rev-parse", "HEAD");
  };
  const validate = (releaseSha) =>
    spawnSync(process.execPath, [validationScript, releaseSha, "main"], {
      cwd: repositoryPath,
      encoding: "utf8",
      env: isolatedGitEnvironment,
    });

  try {
    runGit("init", "--initial-branch=main");
    runGit("config", "user.email", "release-test@openmeld.test");
    runGit("config", "user.name", "OpenMeld Release Test");
    writeCommit("base.txt", "base\n", "base");

    runGit("checkout", "-b", "feature");
    const featureHead = writeCommit("feature.txt", "feature\n", "feature");

    runGit("checkout", "main");
    const priorMainHead = writeCommit("main.txt", "main\n", "main update");
    runGit("merge", "--no-ff", "feature", "-m", "merge feature");
    const mergeCommit = runGit("rev-parse", "HEAD");

    assert.doesNotThrow(() =>
      runGit("merge-base", "--is-ancestor", featureHead, "main")
    );
    assert.equal(validate(priorMainHead).status, 0);
    assert.equal(validate(mergeCommit).status, 0);

    const sideBranchValidation = validate(featureHead);
    assert.equal(sideBranchValidation.status, 1);
    assert.match(sideBranchValidation.stderr, MAINLINE_RELEASE_ERROR_PATTERN);
  } finally {
    rmSync(repositoryPath, { force: true, recursive: true });
  }
});

test("routes the root cloud deploy alias through the guarded Auth-first planner", () => {
  const rootPackage = JSON.parse(readRepoFile("package.json"));
  const scripts = rootPackage.scripts ?? {};

  assert.equal(
    scripts["deploy:cloud"],
    "pnpm run release:deploy:local -- --scope cloud"
  );
  assert.deepEqual(
    Object.keys(scripts).filter((name) => name.startsWith("deploy:cloud:")),
    []
  );
});

test("deploys the Auth receiver before Web in coordinated GitHub releases", () => {
  const source = readRepoFile(".github/workflows/release-on-main.yml");
  const auditGuidance = readRepoFile(
    "developing/engineering/development-workflow.md"
  );
  const webJob = source.slice(
    source.indexOf("\n  web:"),
    source.indexOf("\n  gateway:")
  );
  const authJob = source.slice(
    source.indexOf("\n  auth:"),
    source.indexOf("\n  core:")
  );

  assert.ok(webJob.includes("needs:\n      - database\n      - auth"));
  assert.ok(
    webJob.includes(
      "(needs.auth.result == 'success' || needs.auth.result == 'skipped')"
    )
  );
  assert.ok(authJob.includes("needs:\n      - database"));
  assert.ok(!authJob.includes("needs.web.result"));
  assert.ok(!authJob.includes("needs.gateway.result"));
  assert.ok(
    auditGuidance.includes(
      "The default coordinated cloud deploy order is Auth, then Web, then Gateway, then Core, then Remote Agent."
    )
  );
});

test("keeps one fast PR gate and makes exhaustive confidence manual", () => {
  const prChecks = readRepoFile(".github/workflows/pr-checks.yml");
  const deepConfidence = readRepoFile(".github/workflows/deep-confidence.yml");
  const rootPackage = JSON.parse(readRepoFile("package.json"));
  const ciContractGuard = readRepoFile(
    ".github/workflows/ci-contract-guard.yml"
  );
  const localComponents = readRepoFile(
    ".github/workflows/local-components-manifest.yml"
  );
  const planSetup = readRepoFile(
    ".github/actions/setup-fast-pr-plan/action.yml"
  );
  const planJob = prChecks.split("\n  plan:")[1]?.split("\n  static:")[0];

  assert.equal(prChecks.match(/^ {4}name: Fast PR$/gmu)?.length, 1);
  assert.ok(prChecks.includes("  plan:"));
  assert.ok(prChecks.includes("    name: Fast PR / Plan"));
  assert.ok(prChecks.includes("  static:"));
  assert.ok(prChecks.includes("    name: Fast PR / Static"));
  assert.ok(prChecks.includes("  check:"));
  assert.ok(prChecks.includes("    name: Fast PR / Checks"));
  assert.ok(prChecks.includes("  unit-test-shards:"));
  assert.equal(prChecks.match(/^ {4}needs: plan$/gmu)?.length, 2);
  assert.ok(
    prChecks.includes(
      `    name: Fast PR / Unit Tests / ${GITHUB_EXPRESSION_PREFIX} matrix.name }}`
    )
  );
  assert.ok(prChecks.includes("  remaining-unit-tests:"));
  assert.ok(prChecks.includes("    name: Fast PR / Unit Tests / Remaining"));
  assert.ok(prChecks.includes("  gate:"));
  assert.ok(
    prChecks.includes(
      "    needs: [plan, static, check, unit-test-shards, remaining-unit-tests]"
    )
  );
  assert.ok(
    prChecks.includes(
      "if: always() && github.event.pull_request.draft == false"
    )
  );
  assert.ok(prChecks.includes("ready_for_review"));
  assert.ok(prChecks.includes("converted_to_draft"));
  assert.equal(prChecks.match(/timeout-minutes: 20/gmu)?.length, 4);
  assert.ok(!prChecks.includes("timeout-minutes: 45"));
  assert.ok(
    prChecks.includes(`--shard=${GITHUB_EXPRESSION_PREFIX} matrix.shard }}`)
  );
  assert.ok(prChecks.includes("--exclude-package=openmeld-web"));
  assert.ok(prChecks.includes("--exclude-package=openmeld"));
  assert.ok(prChecks.includes("--exclude-package=@openmeld/core"));
  assert.equal(
    prChecks.match(/uses: \.\/\.github\/actions\/cache-fast-pr-turbo/gmu)
      ?.length,
    3
  );
  assert.ok(prChecks.includes("cache-suffix: checks"));
  assert.ok(
    prChecks.includes(
      `cache-suffix: unit-${GITHUB_EXPRESSION_PREFIX} matrix.cacheKey }}`
    )
  );
  assert.ok(prChecks.includes("cache-suffix: remaining-unit-tests"));
  assert.ok(prChecks.includes("--output-logs=errors-only"));
  assert.ok(prChecks.includes("--reporter=dot"));
  assert.ok(prChecks.includes("--silent=passed-only"));
  assert.ok(prChecks.includes("pnpm run verify:release-workflows"));
  assert.ok(
    rootPackage.scripts["verify:release-workflows"].includes(
      "scripts/release/verify-release-ready.test.mjs"
    )
  );
  assert.ok(
    prChecks.includes(
      `pnpm run verify:release-ready -- --defer-release --base ${GITHUB_EXPRESSION_PREFIX} github.event.pull_request.base.sha }}`
    )
  );
  assert.ok(prChecks.includes("Resolve release verification mode"));
  assert.ok(
    prChecks.includes(
      'node scripts/release/release-branch-policy.mjs "$PR_HEAD_REF" "$PR_BASE_SHA"'
    )
  );
  assert.ok(
    prChecks.includes("if: steps.release-mode.outputs.mode == 'strict'")
  );
  assert.ok(
    prChecks.includes("if: steps.release-mode.outputs.mode == 'deferred'")
  );
  assert.ok(
    prChecks.includes(
      "node scripts/dev/turbo-affected.mjs --changed-only check -- --concurrency=2"
    )
  );
  assert.ok(prChecks.includes("node scripts/ci/fast-pr-test-plan.mjs"));
  assert.ok(planJob);
  assert.ok(planJob.includes("uses: ./.github/actions/setup-fast-pr-plan"));
  assert.ok(!planJob.includes("uses: ./.github/actions/setup-node-pnpm"));
  assert.ok(planJob.includes("OPENMELD_TURBO_DLX_PACKAGE: turbo@2.9.6"));
  assert.ok(planSetup.includes("pnpm/action-setup@v6"));
  assert.ok(planSetup.includes('node-version: "24"'));
  assert.ok(planSetup.includes("package-manager-cache: false"));
  assert.ok(!planSetup.includes("cache: pnpm"));
  assert.ok(!planSetup.includes("pnpm install"));
  assert.ok(!prChecks.includes("pnpm run verify:pr"));
  assert.equal(
    rootPackage.scripts["verify:pr"],
    "node scripts/dev/turbo-affected.mjs --changed-only check test -- --concurrency=2"
  );
  assert.equal(
    rootPackage.scripts["verify:pr:full"],
    "node scripts/dev/turbo-affected.mjs check test test:integration -- --concurrency=2"
  );
  assert.ok(!deepConfidence.includes("schedule:"));
  assert.ok(deepConfidence.includes("workflow_dispatch:"));
  assert.ok(ciContractGuard.includes("name: CI Contract Guard"));
  assert.ok(ciContractGuard.includes('      - ".github/workflows/**"'));
  assert.ok(
    ciContractGuard.includes('      - "scripts/dev/turbo-affected.mjs"')
  );
  assert.ok(ciContractGuard.includes('      - "scripts/release/**"'));
  assert.ok(ciContractGuard.includes("pnpm run verify:release-workflows"));
  assert.ok(!ciContractGuard.includes("pnpm run verify:pr"));
  assert.ok(!ciContractGuard.includes("pnpm run verify:release-ready"));
  assert.ok(
    !existsSync(path.join(REPO_ROOT, ".github/workflows/main-confidence.yml"))
  );
  assert.ok(
    !existsSync(
      path.join(REPO_ROOT, ".github/workflows/core-test-layout-guard.yml")
    )
  );
  assert.ok(localComponents.includes("    paths:"));
  assert.ok(
    localComponents.includes(
      '- ".github/workflows/local-components-manifest.yml"'
    )
  );
  assert.ok(localComponents.includes('- "release/local-components.json"'));
  assert.ok(localComponents.includes('- "runtime/local-service/src/**"'));
  assert.ok(
    localComponents.includes('- "scripts/ci/select-release-ready-paths.mjs"')
  );
  assert.ok(
    localComponents.includes('- "scripts/release/release-ready-paths.mjs"')
  );
  assert.ok(localComponents.includes("run: pnpm run verify:release-ready"));
  assert.ok(!localComponents.includes("--defer-release"));
});

test("uses the pull request's exact base commit for every affected Fast PR gate", () => {
  const prChecks = readRepoFile(".github/workflows/pr-checks.yml");
  const exactBase = `${GITHUB_EXPRESSION_PREFIX} github.event.pull_request.base.sha }}`;

  assert.equal(prChecks.match(/fetch-depth: 0/gu)?.length, 4);
  assert.equal(
    prChecks.split(`OPENMELD_AFFECTED_BASE: ${exactBase}`).length - 1,
    3
  );
  assert.ok(prChecks.includes(`--base ${exactBase}`));
  assert.ok(!prChecks.includes("git fetch origin main --depth=1"));
  assert.ok(!prChecks.includes("OPENMELD_AFFECTED_BASE: origin/main"));
});

test("runs the production database exactly once through its shared entrypoint", () => {
  const dispatcher = readRepoFile(".github/workflows/release-on-main.yml");
  const databaseAction = readRepoFile(
    ".github/actions/shared-db-gate/action.yml"
  );

  assert.ok(dispatcher.includes("uses: ./.github/actions/shared-db-gate"));
  assert.equal(databaseAction.match(/pnpm run db:release:prod/gu)?.length, 1);
  assert.ok(!databaseAction.includes("pnpm db:check"));
  assert.ok(!databaseAction.includes("pnpm db:migrate:prod"));
  assert.ok(!databaseAction.includes("pnpm db:optimize:prod"));
  assert.ok(
    dispatcher.includes(
      "CLOUDFLARE_D1_DATABASE_ID: 15f16284-5240-4675-b626-3b7144e1d684"
    )
  );
  assert.ok(!dispatcher.includes("7b6714b5-55fe-445d-876d-fc9428145206"));
});

test("maps the GitHub OAuth secret around GitHub's reserved secret prefix", () => {
  const workflow = readRepoFile(
    ".github/workflows/sync-auth-worker-secrets.yml"
  );

  assert.ok(
    workflow.includes(
      `GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET: ${GITHUB_EXPRESSION_PREFIX} secrets.OPENMELD_GITHUB_AUTH_OAUTH_CLIENT_SECRET }}`
    )
  );
  assert.ok(
    !workflow.includes("secrets.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET")
  );
});

test("uses one cached repository setup in current release jobs", () => {
  const setupAction = readRepoFile(
    ".github/actions/setup-node-pnpm/action.yml"
  );

  assert.ok(setupAction.includes("pnpm/action-setup@v6"));
  assert.ok(setupAction.includes("cache: pnpm"));
  assert.ok(setupAction.includes("pnpm install --frozen-lockfile"));
  for (const [, workflowPath] of COMPONENT_WORKFLOWS) {
    const source = readRepoFile(workflowPath);
    assert.equal(
      source.match(/uses: \.\/\.github\/actions\/setup-node-pnpm/gu)?.length,
      1,
      `${workflowPath} must use the cached setup once`
    );
  }
});

test("keeps Deep Confidence setup and sharding intentional", () => {
  const workflow = readRepoFile(".github/workflows/deep-confidence.yml");
  const corePackage = JSON.parse(readRepoFile("services/core/package.json"));
  const workersIntegrationJob = workflow
    .split("\n  workers-integration:")[1]
    ?.split("\n  cli-integration:")[0];
  const cliIntegrationJob = workflow
    .split("\n  cli-integration:")[1]
    ?.split("\n  runtime:")[0];

  assert.equal(
    workflow.match(/uses: \.\/\.github\/actions\/setup-node-pnpm/gu)?.length,
    4
  );
  assert.ok(
    workflow.includes("pnpm exec turbo run build --filter=@openmeld/core^...")
  );
  assert.ok(workflow.includes("working-directory: services/core"));
  assert.ok(
    workflow.includes(
      `pnpm exec vitest run --config vitest.config.ts --shard=${GITHUB_EXPRESSION_PREFIX} matrix.shard }}/4`
    )
  );
  assert.ok(
    !workflow.includes(
      "turbo run test:integration --filter=@openmeld/core -- --shard="
    )
  );
  assert.ok(workersIntegrationJob);
  assert.ok(workersIntegrationJob.includes("shard: [1, 2, 3, 4]"));
  assert.equal(
    corePackage.scripts["test:integration"],
    "pnpm run test:integration:shard-1 && pnpm run test:integration:shard-2 && pnpm run test:integration:shard-3 && pnpm run test:integration:shard-4"
  );
  for (const shard of [1, 2, 3, 4]) {
    assert.equal(
      corePackage.scripts[`test:integration:shard-${shard}`],
      `vitest run --config vitest.config.ts --shard=${shard}/4`
    );
  }
  assert.ok(cliIntegrationJob);
  assert.deepEqual(
    [...cliIntegrationJob.matchAll(/^ {10}- (\d+)$/gmu)].map((match) =>
      Number(match[1])
    ),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
  assert.ok(
    cliIntegrationJob.includes(
      `turbo run test:integration --filter=openmeld -- --shard=${GITHUB_EXPRESSION_PREFIX} matrix.shard }}/10`
    )
  );
  assert.ok(!cliIntegrationJob.includes("/20"));
});

test("keeps GitHub release actions on the Node 24 pnpm setup", () => {
  const githubYamlPaths = globSync(".github/**/*.{yml,yaml}", {
    cwd: REPO_ROOT,
  });

  for (const workflowPath of githubYamlPaths) {
    assert.ok(
      !readRepoFile(workflowPath).includes("pnpm/action-setup@v4"),
      `${workflowPath} must not use the retired Node 20 pnpm action`
    );
  }
});

test("does not restore a Turbo cache when deploys no longer rerun tests", () => {
  const turbo = JSON.parse(readRepoFile("turbo.json"));

  for (const [, workflowPath] of COMPONENT_WORKFLOWS) {
    const workflow = readRepoFile(workflowPath);
    assert.ok(
      !workflow.includes("uses: ./.github/actions/cache-release-turbo"),
      `${workflowPath} must not restore an unused verification cache`
    );
  }
  assert.equal(turbo.tasks["test:integration"]?.cache, false);
});

test("keeps Fast PR Turbo caches isolated to one PR job and revision", () => {
  const action = readRepoFile(".github/actions/cache-fast-pr-turbo/action.yml");
  const turbo = JSON.parse(readRepoFile("turbo.json"));

  assert.ok(action.includes("uses: actions/cache@v4"));
  assert.ok(action.includes("path: .turbo/cache"));
  assert.ok(
    action.includes(`${GITHUB_EXPRESSION_PREFIX} inputs.cache-suffix }}`)
  );
  assert.ok(action.includes(`${GITHUB_EXPRESSION_PREFIX} github.sha }}`));
  assert.ok(
    action.includes(
      `${GITHUB_EXPRESSION_PREFIX} github.event.pull_request.number }}`
    )
  );
  assert.ok(action.includes("Fast PR Turbo cache requires a pull request"));
  assert.ok(
    action.includes(
      `${GITHUB_EXPRESSION_PREFIX} hashFiles('pnpm-lock.yaml', 'turbo.json') }}`
    )
  );
  assert.ok(!action.includes("TURBO_TOKEN"));
  assert.ok(!action.includes("secrets."));
  assert.equal(turbo.futureFlags?.errorsOnlyShowHash, true);
});

test("runs Web unit tests from source while preserving required dependency builds", () => {
  const prChecks = readRepoFile(".github/workflows/pr-checks.yml");
  const webVitest = readRepoFile("clients/web/vitest.config.ts");
  const webTurbo = JSON.parse(readRepoFile("clients/web/turbo.json"));
  const turbo = JSON.parse(readRepoFile("turbo.json"));

  assert.ok(
    prChecks.includes(
      `turbo run build --filter=${GITHUB_EXPRESSION_PREFIX} matrix.package }}^...`
    )
  );
  assert.equal(
    prChecks.match(/^ {8}if: matrix\.requiresDependencyBuild$/gmu)?.length,
    2
  );
  assert.ok(webVitest.includes('"@openmeld/db/auth"'));
  assert.ok(webVitest.includes('"@openmeld/projects"'));
  assert.deepEqual(webTurbo.tasks.test.dependsOn, ["transit"]);
  assert.deepEqual(turbo.tasks.transit.dependsOn, ["^transit"]);
});

test("builds the Schemas public surface before checking its self imports", () => {
  const schemasTurbo = JSON.parse(readRepoFile("packages/schemas/turbo.json"));

  for (const task of ["check", "test"]) {
    assert.deepEqual(schemasTurbo.tasks[task].dependsOn, ["build", "^build"]);
  }
});

test("keeps formatter execution pinned to the installed Biome version", () => {
  const manifestPaths = globSync(PACKAGE_MANIFEST_PATTERNS, {
    cwd: REPO_ROOT,
  });

  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(readRepoFile(manifestPath));
    const executableConfiguration = JSON.stringify({
      lintStaged: manifest["lint-staged"],
      scripts: manifest.scripts,
    });

    assert.doesNotMatch(
      executableConfiguration,
      UNPINNED_ULTRACITE_COMMAND,
      `${manifestPath} must not let Ultracite download an unpinned formatter`
    );
  }
});

test("pins every component deploy to one SHA, runs preflight, and checks health", () => {
  for (const [scope, workflowPath, healthEvidence] of COMPONENT_WORKFLOWS) {
    const source = readRepoFile(workflowPath);
    assert.ok(source.includes("release_sha:"), `${workflowPath} needs a SHA`);
    assert.ok(
      source.includes(RELEASE_SHA_CHECKOUT),
      `${workflowPath} must checkout the release SHA`
    );
    assert.ok(
      source.includes(
        `pnpm run release:preflight:local -- --scope ${scope} --base HEAD`
      ),
      `${workflowPath} must run scoped deployment preflight`
    );
    assert.ok(!source.includes("pnpm run release:verify:local"));
    assert.ok(
      source.includes(healthEvidence),
      `${workflowPath} must verify post-deploy health`
    );
    assert.ok(!source.includes("shared-db-gate"));
    assert.ok(!source.includes("run_db_gate"));
  }
});

test("shows the exact release SHA in recoverable workflow run titles", () => {
  const scopedRelease = readRepoFile(".github/workflows/release-on-main.yml");
  assert.ok(
    scopedRelease.includes("run-name:") &&
      scopedRelease.includes("inputs.release_sha")
  );

  for (const [, workflowPath] of COMPONENT_WORKFLOWS) {
    const source = readRepoFile(workflowPath);
    assert.ok(
      source.includes("run-name:") &&
        source.includes("inputs.release_sha || github.sha"),
      `${workflowPath} must expose its exact release SHA`
    );
  }

  const cliRelease = readRepoFile(".github/workflows/cli-release.yml");
  assert.ok(cliRelease.includes("run-name:"));
  assert.ok(cliRelease.includes("inputs.release_sha || github.sha"));
});

test("orders Gateway checks after the Auth contract build they import", () => {
  const gatewayTurbo = JSON.parse(readRepoFile("services/gateway/turbo.json"));

  for (const task of ["check", "typecheck", "test", "cf-typegen"]) {
    assert.deepEqual(gatewayTurbo.tasks[task]?.dependsOn, [
      "^build",
      "@openmeld/auth#build",
    ]);
  }
});

test("builds the Core contract before checking Auth Worker bindings", () => {
  const taskGraph = JSON.parse(
    execFileSync(
      PNPM_BINARY,
      [
        "exec",
        "turbo",
        "run",
        "check",
        "--filter=@openmeld/auth-worker",
        "--dry=json",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }
    )
  );
  const tasksById = new Map(taskGraph.tasks.map((task) => [task.taskId, task]));

  assert.ok(
    tasksById.has("@openmeld/core#build"),
    "Auth Worker checks must include the Core build whose entrypoint type they import"
  );
  assert.ok(
    tasksById
      .get("@openmeld/auth-worker#check")
      ?.dependencies.includes("@openmeld/core#build")
  );
});
