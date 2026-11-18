import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  refreshCursorPersistedLaunchContract,
  runCursorCliProbe,
  verifyCursorLaunchContract,
} from "../dist/index.js";

const CONFIGURED_CURSOR_NOT_LAUNCHABLE_PATTERN =
  /configured Cursor CLI command is not launchable/i;

test(
  "a probe that cannot allocate stdio reports an incomplete check and leaves the caller running",
  {
    skip: process.platform === "win32",
  },
  () => {
    const script = `
    import assert from "node:assert/strict";
    import { openSync, closeSync } from "node:fs";
    import { runCursorCliProbe } from "./dist/index.js";
    const fds = [];
    try {
      while (true) fds.push(openSync("/dev/null", "r"));
    } catch (error) {
      assert.equal(error.code, "EMFILE");
    }
    const probe = runCursorCliProbe({ command: "version", cwd: process.cwd(),
      launchContract: { kind: "executable", commandPath: process.execPath }, timeoutMs: 2000 });
    for (const fd of fds) closeSync(fd);
    const result = await probe;
    assert.equal(result.failureKind, "incomplete_check");
    assert.match(result.errorMessage, /EMFILE/);
  `;
    const child = spawnSync(
      "/bin/sh",
      ["-c", "ulimit -n 64 && exec node --input-type=module -"],
      {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, PATH: dirname(process.execPath) },
        input: script,
        timeout: 10_000,
      }
    );
    assert.equal(child.status, 0, child.stderr);
  }
);

test(
  "macOS protects Keychain files even for Cursor builds that ignore the store setting",
  {
    skip: process.platform !== "darwin",
  },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "cursor-legacy-probe-"));
    try {
      const keychains = join(home, "Library", "Keychains");
      await mkdir(keychains, { recursive: true });
      const canary = join(keychains, "fixture");
      await writeFile(canary, "fixture");
      const script = join(home, "cursor-agent");
      await writeFile(
        script,
        [
          "#!/bin/sh",
          'if cat "$1" >/dev/null 2>&1; then echo interactive; exit 1; fi',
          'if [ "$2" = "--version" ]; then echo fixture-version; else echo fixture-status; fi',
        ].join("\n"),
        { mode: 0o700 }
      );
      const launchContract = {
        kind: "executable",
        commandPath: script,
        argsPrefix: [canary],
      };
      for (const command of ["version", "status"]) {
        const result = await runCursorCliProbe({
          command,
          cwd: home,
          launchContract,
          timeoutMs: 5000,
        });
        assert.deepEqual(result, { ok: true, stdout: `fixture-${command}\n` });
      }
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  }
);

test("refreshCursorPersistedLaunchContract follows the stable managed Cursor entrypoint", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "cursor-managed-update-"));
  const stableBinDir = join(fixtureDir, ".local", "bin");
  const versionsDir = join(
    fixtureDir,
    ".local",
    "share",
    "cursor-agent",
    "versions"
  );
  const oldScriptPath = join(versionsDir, "2026.07.16-old", "cursor-agent");
  const newScriptPath = join(versionsDir, "2026.08.04-new", "cursor-agent");
  const stableCommandPath = join(stableBinDir, "cursor-agent");
  const originalCursorBin = process.env.OPENMELD_DAEMON_RUNTIME_CURSOR_BIN;
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;

  await Promise.all([
    mkdir(stableBinDir, { recursive: true }),
    mkdir(join(versionsDir, "2026.07.16-old"), { recursive: true }),
    mkdir(join(versionsDir, "2026.08.04-new"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      oldScriptPath,
      "#!/usr/bin/env bash\necho 2026.07.16-old\n",
      "utf8"
    ),
    writeFile(
      newScriptPath,
      '#!/usr/bin/env bash\nif [ "$AGENT_CLI_CREDENTIAL_STORE" != "memory" ]; then exit 1; fi\necho 2026.08.04-new\n',
      "utf8"
    ),
  ]);
  await Promise.all([chmod(oldScriptPath, 0o755), chmod(newScriptPath, 0o755)]);
  await symlink(newScriptPath, stableCommandPath);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    restoreOptionalEnv("OPENMELD_DAEMON_RUNTIME_CURSOR_BIN", undefined);

    const refreshed = await refreshCursorPersistedLaunchContract({
      launchContract: {
        kind: "node_script",
        nodePath: "/usr/bin/env",
        scriptPath: oldScriptPath,
      },
    });

    assert.deepEqual(refreshed, {
      kind: "node_script",
      nodePath: "/usr/bin/env",
      scriptPath: stableCommandPath,
    });
    const verification = await verifyCursorLaunchContract({
      launchContract: refreshed,
    });
    assert.equal(verification.ok, true, verification.errorMessage);
  } finally {
    restoreOptionalEnv("HOME", originalHome);
    restoreOptionalEnv("PATH", originalPath);
    restoreOptionalEnv("OPENMELD_DAEMON_RUNTIME_CURSOR_BIN", originalCursorBin);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("refreshCursorPersistedLaunchContract follows the current explicitly configured Cursor path", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "cursor-explicit-path-"));
  const oldScriptPath = join(fixtureDir, "old-cursor-agent");
  const newScriptPath = join(fixtureDir, "new-cursor-agent");
  const originalCursorBin = process.env.OPENMELD_DAEMON_RUNTIME_CURSOR_BIN;

  await Promise.all([
    writeFile(oldScriptPath, "#!/usr/bin/env bash\necho old\n", "utf8"),
    writeFile(newScriptPath, "#!/usr/bin/env bash\necho new\n", "utf8"),
  ]);
  await Promise.all([chmod(oldScriptPath, 0o755), chmod(newScriptPath, 0o755)]);

  try {
    process.env.OPENMELD_DAEMON_RUNTIME_CURSOR_BIN = newScriptPath;
    assert.deepEqual(
      await refreshCursorPersistedLaunchContract({
        launchContract: {
          kind: "node_script",
          nodePath: "/usr/bin/env",
          scriptPath: oldScriptPath,
        },
      }),
      {
        kind: "node_script",
        nodePath: "/usr/bin/env",
        scriptPath: newScriptPath,
      }
    );
  } finally {
    restoreOptionalEnv("OPENMELD_DAEMON_RUNTIME_CURSOR_BIN", originalCursorBin);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("refreshCursorPersistedLaunchContract rejects an invalid explicit Cursor path instead of using the old contract", async () => {
  const originalCursorBin = process.env.OPENMELD_DAEMON_RUNTIME_CURSOR_BIN;

  try {
    process.env.OPENMELD_DAEMON_RUNTIME_CURSOR_BIN =
      "/missing/current-cursor-agent";
    await assert.rejects(
      refreshCursorPersistedLaunchContract({
        launchContract: {
          kind: "node_script",
          nodePath: "/usr/bin/env",
          scriptPath: "/still-working/old-cursor-agent",
        },
      }),
      CONFIGURED_CURSOR_NOT_LAUNCHABLE_PATTERN
    );
  } finally {
    restoreOptionalEnv("OPENMELD_DAEMON_RUNTIME_CURSOR_BIN", originalCursorBin);
  }
});

function restoreOptionalEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
