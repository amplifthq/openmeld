import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { refreshCursorPersistedLaunchContract } from "../dist/index.js";

const CONFIGURED_CURSOR_NOT_LAUNCHABLE_PATTERN =
  /configured Cursor CLI command is not launchable/i;

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
      "#!/usr/bin/env bash\necho 2026.08.04-new\n",
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
