import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
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
const ENTRYPOINT_PATH = "scripts/ci/trusted-final-candidate.sh";
const TRUSTED_MARKER_PATTERN = /TRUSTED_BOOTSTRAP/u;
const MALICIOUS_MARKER_PATTERN = /MALICIOUS_BOOTSTRAP/u;
const EXPLICIT_BOOTSTRAP_PATTERN = /Control trust: explicit-bootstrap/u;
const MISSING_BOOTSTRAP_PATTERN =
  /Current main does not contain the trusted Final Candidate bootstrap/u;

test("the guarded local first hop comes from current main, not candidate package scripts", () => {
  const fixture = createEntrypointFixture();
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    );
    assert.equal(packageJson.scripts.candidate, undefined);
    assert.equal(packageJson.scripts["candidate:local"], undefined);

    const trustedEntrypoint = fixture.git(
      fixture.repositoryPath,
      "show",
      `refs/remotes/origin/main:${ENTRYPOINT_PATH}`
    );
    const result = spawnSync("bash", ["-s", "--", "plan", "--pr", "1"], {
      cwd: fixture.repositoryPath,
      encoding: "utf8",
      env: {
        ...process.env,
        ATTACK_LOG: fixture.attackLog,
      },
      input: trustedEntrypoint,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, TRUSTED_MARKER_PATTERN);
    assert.doesNotMatch(result.stdout, MALICIOUS_MARKER_PATTERN);
    assert.equal(existsSync(fixture.attackLog), false);
  } finally {
    fixture.cleanup();
  }
});

test("the guarded first-hop fetch strips Git tracing and names an explicit trusted remote", () => {
  const entrypoint = readFileSync(
    path.join(REPO_ROOT, ENTRYPOINT_PATH),
    "utf8"
  );

  for (const variableName of [
    "ALL_PROXY",
    "CURL_CA_BUNDLE",
    "GIT_CURL_VERBOSE",
    "GIT_HTTP_PROXY_AUTHMETHOD",
    "GIT_PROXY_SSL_CAINFO",
    "GIT_SSL_CAINFO",
    "GIT_SSL_CAPATH",
    "GIT_SSL_NO_VERIFY",
    "GIT_TRACE",
    "GIT_TRACE_CURL",
    "GIT_TRACE_PACKET",
    "GIT_TRACE2",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
  ]) {
    assert.ok(
      entrypoint.includes(`-u ${variableName}`),
      `${variableName} must not reach the trusted fetch`
    );
  }
  assert.ok(entrypoint.includes("GIT_TRACE_REDACT=1"));
  assert.ok(entrypoint.includes('fetch --no-tags "$trusted_remote_url"'));
  assert.ok(!entrypoint.includes("fetch --no-tags origin"));
});

test("an explicit inspected control object bootstraps a main that predates the gate", () => {
  const fixture = createInitialBootstrapFixture();
  try {
    const candidateHead = fixture.git(
      fixture.repositoryPath,
      "rev-parse",
      "HEAD"
    );
    const entrypoint = fixture.git(
      fixture.repositoryPath,
      "show",
      `${candidateHead}:${ENTRYPOINT_PATH}`
    );
    const rejected = spawnSync("bash", ["-s", "--", "plan"], {
      cwd: fixture.repositoryPath,
      encoding: "utf8",
      input: entrypoint,
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, MISSING_BOOTSTRAP_PATTERN);

    const bootstrapped = spawnSync(
      "bash",
      [
        "-s",
        "--",
        "plan",
        "--bootstrap-control-sha",
        candidateHead,
        "--bootstrap-reason",
        "Current main predates the guarded Final Candidate control plane.",
      ],
      {
        cwd: fixture.repositoryPath,
        encoding: "utf8",
        input: entrypoint,
      }
    );
    assert.equal(bootstrapped.status, 0, bootstrapped.stderr);
    assert.match(bootstrapped.stdout, EXPLICIT_BOOTSTRAP_PATTERN);
    assert.match(bootstrapped.stdout, TRUSTED_MARKER_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

function createEntrypointFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-trusted-entrypoint-"));
  const remotePath = path.join(root, "remote.git");
  const repositoryPath = path.join(root, "repository");
  const attackLog = path.join(root, "candidate-published-green.log");
  mkdirSync(repositoryPath);
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git(root, "init", "--bare", "--quiet", remotePath);
  git(repositoryPath, "init", "--initial-branch=main", "--quiet");
  git(repositoryPath, "config", "user.email", "entrypoint@test.openmeld.ai");
  git(repositoryPath, "config", "user.name", "OpenMeld Entrypoint Test");
  writeFileSync(
    path.join(repositoryPath, "package.json"),
    '{"private":true,"scripts":{}}\n'
  );
  writeTrustedControl(repositoryPath);
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "--quiet", "-m", "seed trusted main");
  git(repositoryPath, "remote", "add", "origin", remotePath);
  git(repositoryPath, "push", "--quiet", "-u", "origin", "main");

  git(repositoryPath, "checkout", "--quiet", "-b", "codex/malicious-candidate");
  writeFileSync(
    path.join(repositoryPath, "package.json"),
    '{"private":true,"scripts":{"candidate:local":"node scripts/ci/final-candidate-bootstrap.mjs"}}\n'
  );
  writeFileSync(
    path.join(repositoryPath, "scripts", "ci", "final-candidate-bootstrap.mjs"),
    [
      'import { appendFileSync } from "node:fs";',
      'appendFileSync(process.env.ATTACK_LOG, "success\\n");',
      'process.stdout.write("MALICIOUS_BOOTSTRAP\\n");',
      "",
    ].join("\n")
  );
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "--quiet", "-m", "replace local gate");

  return {
    attackLog,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    git,
    repositoryPath,
  };
}

function writeTrustedControl(repositoryPath) {
  const controlDirectory = path.join(repositoryPath, "scripts", "ci");
  mkdirSync(controlDirectory, { recursive: true });
  writeFileSync(
    path.join(repositoryPath, ENTRYPOINT_PATH),
    readFileSync(path.join(REPO_ROOT, ENTRYPOINT_PATH), "utf8")
  );
  writeFileSync(
    path.join(controlDirectory, "final-candidate-bootstrap.mjs"),
    [
      'import { pathToFileURL } from "node:url";',
      "if (import.meta.url === pathToFileURL(process.argv[1]).href) {",
      '  process.stdout.write("TRUSTED_BOOTSTRAP " + process.argv.slice(2).join(" ") + "\\n");',
      "}",
      "",
    ].join("\n")
  );
}

function createInitialBootstrapFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-initial-bootstrap-"));
  const remotePath = path.join(root, "remote.git");
  const repositoryPath = path.join(root, "repository");
  mkdirSync(repositoryPath);
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git(root, "init", "--bare", "--quiet", remotePath);
  git(repositoryPath, "init", "--initial-branch=main", "--quiet");
  git(
    repositoryPath,
    "config",
    "user.email",
    "bootstrap-entry@test.openmeld.ai"
  );
  git(repositoryPath, "config", "user.name", "OpenMeld Bootstrap Entry Test");
  writeFileSync(
    path.join(repositoryPath, "package.json"),
    '{"private":true}\n'
  );
  git(repositoryPath, "add", ".");
  git(
    repositoryPath,
    "commit",
    "--quiet",
    "-m",
    "seed main before final candidate"
  );
  git(repositoryPath, "remote", "add", "origin", remotePath);
  git(repositoryPath, "push", "--quiet", "-u", "origin", "main");

  git(repositoryPath, "checkout", "--quiet", "-b", "codex/add-final-candidate");
  writeTrustedControl(repositoryPath);
  git(repositoryPath, "add", ".");
  git(repositoryPath, "commit", "--quiet", "-m", "add final candidate control");

  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    git,
    repositoryPath,
  };
}
