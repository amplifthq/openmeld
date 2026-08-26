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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const INSTALL_SCRIPT = "install-isolated-candidate-dependencies.sh";
const RESOLVE_APPROVED_BUILDS_SCRIPT = "resolve-approved-native-builds.mjs";
const WRAPPER_SCRIPT = "run-isolated-candidate-command.sh";

test(
  "candidate commands receive no GitHub credentials or Actions command files",
  { skip: !supportsLinuxCandidateInstall() },
  () => {
    const fixture = createLinuxInstallFixture();
    try {
      fixture.environment.GH_TOKEN = "must-not-reach-candidate";
      fixture.environment.GITHUB_ENV = "/tmp/must-not-reach-candidate-env";
      fixture.environment.GITHUB_OUTPUT =
        "/tmp/must-not-reach-candidate-output";
      fixture.environment.GITHUB_TOKEN = "must-not-reach-candidate";
      const probe = runCandidateCommand(fixture, [
        "node",
        "-e",
        "process.stdout.write(JSON.stringify({GH_TOKEN:process.env.GH_TOKEN??null,GITHUB_ENV:process.env.GITHUB_ENV??null,GITHUB_OUTPUT:process.env.GITHUB_OUTPUT??null,GITHUB_TOKEN:process.env.GITHUB_TOKEN??null}))",
      ]);

      assert.equal(probe.status, 0, probe.stderr);
      assert.equal(
        probe.stdout,
        '{"GH_TOKEN":null,"GITHUB_ENV":null,"GITHUB_OUTPUT":null,"GITHUB_TOKEN":null}'
      );
    } finally {
      fixture.cleanup();
    }
  }
);

test(
  "Linux candidate install ignores repository hooks and external store config",
  { skip: !supportsLinuxCandidateInstall() },
  () => {
    const fixture = createLinuxInstallFixture();
    try {
      writeFileSync(
        path.join(fixture.candidateRoot, ".pnpmfile.cjs"),
        [
          'const { writeFileSync } = require("node:fs");',
          "module.exports = { hooks: { readPackage(pkg) {",
          `  writeFileSync(${JSON.stringify(fixture.hookMarker)}, "candidate hook ran\\n");`,
          "  return pkg;",
          "  }",
          "} };",
          "",
        ].join("\n")
      );
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
      assert.equal(existsSync(fixture.hookMarker), false);
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
  { skip: !supportsLinuxCandidateInstall(), timeout: 180_000 },
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

function supportsLinuxCandidateInstall() {
  if (process.platform !== "linux") {
    return false;
  }
  const pnpmVersion = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  return pnpmVersion.status === 0 && pnpmVersion.stdout.trim() === "10.30.0";
}

function createLinuxInstallFixture() {
  const root = mkdtempSync(
    path.join(tmpdir(), "openmeld-linux-candidate-install-")
  );
  chmodSync(root, 0o711);
  const candidateRoot = path.join(root, "untrusted-candidate");
  const candidateHome = path.join(root, "candidate-home");
  const trustedRoot = path.join(root, "trusted-control");
  const trustedScripts = path.join(trustedRoot, "scripts", "ci");
  const evidenceRoot = path.join(root, "evidence");
  const hookMarker = path.join(root, "candidate-pnpm-hook-ran.log");
  mkdirSync(candidateRoot);
  mkdirSync(trustedScripts, { recursive: true });
  for (const script of [
    INSTALL_SCRIPT,
    RESOLVE_APPROVED_BUILDS_SCRIPT,
    WRAPPER_SCRIPT,
  ]) {
    const destination = path.join(trustedScripts, script);
    cpSync(path.join(SCRIPT_DIR, script), destination);
    chmodSync(destination, 0o755);
  }
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
  const environment = {
    ...process.env,
    OPENMELD_AFFECTED_BASE: "b".repeat(40),
    OPENMELD_CANDIDATE_HOME: candidateHome,
    OPENMELD_CANDIDATE_ROOT: candidateRoot,
    OPENMELD_TRUSTED_CONTROL_ROOT: trustedRoot,
  };
  return {
    candidateHome,
    candidateRoot,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    environment,
    evidenceRoot,
    hookMarker,
    root,
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
