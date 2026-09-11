import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  globSync,
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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const readRepoFile = (relativePath) =>
  readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
const GITHUB_EXPRESSION_PREFIX = ["$", "{{"].join("");
const GITHUB_TOKEN_INPUT = `github_token: ${GITHUB_EXPRESSION_PREFIX} github.token }}`;
const RELEASE_SHA_CHECKOUT = `ref: ${GITHUB_EXPRESSION_PREFIX} inputs.release_sha }}`;
const PINNED_SCOPED_RELEASE_SHA = `${GITHUB_EXPRESSION_PREFIX} inputs.release_sha }}`;
const SCOPED_RELEASE_SHA_INPUT =
  /release_sha:\n\s+description: [^\n]+\n\s+required: true\n\s+type: string/u;
const MAINLINE_RELEASE_ERROR_PATTERN =
  /release_sha must identify a commit on the main first-parent chain/u;
const YAML_JOB_BOUNDARY = /\n {2}[a-z_]+:/u;
const UNPINNED_ULTRACITE_COMMAND = /ultracite (?:check|fix)/u;
const LOCAL_CORE_STARTUP_DIAGNOSTIC =
  /- name: Capture local Core startup evidence\n\s+continue-on-error: true\n\s+run: pnpm run evidence:startup:core/u;
const PRODUCTION_CONCURRENCY_PATTERN =
  /concurrency:\n\s+group: deploy-[a-z-]+-production\n\s+queue: max\n\s+cancel-in-progress: false/u;
const PNPM_BINARY = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const PRODUCTION_LEASE_ACTION =
  "uses: ./release-control/.github/actions/production-scope-lease";
const BARE_MAIN_FETCH_PATTERN = /git fetch --no-tags origin refs\/heads\/main/u;
const BARE_TAG_FETCH_PATTERN = /run: git fetch --tags/u;
const UNTRUSTED_ACTION_GIT_PROBE_PATTERN = /git -C/u;

const readProductionLeaseSteps = (workflow) =>
  workflow
    .split(PRODUCTION_LEASE_ACTION)
    .slice(1)
    .map(
      (remainder) => `${PRODUCTION_LEASE_ACTION}${remainder.split("\n\n")[0]}`
    );

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

test("keeps the manual production dispatcher deploy-only and scoped by default", () => {
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
  assert.ok(!source.includes("      mode:"));
  assert.ok(!source.includes("  preview:"));
  assert.ok(!source.includes("release_ready:"));
  assert.ok(!source.includes("  select:"));
  assert.ok(!source.includes("  guard:"));
  assert.ok(!source.includes("  summary:"));
  assert.ok(source.includes("  reject_non_main:"));
  assert.ok(source.includes("if: github.ref != 'refs/heads/main'"));
  assert.ok(
    (source.match(/github\.ref == 'refs\/heads\/main'/gu)?.length ?? 0) >= 6
  );
  assert.ok(source.includes(`if [ "\${GITHUB_REF}" != "refs/heads/main" ]`));
});

test("admits hosted fleet order before any Production deployment can start", () => {
  const source = readRepoFile(".github/workflows/release-on-main.yml");
  const validationJob = source
    .split("  validate_release_source:")[1]
    ?.split(YAML_JOB_BOUNDARY)[0];

  assert.ok(validationJob?.includes("fetch-tags: true"));
  assert.ok(validationJob?.includes("path: release-source"));
  assert.ok(
    validationJob?.includes(
      "node ../release-control/scripts/release/hosted-fleet-plan-admission.mjs"
    )
  );
  assert.ok(validationJob?.includes('--scope "$RELEASE_SCOPE"'));
  assert.ok(
    validationJob?.includes(
      "Admit the hosted fleet deployment order before Production mutation"
    )
  );
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

  for (const jobName of [
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

test("keeps Final Candidate execution separate from status publication", () => {
  const candidate = readRepoFile(".github/workflows/final-candidate.yml");
  const deepConfidence = readRepoFile(".github/workflows/deep-confidence.yml");
  const rootPackage = JSON.parse(readRepoFile("package.json"));
  const hook = readRepoFile(".husky/pre-push");

  assert.ok(candidate.includes("name: OpenMeld Final Candidate"));
  assert.ok(!candidate.includes("workflow_dispatch"));
  assert.equal(candidate.match(/^ {4}runs-on: ubuntu-latest$/gmu)?.length, 3);
  assert.ok(candidate.includes("github.event.label.name == 'final-candidate'"));
  assert.ok(
    candidate.includes("github.event.label.name == 'final-candidate-full'")
  );
  assert.ok(
    candidate.includes(
      `ref: ${GITHUB_EXPRESSION_PREFIX} env.CANDIDATE_HEAD_SHA }}`
    )
  );
  assert.ok(candidate.includes('--head "$CANDIDATE_HEAD_SHA"'));
  assert.ok(candidate.includes('--base "$CANDIDATE_BASE_SHA"'));
  assert.ok(!candidate.includes("--publish-status"));
  assert.ok(candidate.includes("statuses: write"));
  assert.ok(candidate.includes("if: always()"));
  assert.ok(candidate.includes("actions/upload-artifact@v4"));
  assert.equal(rootPackage.scripts.candidate, undefined);
  assert.equal(rootPackage.scripts["candidate:local"], undefined);
  assert.ok(
    rootPackage.scripts["verify:release-workflows"].includes(
      "scripts/ci/final-candidate-policy.test.mjs"
    )
  );
  assert.ok(
    rootPackage.scripts["verify:release-workflows"].includes(
      "scripts/release/hosted-fleet-plan-admission.test.mjs"
    )
  );
  assert.ok(!hook.includes("verify:pre-push:checks"));
  for (const retiredPath of [
    ".github/workflows/pr-checks.yml",
    ".github/workflows/ci-contract-guard.yml",
    ".github/workflows/local-components-manifest.yml",
    ".github/actions/setup-fast-pr-plan/action.yml",
    ".github/actions/cache-fast-pr-turbo/action.yml",
    "scripts/ci/fast-pr-test-plan.mjs",
    "scripts/ci/fast-pr-test-plan.test.mjs",
  ]) {
    assert.ok(!existsSync(path.join(REPO_ROOT, retiredPath)), retiredPath);
  }
  assert.ok(!deepConfidence.includes("schedule:"));
  assert.ok(deepConfidence.includes("workflow_dispatch:"));
});

test("pins PR evidence and the final merge group to their exact identities", () => {
  const candidate = readRepoFile(".github/workflows/final-candidate.yml");
  const mergeGroup = readRepoFile(
    ".github/workflows/merge-group-final-candidate.yml"
  );
  const engine = [
    readRepoFile("scripts/ci/final-candidate.mjs"),
    readRepoFile("scripts/ci/final-candidate-publisher.mjs"),
    readRepoFile("scripts/ci/final-candidate-state.mjs"),
  ].join("\n");
  const policy = readRepoFile("scripts/ci/final-candidate-policy.mjs");
  const trustedGit = readRepoFile("scripts/ci/trusted-git-network.mjs");

  assert.ok(candidate.includes("fetch-depth: 0"));
  assert.ok(candidate.includes('--repository "$CANDIDATE_REPOSITORY"'));
  assert.ok(candidate.includes('--pr "$CANDIDATE_PR_NUMBER"'));
  assert.ok(trustedGit.includes("refs/heads/main:refs/remotes/origin/main"));
  assert.ok(trustedGit.includes("protocol.ext.allow"));
  assert.ok(trustedGit.includes("core.hooksPath"));
  assert.ok(engine.includes("assertCandidateSnapshot(state.snapshot)"));
  assert.ok(engine.includes("candidateKind: context.candidateKind"));
  assert.ok(
    engine.includes(
      'requireCurrentBase: context.candidateKind === "merge-group"'
    )
  );
  assert.ok(mergeGroup.includes("merge_group:"));
  assert.ok(mergeGroup.includes("github.event.merge_group.head_sha"));
  assert.ok(mergeGroup.includes("github.event.merge_group.base_sha"));
  assert.ok(mergeGroup.includes("--candidate-kind merge-group"));
  assert.ok(mergeGroup.includes("name: OpenMeld Final Candidate"));
  assert.ok(!mergeGroup.includes("statuses: write"));
  assert.ok(engine.includes("publishCommitStatus"));
  assert.ok(engine.includes("publishPullRequestComment"));
  assert.ok(policy.includes("Candidate head drifted"));
  assert.ok(policy.includes("Pull request base drifted"));
  assert.ok(policy.includes("Main advanced"));
  assert.ok(policy.includes("does not contain current main"));
  assert.ok(policy.includes("evidenceMatchesCandidate"));
});

test("routes every agent to one delivery contract without duplicating it", () => {
  const agents = readRepoFile("AGENTS.md");
  const developingIndex = readRepoFile("developing/README.md");
  const delivery = readRepoFile(
    "developing/engineering/agent-native-delivery.md"
  );
  const development = readRepoFile(
    "developing/engineering/development-workflow.md"
  );
  const release = readRepoFile("developing/engineering/production-release.md");

  for (const router of [agents, developingIndex, development, release]) {
    assert.ok(router.includes("agent-native-delivery.md"));
  }
  assert.ok(
    delivery.includes(
      "Source of truth: This file owns the end-to-end agent-native delivery contract"
    )
  );
  assert.ok(delivery.includes("OpenMeld Final Candidate"));
  assert.ok(delivery.includes("trusted-final-candidate.sh"));
  assert.ok(delivery.includes("cancel-in-progress: false"));
  assert.ok(delivery.includes("gh pr merge <pr-number> --merge"));
  assert.ok(delivery.includes("Do not pass `--delete-branch`"));
  assert.ok(delivery.includes("Health And Real-User Smoke"));
  assert.ok(
    development.includes("section owns only the lower-level test commands")
  );
  assert.ok(
    release.includes("used to invent a second merge or evidence contract")
  );
  assert.ok(
    release.includes("node scripts/release/prepare-release-worktree.mjs")
  );
});

test("serializes each production scope without canceling a running deploy", () => {
  const dispatcher = readRepoFile(".github/workflows/release-on-main.yml");
  const databaseJob = dispatcher
    .split("\n  database:")[1]
    ?.split("\n  web:")[0];

  assert.ok(databaseJob?.includes("group: release-production-database"));
  assert.ok(databaseJob?.includes("queue: max"));
  assert.ok(databaseJob?.includes("cancel-in-progress: false"));
  for (const [scope, workflowPath] of COMPONENT_WORKFLOWS) {
    const workflow = readRepoFile(workflowPath);
    assert.match(
      workflow,
      PRODUCTION_CONCURRENCY_PATTERN,
      `${scope} must serialize without canceling an active production release`
    );
  }
  assert.ok(!dispatcher.includes("\nconcurrency:"));
});

test("retains every queued production release instead of replacing an older pending run", () => {
  for (const workflowPath of globSync(".github/workflows/*.yml", {
    cwd: REPO_ROOT,
  })) {
    const workflow = readRepoFile(workflowPath);
    const nonCancelingGroups =
      workflow.match(/cancel-in-progress: false/gu) ?? [];
    if (nonCancelingGroups.length === 0) {
      continue;
    }
    assert.equal(
      workflow.match(/queue: max/gu)?.length,
      nonCancelingGroups.length,
      `${workflowPath} must retain every non-canceling production queue`
    );
  }
});

test("uses step-scoped private-repository authentication for every trusted release fetch", () => {
  const trustedAction = readRepoFile(
    ".github/actions/trusted-git-network/action.yml"
  );
  const validatorWorkflows = [
    ".github/workflows/release-on-main.yml",
    ".github/workflows/recover-core-cli-projection.yml",
    ...COMPONENT_WORKFLOWS.map(([, workflowPath]) => workflowPath),
  ];

  assert.ok(trustedAction.includes("OPENMELD_TRUSTED_GIT_GITHUB_TOKEN"));
  assert.ok(trustedAction.includes("trusted-git-network.mjs"));
  for (const workflowPath of validatorWorkflows) {
    const workflow = readRepoFile(workflowPath);
    assert.ok(
      workflow.includes(
        "uses: ./release-control/.github/actions/trusted-git-network"
      ),
      `${workflowPath} must use trusted private-repository fetch auth`
    );
    assert.ok(workflow.includes("operation: fetch-main"));
    assert.ok(workflow.includes("persist-credentials: false"));
    assert.doesNotMatch(workflow, BARE_MAIN_FETCH_PATTERN);
  }

  for (const workflowPath of [
    ".github/workflows/cli-release.yml",
    ".github/workflows/deploy-core-worker.yml",
  ]) {
    const workflow = readRepoFile(workflowPath);
    assert.ok(workflow.includes("operation: fetch-tags"));
    assert.doesNotMatch(workflow, BARE_TAG_FETCH_PATTERN);
  }
});

test("uses one atomic shared lease across local and hosted releases", () => {
  const leaseAction = readRepoFile(
    ".github/actions/production-scope-lease/action.yml"
  );
  const leaseEngine = readRepoFile(
    "scripts/release/production-scope-lease.mjs"
  );
  const localRelease = readRepoFile("scripts/release/production-release.mjs");
  const dispatcher = readRepoFile(".github/workflows/release-on-main.yml");

  assert.ok(
    leaseAction.includes(
      "$LEASE_CONTROL_ROOT/scripts/release/production-scope-lease.mjs"
    )
  );
  assert.ok(leaseAction.includes('" acquire \\'));
  assert.ok(leaseAction.includes('" release \\'));
  assert.ok(leaseAction.includes("OPENMELD_PRODUCTION_LEASE_GITHUB_TOKEN"));
  assert.ok(leaseAction.includes('--cwd "$LEASE_REPOSITORY_ROOT"'));
  assert.doesNotMatch(leaseAction, UNTRUSTED_ACTION_GIT_PROBE_PATTERN);
  assert.ok(leaseEngine.includes("--force-with-lease="));
  assert.ok(leaseEngine.includes("context.ref"));
  assert.ok(leaseEngine.includes("expectedLeaseSha"));
  assert.ok(localRelease.includes("executeWithProductionScopeLeases"));
  assert.ok(localRelease.includes("assertProductionReleaseSource"));
  assert.ok(dispatcher.includes("Acquire shared Database release lease"));
  assert.ok(dispatcher.includes("Release shared Database release lease"));
  assert.ok(dispatcher.includes("scope: db"));
  assert.ok(dispatcher.includes("contents: write"));
  const databaseLeaseSteps = readProductionLeaseSteps(dispatcher);
  assert.equal(databaseLeaseSteps.length, 2);
  for (const leaseStep of databaseLeaseSteps) {
    assert.ok(leaseStep.includes(GITHUB_TOKEN_INPUT));
    assert.ok(leaseStep.includes("working_directory: release-source"));
  }

  for (const [scope, workflowPath] of COMPONENT_WORKFLOWS) {
    const workflow = readRepoFile(workflowPath);
    const leaseSteps = readProductionLeaseSteps(workflow);
    assert.equal(
      leaseSteps.length,
      2,
      `${scope} must acquire and release its lease`
    );
    const separation = inspectSeparatedReleaseControl(workflow);
    assert.equal(
      separation.controlPrecedesRelease,
      true,
      `${workflowPath} must checkout trusted control before release source`
    );
    assert.equal(
      separation.pinsWorkflowSha,
      true,
      `${workflowPath} must pin control to the workflow SHA`
    );
    assert.equal(
      separation.disablesCredentials,
      true,
      `${workflowPath} must not persist checkout credentials`
    );
    assert.equal(
      separation.usesReleaseSource,
      true,
      `${workflowPath} must run product commands from the exact release source`
    );
    assert.ok(
      workflow.includes(`scope: ${scope}`),
      `${scope} must name the same local and hosted scope`
    );
    assert.ok(workflow.includes("contents: write"));
    assert.ok(workflow.includes("if: always()"));
    for (const leaseStep of leaseSteps) {
      assert.ok(
        leaseStep.includes(GITHUB_TOKEN_INPUT),
        `${scope} must expose GitHub authentication only to its lease action`
      );
      assert.ok(
        leaseStep.includes("working_directory: release-source"),
        `${scope} must run its lease mutation in the release-source repository`
      );
    }
  }
});

test("runs the production database exactly once through its shared entrypoint", () => {
  const dispatcher = readRepoFile(".github/workflows/release-on-main.yml");
  const databaseAction = readRepoFile(
    ".github/actions/shared-db-gate/action.yml"
  );

  assert.ok(
    dispatcher.includes(
      "uses: ./release-control/.github/actions/shared-db-gate"
    )
  );
  const separation = inspectSeparatedReleaseControl(dispatcher);
  assert.equal(separation.controlPrecedesRelease, true);
  assert.equal(separation.pinsWorkflowSha, true);
  assert.equal(separation.disablesCredentials, true);
  assert.equal(separation.usesReleaseSource, true);
  assert.ok(dispatcher.includes(GITHUB_TOKEN_INPUT));
  assert.ok(dispatcher.includes("working_directory: release-source"));
  assert.equal(databaseAction.match(/run db:release:prod/gu)?.length, 1);
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
  assert.ok(
    setupAction.includes(
      'pnpm --dir "$SETUP_WORKING_DIRECTORY" install --frozen-lockfile'
    )
  );
  for (const [, workflowPath] of COMPONENT_WORKFLOWS) {
    const source = readRepoFile(workflowPath);
    assert.equal(
      source.match(
        /uses: \.\/release-control\/\.github\/actions\/setup-node-pnpm/gu
      )?.length,
      1,
      `${workflowPath} must use the cached setup once`
    );
  }
});

test("historical mainline release source remains usable after control actions are added", () => {
  const repositoryPath = mkdtempSync(
    path.join(tmpdir(), "openmeld-historical-release-control-")
  );
  const isolatedGitEnvironment = createIsolatedGitEnvironment();
  const runGit = (...args) =>
    execFileSync("git", args, {
      cwd: repositoryPath,
      encoding: "utf8",
      env: isolatedGitEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    runGit("init", "--initial-branch=main");
    runGit("config", "user.email", "release-control@test.openmeld.ai");
    runGit("config", "user.name", "OpenMeld Release Control Test");
    writeFileSync(
      path.join(repositoryPath, "product.txt"),
      "historical source\n"
    );
    runGit("add", "product.txt");
    runGit("commit", "-m", "historical release source");
    const historicalReleaseSha = runGit("rev-parse", "HEAD");

    const leaseActionPath = path.join(
      repositoryPath,
      ".github",
      "actions",
      "production-scope-lease"
    );
    mkdirSync(leaseActionPath, { recursive: true });
    writeFileSync(
      path.join(leaseActionPath, "action.yml"),
      "name: trusted lease control\n"
    );
    runGit("add", ".github/actions/production-scope-lease/action.yml");
    runGit("commit", "-m", "add trusted release control");
    const controlSha = runGit("rev-parse", "HEAD");

    const controlRoot = path.join(repositoryPath, "control");
    const releaseRoot = path.join(repositoryPath, "release-source");
    runGit("worktree", "add", "--detach", controlRoot, controlSha);
    runGit("worktree", "add", "--detach", releaseRoot, historicalReleaseSha);

    assert.ok(
      existsSync(
        path.join(
          controlRoot,
          ".github/actions/production-scope-lease/action.yml"
        )
      )
    );
    assert.ok(
      !existsSync(
        path.join(
          releaseRoot,
          ".github/actions/production-scope-lease/action.yml"
        )
      )
    );
    assert.equal(
      readFileSync(path.join(releaseRoot, "product.txt"), "utf8"),
      "historical source\n"
    );
  } finally {
    rmSync(repositoryPath, { force: true, recursive: true });
  }
});

function inspectSeparatedReleaseControl(workflow) {
  const controlCheckout = workflow.indexOf("path: release-control");
  const releaseCheckout = workflow.indexOf("path: release-source");
  return {
    controlPrecedesRelease:
      controlCheckout >= 0 && releaseCheckout > controlCheckout,
    disablesCredentials: workflow.includes("persist-credentials: false"),
    pinsWorkflowSha: workflow.includes(
      `ref: ${GITHUB_EXPRESSION_PREFIX} github.sha }}`
    ),
    usesReleaseSource:
      workflow.includes("working-directory: release-source") ||
      workflow.includes("working_directory: release-source"),
  };
}

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
      `pnpm exec vitest run --config vitest.config.ts --shard=${GITHUB_EXPRESSION_PREFIX} matrix.shard }}/8`
    )
  );
  assert.ok(
    !workflow.includes(
      "turbo run test:integration --filter=@openmeld/core -- --shard="
    )
  );
  assert.ok(workersIntegrationJob);
  assert.ok(
    workersIntegrationJob.includes(
      `name: Deep Confidence / Workers Integration ${GITHUB_EXPRESSION_PREFIX} matrix.shard }}/8`
    )
  );
  assert.ok(workersIntegrationJob.includes("shard: [1, 2, 3, 4, 5, 6, 7, 8]"));
  assert.ok(
    workersIntegrationJob.includes(
      `run: pnpm exec vitest run --config vitest.config.ts --shard=${GITHUB_EXPRESSION_PREFIX} matrix.shard }}/8`
    )
  );
  assert.equal(
    corePackage.scripts["test:integration"],
    "pnpm run test:integration:shard-1 && pnpm run test:integration:shard-2 && pnpm run test:integration:shard-3 && pnpm run test:integration:shard-4 && pnpm run test:integration:shard-5 && pnpm run test:integration:shard-6 && pnpm run test:integration:shard-7 && pnpm run test:integration:shard-8"
  );
  for (const shard of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.equal(
      corePackage.scripts[`test:integration:shard-${shard}`],
      `vitest run --config vitest.config.ts --shard=${shard}/8`
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

test("keeps Web source tests independent from removed hosted sharding machinery", () => {
  const webVitest = readRepoFile("clients/web/vitest.config.ts");
  const webTurbo = JSON.parse(readRepoFile("clients/web/turbo.json"));
  const turbo = JSON.parse(readRepoFile("turbo.json"));

  assert.ok(webVitest.includes('"@openmeld/db/auth"'));
  assert.ok(webVitest.includes('"@openmeld/projects"'));
  assert.deepEqual(webTurbo.tasks.test.dependsOn, ["transit"]);
  assert.deepEqual(turbo.tasks.transit.dependsOn, ["^transit"]);
  assert.equal(turbo.futureFlags?.errorsOnlyShowHash, true);
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
        "node ../release-control/scripts/release/hosted-production-preflight.mjs"
      ),
      `${workflowPath} must run current-main preflight control`
    );
    assert.ok(source.includes(`--scope ${scope}`));
    assert.ok(source.includes('--release-source "$PWD"'));
    assert.ok(source.includes('--release-sha "$RELEASE_SHA"'));
    assert.ok(!source.includes("pnpm run release:preflight:local"));
    assert.ok(!source.includes("pnpm run release:verify:local"));
    assert.ok(
      source.includes(healthEvidence),
      `${workflowPath} must verify post-deploy health`
    );
    assert.ok(!source.includes("shared-db-gate"));
    assert.ok(!source.includes("run_db_gate"));
  }
});

test("exposes one guarded local CLI publication entry and keeps the publisher internal", () => {
  const rootPackage = JSON.parse(readRepoFile("package.json"));
  const cliPackage = JSON.parse(
    readRepoFile("clients/openmeld-cli/package.json")
  );
  const localControl = readRepoFile("scripts/release/production-release.mjs");
  const internalPublisher = readRepoFile("scripts/release/release-cli.mjs");
  const hostedControl = readRepoFile("scripts/release/hosted-cli-release.mjs");

  assert.equal(rootPackage.scripts["release:cli"], undefined);
  assert.equal(
    cliPackage.scripts.deploy,
    "pnpm -C ../.. run release:deploy:local -- --scope cli"
  );
  assert.ok(localControl.includes('from "./release-cli.mjs"'));
  assert.ok(localControl.includes("publishCliRelease"));
  assert.ok(hostedControl.includes("runCliRelease"));
  assert.ok(!internalPublisher.includes("pathToFileURL(process.argv[1])"));
});

test("component workflows reject side-branch release sources before production code or secrets", () => {
  for (const [, workflowPath] of COMPONENT_WORKFLOWS) {
    const source = readRepoFile(workflowPath);
    const validationJob = source
      .split("\n  validate_release_source:")[1]
      ?.split("\n  deploy:")[0];
    const deployJob = source.split("\n  deploy:")[1];

    assert.ok(!source.includes("workflow_dispatch:"), workflowPath);
    assert.match(source, SCOPED_RELEASE_SHA_INPUT, workflowPath);
    assert.ok(validationJob?.includes("permissions:\n      contents: read"));
    assert.ok(
      validationJob?.includes(`ref: ${GITHUB_EXPRESSION_PREFIX} github.sha }}`)
    );
    assert.ok(
      validationJob?.includes("require-mainline-release-sha.mjs"),
      workflowPath
    );
    assert.ok(!validationJob?.includes("environment: production"));
    assert.ok(!validationJob?.includes("secrets."));
    assert.ok(!validationJob?.includes(RELEASE_SHA_CHECKOUT));
    assert.ok(deployJob?.includes("needs: validate_release_source"));
    assert.ok(deployJob?.includes("environment: production"));
    assert.ok(deployJob?.includes(RELEASE_SHA_CHECKOUT));
    assert.ok(!source.includes("inputs.release_sha || github.sha"));
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
      source.includes("run-name:") && source.includes("inputs.release_sha"),
      `${workflowPath} must expose its exact release SHA`
    );
  }

  const cliRelease = readRepoFile(".github/workflows/cli-release.yml");
  assert.ok(cliRelease.includes("run-name:"));
  assert.ok(cliRelease.includes("inputs.release_sha || github.sha"));
});

test("routes stable CLI projection recovery through the guarded Core workflow", () => {
  const recovery = readRepoFile(
    ".github/workflows/recover-core-cli-projection.yml"
  );
  const core = readRepoFile(".github/workflows/deploy-core-worker.yml");
  const cli = readRepoFile(".github/workflows/cli-release.yml");

  assert.match(recovery, SCOPED_RELEASE_SHA_INPUT);
  assert.ok(recovery.includes("require-mainline-release-sha.mjs"));
  assert.ok(
    recovery.includes("uses: ./.github/workflows/deploy-core-worker.yml")
  );
  assert.ok(
    recovery.includes("deployment_mode: current-stable-cli-projection")
  );
  assert.ok(!recovery.includes("deploy-auth-worker.yml"));
  assert.ok(!recovery.includes("deploy-web.yml"));
  assert.ok(
    core.includes("node scripts/release/deploy-core-current-cli-projection.mjs")
  );
  assert.ok(core.includes("pnpm run evidence:startup:core"));
  assert.match(core, LOCAL_CORE_STARTUP_DIAGNOSTIC);
  assert.ok(core.includes("deploy-core-worker.mjs"));
  assert.ok(core.includes("--current-stable-cli-projection"));
  assert.ok(core.includes("core-startup-evidence-"));
  assert.ok(core.includes("core-startup-profile-"));
  assert.ok(
    core.includes("inputs.deployment_mode == 'current-stable-cli-projection'")
  );
  assert.ok(cli.includes("group: deploy-core-worker-production"));
});

test("loads the current-stable Core projection entrypoint in plain Node", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import('./scripts/release/deploy-core-current-cli-projection.mjs')",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 0, result.stderr);
});

test("keeps the current-stable Core projection schema type-safe for downstream packages", () => {
  const result = spawnSync(
    PNPM_BINARY,
    [
      "exec",
      "tsc",
      "--noEmit",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--target",
      "ESNext",
      "--skipLibCheck",
      "packages/schemas/src/schemas/local-components.ts",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 0, result.stderr);
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
