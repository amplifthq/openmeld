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
const GITHUB_PULL_REQUEST_FIXTURE = path.join(
  SCRIPT_DIR,
  "fixtures",
  "github-pull-request-325.json"
);
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
const TOKEN_ABSENCE_PATTERN = /GH_TOKEN=absent GITHUB_TOKEN=absent/u;
const BEHAVIOR_FAILURE_PATTERN = /behavior failed/u;
const SECRET_VALUE_PATTERN = /super-secret/u;
const CANDIDATE_VALIDATION_FAILURE_PATTERN = /Candidate validation failed/u;
const EVIDENCE_PUBLICATION_FAILURE_PATTERN = /Evidence publication failed/u;
const EXIT_CODE_SEVEN_PATTERN = /exit code 7/u;
const ORIGINAL_SELECTED_CHECK_PATTERN = /original selected-check/u;
const FINAL_STATUS_OPERATION_PATTERN = /`final-status`/u;

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
    const result = runCandidateFixture(fixture, {
      pnpmExitCode: 9,
      pnpmStderr: "behavior failed with token=super-secret-value\n",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, DOCUMENTATION_CHECK_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "failure");
    assert.equal(evidence.results.at(-1).status, "failed");
    assert.equal(evidence.results.at(-1).exitCode, 9);
    assert.match(evidence.results.at(-1).stderrTail, BEHAVIOR_FAILURE_PATTERN);
    assert.doesNotMatch(
      evidence.results.at(-1).stderrTail,
      SECRET_VALUE_PATTERN
    );
    assert.match(
      readFileSync(fixture.candidateEnvironmentLogPath, "utf8"),
      TOKEN_ABSENCE_PATTERN
    );
    const ghLog = readFileSync(fixture.ghLogPath, "utf8");
    assert.match(ghLog, PENDING_STATUS_PATTERN);
    assert.match(ghLog, FAILURE_STATUS_PATTERN);
    assert.doesNotMatch(ghLog, SUCCESS_STATUS_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

test("publication failures preserve the original check failure and remain blocking", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      ghPublicationFailure: true,
      pnpmExitCode: 7,
      pnpmStderr: "original selected-check failure\n",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, CANDIDATE_VALIDATION_FAILURE_PATTERN);
    assert.match(result.stderr, EVIDENCE_PUBLICATION_FAILURE_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "failure");
    assert.match(evidence.error, EXIT_CODE_SEVEN_PATTERN);
    assert.match(
      evidence.results.at(-1).stderrTail,
      ORIGINAL_SELECTED_CHECK_PATTERN
    );
    assert.deepEqual(
      evidence.publicationErrors.map((entry) => entry.operation),
      ["pending-status", "final-status", "pull-request-comment"]
    );
  } finally {
    fixture.cleanup();
  }
});

test("a final-status failure is recorded before the local evidence comment", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      ghFailureOperations: ["final-status"],
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, EVIDENCE_PUBLICATION_FAILURE_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "success");
    assert.deepEqual(
      evidence.publicationErrors.map((entry) => entry.operation),
      ["final-status"]
    );
    const ghLog = readFileSync(fixture.ghLogPath, "utf8");
    assert.match(ghLog, COMMENT_ENDPOINT_PATTERN);
    assert.match(ghLog, FINAL_STATUS_OPERATION_PATTERN);
    assert.ok(
      ghLog.indexOf("state=success") < ghLog.indexOf("issues/1/comments")
    );
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

test("main drift during a selected command is rejected by the post-check reread", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      advanceMainDuringCheck: true,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, MAIN_ADVANCED_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "failure");
    assert.deepEqual(
      evidence.results.map((entry) => entry.status),
      ["passed", "passed"]
    );
    assert.notEqual(
      fixture.git(fixture.repositoryPath, "rev-parse", "origin/main"),
      fixture.baseSha
    );
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
  const candidateEnvironmentLogPath = path.join(root, "candidate-env.log");
  const evidencePath = path.join(root, "evidence.json");
  mkdirSync(repositoryPath);
  mkdirSync(binPath);
  writeFileSync(ghLogPath, "");
  writeFileSync(pnpmLogPath, "");
  writeFileSync(candidateEnvironmentLogPath, "");
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
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_GH_LOG, args.join(" ") + "\\n");
const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
const operation = endpoint.endsWith("/comments")
  ? "pull-request-comment"
  : endpoint.includes("/statuses/") && args.includes("state=pending")
    ? "pending-status"
    : endpoint.includes("/statuses/")
      ? "final-status"
      : "read";
const input = args.includes("--input") ? readFileSync(0, "utf8") : "";
if (input) {
  appendFileSync(process.env.TEST_GH_LOG, input + "\\n");
}
const failedOperations = new Set((process.env.TEST_GH_FAILURE_OPERATIONS ?? "").split(",").filter(Boolean));
if ((process.env.TEST_GH_PUBLICATION_FAILURE === "1" && (endpoint.includes("/statuses/") || endpoint.endsWith("/comments"))) || failedOperations.has(operation)) {
  process.stderr.write("simulated GitHub publication failure\\n");
  process.exit(17);
}
if (endpoint.endsWith("/pulls/1")) {
  const captured = JSON.parse(readFileSync(process.env.TEST_GITHUB_PULL_REQUEST_FIXTURE, "utf8")).response;
  captured.base.sha = process.env.TEST_BASE_SHA;
  captured.head.ref = "codex/candidate";
  captured.head.sha = process.env.TEST_HEAD_SHA;
  captured.html_url = "https://github.com/amplifthq/openmeld/pull/1";
  captured.number = 1;
  process.stdout.write(JSON.stringify(captured));
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
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
appendFileSync(process.env.TEST_PNPM_LOG, process.argv.slice(2).join(" ") + "\\n");
appendFileSync(process.env.TEST_CANDIDATE_ENV_LOG, "GH_TOKEN=" + (process.env.GH_TOKEN ? "present" : "absent") + " GITHUB_TOKEN=" + (process.env.GITHUB_TOKEN ? "present" : "absent") + "\\n");
if (process.env.TEST_ADVANCE_MAIN_DURING_CHECK === "1" && !existsSync(process.env.TEST_MAIN_DRIFT_MARKER)) {
  const maintainer = process.env.TEST_MAINTAINER_PATH;
  execFileSync("git", ["clone", "--quiet", process.env.TEST_REMOTE_PATH, maintainer]);
  execFileSync("git", ["config", "user.email", "main-drift@test.openmeld.ai"], { cwd: maintainer });
  execFileSync("git", ["config", "user.name", "OpenMeld Main Drift Test"], { cwd: maintainer });
  writeFileSync(path.join(maintainer, "during-check.md"), "main changed during candidate\\n");
  execFileSync("git", ["add", "during-check.md"], { cwd: maintainer });
  execFileSync("git", ["commit", "--quiet", "-m", "advance main during check"], { cwd: maintainer });
  execFileSync("git", ["push", "--quiet", "origin", "main"], { cwd: maintainer });
  writeFileSync(process.env.TEST_MAIN_DRIFT_MARKER, "advanced\\n");
}
if (process.env.TEST_PNPM_STDERR) {
  process.stderr.write(process.env.TEST_PNPM_STDERR);
}
process.exit(Number(process.env.TEST_PNPM_EXIT_CODE ?? "0"));
`
  );

  return {
    baseSha,
    binPath,
    candidateEnvironmentLogPath,
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
        GH_TOKEN: "write-capable-token-must-not-reach-checks",
        GITHUB_TOKEN: "write-capable-token-must-not-reach-checks",
        PATH: `${fixture.binPath}${path.delimiter}${process.env.PATH}`,
        TEST_ADVANCE_MAIN_DURING_CHECK: options.advanceMainDuringCheck
          ? "1"
          : "0",
        TEST_BASE_SHA: fixture.baseSha,
        TEST_CANDIDATE_ENV_LOG: fixture.candidateEnvironmentLogPath,
        TEST_GH_PUBLICATION_FAILURE: options.ghPublicationFailure ? "1" : "0",
        TEST_GH_FAILURE_OPERATIONS: (options.ghFailureOperations ?? []).join(
          ","
        ),
        TEST_GH_LOG: fixture.ghLogPath,
        TEST_GITHUB_PULL_REQUEST_FIXTURE: GITHUB_PULL_REQUEST_FIXTURE,
        TEST_HEAD_SHA: fixture.headSha,
        TEST_MAIN_DRIFT_MARKER: path.join(fixture.root, "main-drift.marker"),
        TEST_MAINTAINER_PATH: path.join(
          fixture.root,
          "during-check-maintainer"
        ),
        TEST_PNPM_EXIT_CODE: String(options.pnpmExitCode ?? 0),
        TEST_PNPM_LOG: fixture.pnpmLogPath,
        TEST_PNPM_STDERR: options.pnpmStderr ?? "",
        TEST_REMOTE_PATH: fixture.remotePath,
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
