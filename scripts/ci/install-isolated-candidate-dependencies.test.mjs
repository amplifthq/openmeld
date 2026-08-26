import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
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

import { createTrustedGitEnvironment } from "./trusted-git-network.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const INSTALL_SCRIPT = "install-isolated-candidate-dependencies.sh";
const PREPARE_SCRIPT = "prepare-isolated-candidate.sh";
const RESOLVE_APPROVED_BUILDS_SCRIPT = "resolve-approved-native-builds.mjs";
const WRAPPER_SCRIPT = "run-isolated-candidate-command.sh";
const CANDIDATE_INSTALL_DENIED_PATTERN = /candidate install denied/u;
const GIT_POINTER_GROUP_DENIED_PATTERN =
  /chgrp: changing group of .*\/\.git.*Operation not permitted/u;
const PNPM_EXECUTION_DENIED_PATTERN = /env: .*pnpm.*Permission denied/u;
const TEMPLATE_EXPRESSION_PREFIX = "$";

test(
  "Linux non-root runner can prepare the candidate Git pointer",
  { skip: !supportsHostedNonRootLinuxIsolation() },
  () => {
    const fixture = createLinuxInstallFixture();
    try {
      const prepare = run(fixture, PREPARE_SCRIPT);
      assert.doesNotMatch(prepare.stderr, GIT_POINTER_GROUP_DENIED_PATTERN);
      assert.equal(prepare.status, 0, prepare.stderr);
    } finally {
      fixture.cleanup();
    }
  }
);

test(
  "Linux candidate install does not execute pnpm from the private runner home",
  { skip: !supportsHostedNonRootLinuxIsolation() },
  () => {
    const fixture = createLinuxInstallFixture();
    try {
      const privateRunnerRoot = path.join(fixture.root, "runner-private");
      const privatePnpmHome = path.join(
        privateRunnerRoot,
        "node_modules",
        ".bin"
      );
      const privateRunnerBin = path.join(privatePnpmHome, "bin");
      const privatePnpm = path.join(privateRunnerBin, "pnpm");
      mkdirSync(privateRunnerBin, { recursive: true });
      writeFileSync(
        path.join(privateRunnerRoot, "package.json"),
        '{"private":true}\n'
      );
      writeFileSync(
        privatePnpm,
        '#!/usr/bin/env node\nif (process.argv[2] === "--version") process.stdout.write("10.30.0\\n");\n'
      );
      chmodSync(privatePnpm, 0o555);
      chmodSync(privateRunnerRoot, 0o700);
      fixture.environment.PATH = `${privateRunnerBin}:${fixture.environment.PATH}`;
      fixture.environment.PNPM_HOME = privatePnpmHome;

      const prepare = run(fixture, PREPARE_SCRIPT);
      assert.equal(prepare.status, 0, prepare.stderr);
      const install = run(fixture, INSTALL_SCRIPT);
      assert.doesNotMatch(install.stderr, PNPM_EXECUTION_DENIED_PATTERN);
      assert.equal(install.status, 0, install.stderr);
    } finally {
      fixture.cleanup();
    }
  }
);

test(
  "Linux candidate install cannot escape through pnpm hooks or external store config",
  { skip: !supportsHostedLinuxIsolation() },
  () => {
    const fixture = createLinuxInstallFixture();
    try {
      const prepare = run(fixture, PREPARE_SCRIPT);
      assert.equal(prepare.status, 0, prepare.stderr);

      const gitPointerBefore = readFileSync(
        path.join(fixture.candidateRoot, ".git"),
        "utf8"
      );
      const gitConfigBefore = readFileSync(
        path.join(fixture.candidateGitDir, "config"),
        "utf8"
      );
      const attackHelper = path.join(fixture.candidateRoot, "git-attack.sh");
      const attackMarker = path.join(fixture.root, "git-attack-ran.log");
      writeFileSync(
        attackHelper,
        `#!/usr/bin/env bash\nprintf 'executed\\n' > ${JSON.stringify(attackMarker)}\n`
      );
      chmodSync(attackHelper, 0o755);
      const metadataAttack = runCandidateCommand(fixture, [
        "bash",
        "-c",
        [
          "mv .git .git-replaced",
          `git config core.fsmonitor ${JSON.stringify(attackHelper)}`,
          `git config remote.origin.url 'ext::${attackHelper}'`,
        ].join(" || "),
      ]);
      assert.notEqual(metadataAttack.status, 0);
      assert.equal(
        readFileSync(path.join(fixture.candidateRoot, ".git"), "utf8"),
        gitPointerBefore
      );
      assert.equal(
        readFileSync(path.join(fixture.candidateGitDir, "config"), "utf8"),
        gitConfigBefore
      );
      const trustedStatus = spawnSync("git", ["status", "--porcelain=v1"], {
        cwd: fixture.candidateRoot,
        encoding: "utf8",
        env: createTrustedGitEnvironment(process.env),
      });
      assert.equal(trustedStatus.status, 0, trustedStatus.stderr);
      assert.equal(existsSync(attackMarker), false);

      writeFileSync(
        path.join(fixture.candidateRoot, ".pnpmfile.cjs"),
        [
          'const { writeFileSync } = require("node:fs");',
          "module.exports = { hooks: { readPackage(pkg) {",
          "  const denied = [];",
          `  for (const [target, value] of ${JSON.stringify([
            [fixture.trustedMarker, "candidate overwrite\n"],
            [fixture.evidenceMarker, "candidate evidence\n"],
            [
              path.join(fixture.candidateGitDir, "config"),
              "candidate git config\n",
            ],
          ])}) {`,
          `    try { writeFileSync(target, value); } catch (error) { denied.push(\`${TEMPLATE_EXPRESSION_PREFIX}{target}: ${TEMPLATE_EXPRESSION_PREFIX}{error.code}\`); }`,
          "  }",
          `  throw new Error(\`candidate install denied: ${TEMPLATE_EXPRESSION_PREFIX}{denied.join(", ")}\`);`,
          "} } };",
          "",
        ].join("\n")
      );
      const attackedInstall = run(fixture, INSTALL_SCRIPT);
      const attackedOutput = `${attackedInstall.stdout}\n${attackedInstall.stderr}`;
      assert.equal(attackedInstall.error, undefined);
      assert.notEqual(attackedInstall.status, 0);
      assert.equal(
        readFileSync(fixture.trustedMarker, "utf8"),
        "trusted control\n"
      );
      assert.equal(existsSync(fixture.evidenceMarker), false);
      assert.equal(
        readFileSync(path.join(fixture.candidateGitDir, "config"), "utf8"),
        gitConfigBefore
      );
      assert.match(attackedOutput, CANDIDATE_INSTALL_DENIED_PATTERN);
      assert.match(attackedOutput, new RegExp(fixture.trustedMarker, "u"));
      assert.match(attackedOutput, new RegExp(fixture.evidenceMarker, "u"));

      rmSync(path.join(fixture.candidateRoot, ".pnpmfile.cjs"));
      writeFileSync(
        path.join(fixture.candidateRoot, ".npmrc"),
        [
          `store-dir=${path.join(fixture.trustedRoot, "escaped-store")}`,
          `virtual-store-dir=${path.join(fixture.trustedRoot, "escaped-virtual-store")}`,
          `modules-dir=${path.join(fixture.evidenceRoot, "escaped-modules")}`,
          "",
        ].join("\n")
      );
      const configuredInstall = run(fixture, INSTALL_SCRIPT);
      assert.equal(configuredInstall.status, 0, configuredInstall.stderr);
      assert.equal(
        existsSync(path.join(fixture.trustedRoot, "escaped-store")),
        false
      );
      assert.equal(
        existsSync(path.join(fixture.trustedRoot, "escaped-virtual-store")),
        false
      );
      assert.equal(
        existsSync(path.join(fixture.evidenceRoot, "escaped-modules")),
        false
      );
      assert.equal(
        existsSync(path.join(fixture.candidateRoot, "node_modules", ".pnpm")),
        true
      );
      assert.equal(
        existsSync(
          path.join(
            fixture.candidateRoot,
            "node_modules",
            "fixture-dependency",
            "package.json"
          )
        ),
        true,
        `${configuredInstall.stdout}\n${configuredInstall.stderr}`
      );
    } finally {
      fixture.cleanup();
    }
  }
);

test(
  "Linux empty-store install rebuilds and loads the repository-approved better-sqlite3 binary",
  { skip: !supportsHostedLinuxIsolation(), timeout: 180_000 },
  () => {
    const fixture = createLinuxInstallFixture();
    const rootLifecycleMarker = path.join(
      fixture.root,
      "candidate-root-prepare-ran.log"
    );
    try {
      rmSync(path.join(fixture.candidateRoot, "dependency"), {
        force: true,
        recursive: true,
      });
      rmSync(path.join(fixture.candidateRoot, "fixture-dependency-1.0.0.tgz"), {
        force: true,
      });
      rmSync(path.join(fixture.candidateRoot, "pnpm-lock.yaml"), {
        force: true,
      });
      writeFileSync(
        path.join(fixture.trustedRoot, "pnpm-workspace.yaml"),
        readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8")
      );
      writeFileSync(
        path.join(fixture.candidateRoot, "package.json"),
        `${JSON.stringify({
          dependencies: { "better-sqlite3": "12.6.2" },
          private: true,
          scripts: {
            prepare: `node -e "require('node:fs').writeFileSync(${JSON.stringify(
              rootLifecycleMarker
            )}, 'unsafe')"`,
          },
        })}\n`
      );
      const lock = spawnSync(
        "pnpm",
        [
          "--dir",
          fixture.candidateRoot,
          "install",
          "--ignore-scripts",
          "--lockfile-only",
          "--store-dir",
          path.join(fixture.root, "native-lock-store"),
        ],
        { encoding: "utf8", timeout: 120_000 }
      );
      assert.equal(lock.status, 0, lock.stderr);
      rmSync(path.join(fixture.root, "native-lock-store"), {
        force: true,
        recursive: true,
      });

      const prepare = run(fixture, PREPARE_SCRIPT);
      assert.equal(prepare.status, 0, prepare.stderr);
      const install = run(fixture, INSTALL_SCRIPT);
      assert.equal(install.status, 0, install.stderr);
      assert.equal(existsSync(rootLifecycleMarker), false);

      const selectedCheck = runCandidateCommand(fixture, [
        "node",
        "-e",
        "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.exec('select 1'); db.close();",
      ]);
      assert.equal(
        selectedCheck.status,
        0,
        `${install.stdout}\n${install.stderr}\n${selectedCheck.stderr}`
      );
    } finally {
      fixture.cleanup();
    }
  }
);

function supportsHostedLinuxIsolation() {
  if (process.platform !== "linux") {
    return false;
  }
  const pnpmVersion = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  return (
    pnpmVersion.status === 0 &&
    pnpmVersion.stdout.trim() === "10.30.0" &&
    spawnSync("sudo", ["-n", "true"], { stdio: "ignore" }).status === 0
  );
}

function supportsHostedNonRootLinuxIsolation() {
  return supportsHostedLinuxIsolation() && process.getuid?.() !== 0;
}

function createLinuxInstallFixture() {
  const root = mkdtempSync(
    path.join(tmpdir(), "openmeld-linux-candidate-install-")
  );
  chmodSync(root, 0o711);
  const candidateRoot = path.join(root, "untrusted-candidate");
  const candidateHome = path.join(root, "candidate-home");
  const candidateGitDir = path.join(root, "candidate-git");
  const trustedRoot = path.join(root, "trusted-control");
  const trustedScripts = path.join(trustedRoot, "scripts", "ci");
  const evidenceRoot = path.join(root, "evidence");
  const trustedMarker = path.join(trustedRoot, "trusted-runner.mjs");
  const evidenceMarker = path.join(evidenceRoot, "candidate-evidence.json");
  const candidateUser = `omcandidate${String(process.pid)}`;
  mkdirSync(candidateRoot);
  mkdirSync(trustedScripts, { recursive: true });
  for (const script of [
    INSTALL_SCRIPT,
    PREPARE_SCRIPT,
    RESOLVE_APPROVED_BUILDS_SCRIPT,
    WRAPPER_SCRIPT,
  ]) {
    const destination = path.join(trustedScripts, script);
    cpSync(path.join(SCRIPT_DIR, script), destination);
    chmodSync(destination, 0o755);
  }
  writeFileSync(trustedMarker, "trusted control\n");
  writeFileSync(
    path.join(trustedRoot, "pnpm-workspace.yaml"),
    "allowBuilds:\n  fixture-dependency: true\n"
  );
  writeFileSync(
    path.join(trustedRoot, "package.json"),
    '{"packageManager":"pnpm@10.30.0","private":true}\n'
  );
  const dependencyRoot = path.join(candidateRoot, "dependency");
  mkdirSync(dependencyRoot);
  writeFileSync(
    path.join(dependencyRoot, "package.json"),
    `${JSON.stringify({
      name: "fixture-dependency",
      version: "1.0.0",
    })}\n`
  );
  const packedDependency = spawnSync(
    "npm",
    ["pack", dependencyRoot, "--pack-destination", candidateRoot],
    { encoding: "utf8" }
  );
  if (packedDependency.status !== 0) {
    throw new Error(
      `Failed to pack Linux fixture dependency: ${packedDependency.stderr}`
    );
  }
  writeFileSync(
    path.join(candidateRoot, "package.json"),
    '{"private":true,"dependencies":{"fixture-dependency":"file:./fixture-dependency-1.0.0.tgz"}}\n'
  );
  const lock = spawnSync(
    "pnpm",
    [
      "--dir",
      candidateRoot,
      "install",
      "--ignore-scripts",
      "--lockfile-only",
      "--store-dir",
      path.join(root, "fixture-store"),
    ],
    { encoding: "utf8" }
  );
  if (lock.status !== 0) {
    throw new Error(`Failed to create Linux fixture lockfile: ${lock.stderr}`);
  }
  const initializeGit = spawnSync(
    "git",
    ["init", "--quiet", "--initial-branch=main", candidateRoot],
    { encoding: "utf8" }
  );
  if (initializeGit.status !== 0) {
    throw new Error(
      `Failed to initialize candidate Git fixture: ${initializeGit.stderr}`
    );
  }
  const environment = {
    ...process.env,
    OPENMELD_AFFECTED_BASE: "b".repeat(40),
    OPENMELD_CANDIDATE_HOME: candidateHome,
    OPENMELD_CANDIDATE_GIT_DIR: candidateGitDir,
    OPENMELD_CANDIDATE_ROOT: candidateRoot,
    OPENMELD_CANDIDATE_USER: candidateUser,
    OPENMELD_FINAL_CANDIDATE_EVIDENCE_ROOT: evidenceRoot,
    OPENMELD_TRUSTED_CONTROL_ROOT: trustedRoot,
  };
  return {
    candidateHome,
    candidateGitDir,
    candidateRoot,
    cleanup: () => {
      spawnSync("sudo", ["-n", "userdel", "--force", candidateUser], {
        stdio: "ignore",
      });
      spawnSync("sudo", ["-n", "rm", "-rf", root], { stdio: "ignore" });
    },
    environment,
    evidenceMarker,
    evidenceRoot,
    root,
    trustedMarker,
    trustedRoot,
  };
}

function runCandidateCommand(fixture, args) {
  return spawnSync(
    "bash",
    [path.join(fixture.trustedRoot, "scripts", "ci", WRAPPER_SCRIPT), ...args],
    {
      cwd: fixture.candidateRoot,
      encoding: "utf8",
      env: fixture.environment,
    }
  );
}

function run(fixture, script) {
  return spawnSync(
    "bash",
    [path.join(fixture.trustedRoot, "scripts", "ci", script)],
    {
      encoding: "utf8",
      env: fixture.environment,
    }
  );
}
