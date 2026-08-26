import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FINAL_CANDIDATE_SCRIPT = path.join(SCRIPT_DIR, "final-candidate.mjs");
const REPOSITORY_LOCAL_GIT_ENV_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
];
const CANDIDATE_EVIDENCE_PATTERN = /OpenMeld Final Candidate Evidence/u;
const COMMENT_ENDPOINT_PATTERN = /issues\/1\/comments/u;
const DOCUMENTATION_CHECK_PATTERN = /documentation-contracts/u;
const FAILURE_STATUS_PATTERN = /state=failure/u;
const MAIN_ADVANCED_PATTERN = /Main advanced/u;
const PENDING_STATUS_PATTERN = /state=pending/u;
const SUCCESS_STATUS_PATTERN = /state=success/u;

test("the local fallback publishes shared success for one exact candidate", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture);

    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "success");
    assert.equal(evidence.headSha, fixture.headSha);
    assert.equal(evidence.baseSha, fixture.baseSha);
    assert.deepEqual(
      evidence.results.map((entry) => entry.status),
      ["passed", "passed"]
    );
    const ghLog = readFileSync(fixture.ghLogPath, "utf8");
    assert.match(ghLog, PENDING_STATUS_PATTERN);
    assert.match(ghLog, SUCCESS_STATUS_PATTERN);
    assert.match(ghLog, COMMENT_ENDPOINT_PATTERN);
    assert.match(result.stdout, CANDIDATE_EVIDENCE_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

test("a selected command failure publishes failure and blocks the candidate", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, { pnpmExitCode: 9 });

    assert.equal(result.status, 1);
    assert.match(result.stderr, DOCUMENTATION_CHECK_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "failure");
    assert.equal(evidence.results.at(-1).status, "failed");
    const ghLog = readFileSync(fixture.ghLogPath, "utf8");
    assert.match(ghLog, PENDING_STATUS_PATTERN);
    assert.match(ghLog, FAILURE_STATUS_PATTERN);
    assert.doesNotMatch(ghLog, SUCCESS_STATUS_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

test("current main drift rejects stale green before checks run", () => {
  const fixture = createCandidateFixture();
  try {
    advanceRemoteMain(fixture);
    const result = runCandidateFixture(fixture);

    assert.equal(result.status, 1);
    assert.match(result.stderr, MAIN_ADVANCED_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "failure");
    assert.deepEqual(evidence.results, []);
    assert.equal(readFileSync(fixture.pnpmLogPath, "utf8"), "");
  } finally {
    fixture.cleanup();
  }
});

function createCandidateFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-final-candidate-"));
  const remotePath = path.join(root, "remote.git");
  const repositoryPath = path.join(root, "repository");
  const binPath = path.join(root, "bin");
  const ghLogPath = path.join(root, "gh.log");
  const pnpmLogPath = path.join(root, "pnpm.log");
  const evidencePath = path.join(root, "evidence.json");
  mkdirSync(repositoryPath);
  mkdirSync(binPath);
  writeFileSync(ghLogPath, "");
  writeFileSync(pnpmLogPath, "");
  const gitEnvironment = isolatedGitEnvironment(process.env);
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: gitEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git(root, "init", "--bare", "--quiet", remotePath);
  git(repositoryPath, "init", "--initial-branch=main", "--quiet");
  git(repositoryPath, "config", "user.email", "candidate@test.openmeld.ai");
  git(repositoryPath, "config", "user.name", "OpenMeld Candidate Test");
  writeFileSync(path.join(repositoryPath, "AGENTS.md"), "# Baseline\n");
  git(repositoryPath, "add", "AGENTS.md");
  git(repositoryPath, "commit", "--quiet", "-m", "seed main");
  git(repositoryPath, "remote", "add", "origin", remotePath);
  git(repositoryPath, "push", "--quiet", "-u", "origin", "main");
  const baseSha = git(repositoryPath, "rev-parse", "HEAD");
  git(repositoryPath, "checkout", "--quiet", "-b", "codex/candidate");
  writeFileSync(
    path.join(repositoryPath, "AGENTS.md"),
    "# Candidate\n\nExact behavior.\n"
  );
  git(repositoryPath, "add", "AGENTS.md");
  git(repositoryPath, "commit", "--quiet", "-m", "update agent guidance");
  const headSha = git(repositoryPath, "rev-parse", "HEAD");

  writeExecutable(
    path.join(binPath, "gh"),
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_GH_LOG, args.join(" ") + "\\n");
const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
if (endpoint.endsWith("/pulls/1")) {
  process.stdout.write(JSON.stringify({
    base: { ref: "main", sha: process.env.TEST_BASE_SHA },
    draft: false,
    head: { ref: "codex/candidate", sha: process.env.TEST_HEAD_SHA },
    html_url: "https://github.com/amplifthq/openmeld/pull/1",
    labels: [],
    number: 1,
    state: "open"
  }));
} else if (endpoint.endsWith("/comments")) {
  process.stdout.write(JSON.stringify({ html_url: "https://github.com/amplifthq/openmeld/pull/1#issuecomment-1" }));
} else {
  process.stdout.write("{}");
}
`
  );
  writeExecutable(
    path.join(binPath, "pnpm"),
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.TEST_PNPM_LOG, process.argv.slice(2).join(" ") + "\\n");
process.exit(Number(process.env.TEST_PNPM_EXIT_CODE ?? "0"));
`
  );

  return {
    baseSha,
    binPath,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    evidencePath,
    ghLogPath,
    git,
    gitEnvironment,
    headSha,
    pnpmLogPath,
    remotePath,
    repositoryPath,
    root,
  };
}

function runCandidateFixture(fixture, options = {}) {
  return spawnSync(
    process.execPath,
    [
      FINAL_CANDIDATE_SCRIPT,
      "run",
      "--",
      "--mode",
      "local",
      "--publish-status",
      "--repository",
      "amplifthq/openmeld",
      "--pr",
      "1",
      "--head",
      fixture.headSha,
      "--base",
      fixture.baseSha,
      "--evidence",
      fixture.evidencePath,
    ],
    {
      cwd: fixture.repositoryPath,
      encoding: "utf8",
      env: {
        ...isolatedGitEnvironment(process.env),
        PATH: `${fixture.binPath}${path.delimiter}${process.env.PATH}`,
        TEST_BASE_SHA: fixture.baseSha,
        TEST_GH_LOG: fixture.ghLogPath,
        TEST_HEAD_SHA: fixture.headSha,
        TEST_PNPM_EXIT_CODE: String(options.pnpmExitCode ?? 0),
        TEST_PNPM_LOG: fixture.pnpmLogPath,
      },
    }
  );
}

function advanceRemoteMain(fixture) {
  const maintainerPath = path.join(fixture.root, "maintainer");
  fixture.git(
    fixture.root,
    "clone",
    "--quiet",
    fixture.remotePath,
    maintainerPath
  );
  fixture.git(maintainerPath, "config", "user.email", "main@test.openmeld.ai");
  fixture.git(maintainerPath, "config", "user.name", "OpenMeld Main Test");
  writeFileSync(path.join(maintainerPath, "main.md"), "new main\n");
  fixture.git(maintainerPath, "add", "main.md");
  fixture.git(maintainerPath, "commit", "--quiet", "-m", "advance main");
  fixture.git(maintainerPath, "push", "--quiet", "origin", "main");
}

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function isolatedGitEnvironment(environment) {
  const isolated = { ...environment };
  for (const name of REPOSITORY_LOCAL_GIT_ENV_VARS) {
    delete isolated[name];
  }
  return isolated;
}
