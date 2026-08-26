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

const SCRIPT_PATH = fileURLToPath(
  new URL("./check-candidate-code-quality.mjs", import.meta.url)
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

test("checks exact changed files, excludes deletions, and propagates failure", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-candidate-quality-"));
  const repositoryPath = path.join(root, "repository");
  const binPath = path.join(root, "bin");
  const pnpmLogPath = path.join(root, "pnpm.log");
  const gitEnvironment = isolatedGitEnvironment(process.env);
  mkdirSync(repositoryPath);
  mkdirSync(binPath);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repositoryPath,
      encoding: "utf8",
      env: gitEnvironment,
    }).trim();

  try {
    git("init", "--initial-branch=main", "--quiet");
    git("config", "user.email", "quality@test.openmeld.ai");
    git("config", "user.name", "OpenMeld Quality Test");
    writeFileSync(path.join(repositoryPath, "changed.mjs"), "export {};\n");
    writeFileSync(path.join(repositoryPath, "deleted.mjs"), "export {};\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "seed");
    const baseSha = git("rev-parse", "HEAD");
    writeFileSync(
      path.join(repositoryPath, "changed.mjs"),
      "export const changed = true;\n"
    );
    git("rm", "--quiet", "deleted.mjs");
    git("add", "changed.mjs");
    git("commit", "--quiet", "-m", "change candidate");
    const headSha = git("rev-parse", "HEAD");
    writeExecutable(
      path.join(binPath, "pnpm"),
      `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.TEST_PNPM_LOG, process.argv.slice(2).join(" ") + "\\n");
process.exit(Number(process.env.TEST_PNPM_EXIT_CODE ?? "0"));
`
    );

    const success = runFixture({
      baseSha,
      binPath,
      headSha,
      pnpmExitCode: 0,
      pnpmLogPath,
      repositoryPath,
    });
    assert.equal(success.status, 0, success.stderr);
    const invocation = readFileSync(pnpmLogPath, "utf8");
    assert.ok(invocation.includes("changed.mjs"));
    assert.ok(!invocation.includes("deleted.mjs"));
    assert.ok(success.stdout.includes("Candidate code-quality paths:"));

    const failure = runFixture({
      baseSha,
      binPath,
      headSha,
      pnpmExitCode: 9,
      pnpmLogPath,
      repositoryPath,
    });
    assert.equal(failure.status, 1);
    assert.ok(failure.stderr.includes("failed with exit 9"));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

function runFixture(input) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, input.baseSha, input.headSha],
    {
      cwd: input.repositoryPath,
      encoding: "utf8",
      env: {
        ...isolatedGitEnvironment(process.env),
        PATH: `${input.binPath}${path.delimiter}${process.env.PATH}`,
        TEST_PNPM_EXIT_CODE: String(input.pnpmExitCode),
        TEST_PNPM_LOG: input.pnpmLogPath,
      },
    }
  );
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
