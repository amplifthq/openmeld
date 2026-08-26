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
const INSTALL_SCRIPT = "install-isolated-candidate-dependencies.sh";
const PREPARE_SCRIPT = "prepare-isolated-candidate.sh";
const WRAPPER_SCRIPT = "run-isolated-candidate-command.sh";
const CANDIDATE_INSTALL_DENIED_PATTERN = /candidate install denied/u;
const TEMPLATE_EXPRESSION_PREFIX = "$";

test(
  "Linux candidate install cannot escape through pnpm hooks or external store config",
  { skip: !supportsHostedLinuxIsolation() },
  () => {
    const fixture = createLinuxInstallFixture();
    try {
      const prepare = run(fixture, PREPARE_SCRIPT);
      assert.equal(prepare.status, 0, prepare.stderr);

      writeFileSync(
        path.join(fixture.candidateRoot, ".pnpmfile.cjs"),
        [
          'const { writeFileSync } = require("node:fs");',
          "module.exports = { hooks: { readPackage(pkg) {",
          "  const denied = [];",
          `  for (const [target, value] of ${JSON.stringify([
            [fixture.trustedMarker, "candidate overwrite\n"],
            [fixture.evidenceMarker, "candidate evidence\n"],
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
  const trustedMarker = path.join(trustedRoot, "trusted-runner.mjs");
  const evidenceMarker = path.join(evidenceRoot, "candidate-evidence.json");
  const candidateUser = `omcandidate${String(process.pid)}`;
  mkdirSync(candidateRoot);
  mkdirSync(trustedScripts, { recursive: true });
  for (const script of [INSTALL_SCRIPT, PREPARE_SCRIPT, WRAPPER_SCRIPT]) {
    const destination = path.join(trustedScripts, script);
    cpSync(path.join(SCRIPT_DIR, script), destination);
    chmodSync(destination, 0o755);
  }
  writeFileSync(trustedMarker, "trusted control\n");
  const dependencyRoot = path.join(candidateRoot, "dependency");
  mkdirSync(dependencyRoot);
  writeFileSync(
    path.join(dependencyRoot, "package.json"),
    '{"name":"fixture-dependency","version":"1.0.0"}\n'
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
    OPENMELD_CANDIDATE_USER: candidateUser,
    OPENMELD_FINAL_CANDIDATE_EVIDENCE_ROOT: evidenceRoot,
    OPENMELD_TRUSTED_CONTROL_ROOT: trustedRoot,
  };
  return {
    candidateHome,
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
    trustedMarker,
    trustedRoot,
  };
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
