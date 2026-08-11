import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertFileExists,
  buildPosixWrapper,
  buildWindowsWrapper,
  writeShortcutFileAtomically,
} from "./shortcut-helpers.mjs";

const MISSING_FILE_RE = /not found/;

test("assertFileExists waits briefly for install-created files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmeld-shortcut-helper-"));
  const entryPath = join(dir, "dist", "openmeld.js");
  await mkdir(join(dir, "dist"), { recursive: true });
  const timer = setTimeout(() => {
    writeFile(entryPath, "console.log('ok')").catch(() => {
      // The temp directory may be removed if the assertion finishes first.
    });
  }, 20);

  try {
    await assertFileExists(entryPath, "delayed CLI entry", {
      timeoutMs: 500,
    });
  } finally {
    clearTimeout(timer);
    await rm(dir, { force: true, recursive: true });
  }
});

test("assertFileExists still fails when the file never appears", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmeld-shortcut-helper-"));
  try {
    await assert.rejects(
      () =>
        assertFileExists(join(dir, "missing.js"), "missing CLI entry", {
          timeoutMs: 1,
        }),
      MISSING_FILE_RE
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("writeShortcutFileAtomically replaces an existing executable with a fresh file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openmeld-shortcut-helper-"));
  const wrapperPath = join(dir, "openmeld-canary");
  try {
    await writeFile(wrapperPath, "#!/usr/bin/env sh\necho old\n", {
      encoding: "utf8",
      mode: 0o755,
    });
    const before = await stat(wrapperPath);

    await writeShortcutFileAtomically(
      wrapperPath,
      "#!/usr/bin/env sh\necho new\n",
      { executable: true }
    );

    const after = await stat(wrapperPath);
    assert.notEqual(after.ino, before.ino);
    // biome-ignore lint/suspicious/noBitwiseOperators: File mode checks are bit masks.
    assert.equal(after.mode & 0o111, 0o111);
    assert.equal(
      await readFile(wrapperPath, "utf8"),
      "#!/usr/bin/env sh\necho new\n"
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("buildPosixWrapper checks repo-local CLI freshness before executing dist", () => {
  const wrapper = buildPosixWrapper({
    cliEntryPath: "/repo/clients/openmeld-cli/dist/openmeld-dev.js",
    commandName: "openmeld-dev",
    envPreset: "dev-local",
    freshnessCheck: {
      buildCommand: "pnpm --filter openmeld build",
      checkerPath: "/repo/scripts/dev/check-cli-entry-freshness.mjs",
      cliEntryPath: "/repo/clients/openmeld-cli/dist/openmeld-dev.js",
      sourcePaths: ["/repo/clients/openmeld-cli/src"],
    },
    userFacingCommand: "openmeld-dev",
  });

  assert.ok(wrapper.includes("check-cli-entry-freshness.mjs"));
  assert.ok(wrapper.includes("pnpm --filter openmeld build"));
  assert.ok(
    wrapper.includes(
      "exec node '/repo/clients/openmeld-cli/dist/openmeld-dev.js'"
    )
  );
});

test("buildWindowsWrapper checks repo-local CLI freshness before executing dist", () => {
  const wrapper = buildWindowsWrapper({
    cliEntryPath: "C:\\repo\\clients\\openmeld-cli\\dist\\openmeld-dev.js",
    commandName: "openmeld-dev",
    envPreset: "dev-local",
    freshnessCheck: {
      buildCommand: "pnpm --filter openmeld build",
      checkerPath: "C:\\repo\\scripts\\dev\\check-cli-entry-freshness.mjs",
      cliEntryPath: "C:\\repo\\clients\\openmeld-cli\\dist\\openmeld-dev.js",
      sourcePaths: ["C:\\repo\\clients\\openmeld-cli\\src"],
    },
    userFacingCommand: "openmeld-dev",
  });

  assert.ok(wrapper.includes("check-cli-entry-freshness.mjs"));
  assert.ok(wrapper.includes("pnpm --filter openmeld build"));
  assert.ok(
    wrapper.includes(
      'node "C:\\repo\\clients\\openmeld-cli\\dist\\openmeld-dev.js" %*'
    )
  );
});
