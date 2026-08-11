import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const EXECUTABLE_SEARCH_ENV_KEYS = [
  "BUN_INSTALL",
  "FNM_DIR",
  "NPM_CONFIG_PREFIX",
  "NVM_DIR",
  "PNPM_HOME",
  "SHELL",
  "VOLTA_HOME",
  "OPENMELD_DAEMON_RUNTIME_CODEX_BIN",
  "OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS",
];

test("Codex install discovery finds the bundled Codex.app binary outside degraded PATH", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-codex-app-"));
  const codexAppResourcesDir = join(
    fixtureDir,
    "Applications",
    "Codex.app",
    "Contents",
    "Resources"
  );
  const codexAppCommandPath = join(codexAppResourcesDir, "codex");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(codexAppResourcesDir, { recursive: true });
  await writeFile(
    codexAppCommandPath,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.142.5"; exit 0; fi\nexit 0\n',
    "utf8"
  );
  await chmod(codexAppCommandPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.BUN_INSTALL = join(fixtureDir, ".bun");
    process.env.FNM_DIR = join(fixtureDir, ".fnm");
    process.env.NPM_CONFIG_PREFIX = join(fixtureDir, ".npm-global");
    process.env.NVM_DIR = join(fixtureDir, ".nvm");
    process.env.PNPM_HOME = join(fixtureDir, ".local", "share", "pnpm");
    process.env.SHELL = "/bin/false";
    process.env.VOLTA_HOME = join(fixtureDir, ".volta");
    process.env.OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS = "100";
    Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_CODEX_BIN");

    const { resolveInstalledCodexLaunchCandidates } = await import(
      "../dist/index.js"
    );
    const resolution = await resolveInstalledCodexLaunchCandidates({
      timeoutMs: 1000,
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected bundled Codex.app binary to resolve");
    }
    assert.equal(
      resolution.candidates.some(
        (candidate) => candidate.commandPath === codexAppCommandPath
      ),
      true
    );
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

function snapshotEnvVars(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvVars(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    restoreOptionalEnvVar(name, value);
  }
}

function restoreOptionalEnvVar(name, originalValue) {
  if (originalValue === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = originalValue;
}
