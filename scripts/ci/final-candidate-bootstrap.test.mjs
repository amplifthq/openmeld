import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_SCRIPT = path.join(SCRIPT_DIR, "final-candidate-bootstrap.mjs");
const BASE_CONTROL_PATTERN = /BASE_CONTROL/u;
const BOOTSTRAP_ARGUMENT_PATTERN = /--bootstrap-control-sha/u;
const BOOTSTRAP_REASON_PATTERN =
  /--bootstrap-reason Current main predates the guarded Final Candidate control plane\./u;
const CANDIDATE_CONTROL_PATTERN = /CANDIDATE_CONTROL/u;
const CURRENT_MAIN_CONTROL_PATTERN = /--control-trust current-main/u;
const EXPLICIT_BOOTSTRAP_PATTERN = /--control-trust explicit-bootstrap/u;
const MISSING_CURRENT_MAIN_CONTROL_PATTERN = /Current main does not contain/u;

test("local fallback executes current-main control for an ordinary candidate", () => {
  const fixture = createFixture({
    baseHasControl: true,
    candidateChangesControl: false,
  });
  try {
    const result = runBootstrap(fixture, ["run", "--", "--pr", "1"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, BASE_CONTROL_PATTERN);
    assert.doesNotMatch(result.stdout, CANDIDATE_CONTROL_PATTERN);
    assert.match(
      result.stdout,
      new RegExp(`--plan-source ${fixture.baseSha}`, "u")
    );
    assert.match(result.stdout, CURRENT_MAIN_CONTROL_PATTERN);
    assert.match(
      result.stdout,
      new RegExp(
        `--candidate-root ${escapeRegex(realpathSync(fixture.repositoryPath))}`,
        "u"
      )
    );
  } finally {
    fixture.cleanup();
  }
});

test("delivery-control bootstrap requires an exact candidate SHA and explicit reason", () => {
  const fixture = createFixture({
    baseHasControl: false,
    candidateChangesControl: true,
  });
  try {
    const ordinary = runBootstrap(fixture, ["run", "--", "--pr", "1"]);
    assert.equal(ordinary.status, 1);
    assert.match(ordinary.stderr, MISSING_CURRENT_MAIN_CONTROL_PATTERN);
    assert.match(ordinary.stderr, BOOTSTRAP_ARGUMENT_PATTERN);

    const bootstrapped = runBootstrap(fixture, [
      "run",
      "--",
      "--pr",
      "1",
      "--bootstrap-control-sha",
      fixture.headSha,
      "--bootstrap-reason",
      "Current main predates the guarded Final Candidate control plane.",
    ]);
    assert.equal(bootstrapped.status, 0, bootstrapped.stderr);
    assert.match(bootstrapped.stdout, CANDIDATE_CONTROL_PATTERN);
    assert.match(bootstrapped.stdout, EXPLICIT_BOOTSTRAP_PATTERN);
    assert.match(
      bootstrapped.stdout,
      new RegExp(`--plan-source ${fixture.headSha}`, "u")
    );
    assert.match(bootstrapped.stdout, BOOTSTRAP_REASON_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

function createFixture(input) {
  const root = mkdtempSync(
    path.join(tmpdir(), "openmeld-candidate-bootstrap-")
  );
  const remotePath = path.join(root, "remote.git");
  const repositoryPath = path.join(root, "repository");
  const binPath = path.join(root, "bin");
  mkdirSync(repositoryPath);
  mkdirSync(binPath);
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git(root, "init", "--bare", "--quiet", remotePath);
  git(repositoryPath, "init", "--initial-branch=main", "--quiet");
  git(repositoryPath, "config", "user.email", "bootstrap@test.openmeld.ai");
  git(repositoryPath, "config", "user.name", "OpenMeld Bootstrap Test");
  writeFileSync(
    path.join(repositoryPath, "package.json"),
    '{"private":true}\n'
  );
  writeFileSync(
    path.join(repositoryPath, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n"
  );
  if (input.baseHasControl) {
    writeControl(repositoryPath, "BASE_CONTROL");
  }
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "--quiet", "-m", "seed main");
  git(repositoryPath, "remote", "add", "origin", remotePath);
  git(repositoryPath, "push", "--quiet", "-u", "origin", "main");
  const baseSha = git(repositoryPath, "rev-parse", "HEAD");

  git(repositoryPath, "checkout", "--quiet", "-b", "codex/candidate");
  if (input.candidateChangesControl) {
    writeControl(repositoryPath, "CANDIDATE_CONTROL");
  } else {
    writeFileSync(
      path.join(repositoryPath, "product.txt"),
      "candidate product\n"
    );
  }
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "--quiet", "-m", "change candidate control");
  const headSha = git(repositoryPath, "rev-parse", "HEAD");

  writeExecutable(path.join(binPath, "pnpm"), "#!/bin/sh\nexit 0\n");
  return {
    baseSha,
    binPath,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    headSha,
    repositoryPath,
  };
}

function writeControl(root, marker) {
  const controlDirectory = path.join(root, "scripts", "ci");
  mkdirSync(controlDirectory, { recursive: true });
  writeFileSync(
    path.join(controlDirectory, "final-candidate.mjs"),
    [
      'import { pathToFileURL } from "node:url";',
      "if (import.meta.url === pathToFileURL(process.argv[1]).href) {",
      `  process.stdout.write(${JSON.stringify(`${marker} `)} + process.argv.slice(2).join(" ") + "\\n");`,
      "}",
      "",
    ].join("\n")
  );
}

function runBootstrap(fixture, args) {
  return spawnSync(process.execPath, [BOOTSTRAP_SCRIPT, ...args], {
    cwd: fixture.repositoryPath,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.binPath}${path.delimiter}${process.env.PATH}`,
    },
  });
}

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function escapeRegex(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
