import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  execPlatformFile,
  quoteWindowsProcessArgument,
  resolvePlatformCommand,
} from "../dist/process-launch.js";

const execute = promisify(execPlatformFile);
const NULL_BYTE_ERROR = /null byte/;
const MULTILINE_BATCH_ERROR = /cannot preserve multiline/;
const payload = [
  "spaces and 测试",
  'a"quote',
  "ends\\",
  "%PATH%",
  "a&b|c",
  "!bang!",
  "^caret",
  "",
  "first\nsecond",
];

// Captured npm/cmd-shim Node wrapper grammar; the bin target is the fixture only.
function npmNodeShim(target) {
  return [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\${target}" %*`,
    "",
  ].join("\r\n");
}

test("execPlatformFile preserves native argv and the promisified stdout/stderr contract", async () => {
  const result = await execute(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1))); process.stderr.write('diagnostic')",
      ...payload,
    ],
    { timeout: 5000 }
  );
  assert.deepEqual(JSON.parse(result.stdout), payload);
  assert.equal(result.stderr, "diagnostic");
});

test("execPlatformFile retains a native nonzero exit and bounded diagnostic streams", async () => {
  await assert.rejects(
    execute(
      process.execPath,
      ["-e", "console.log('out'); console.error('err'); process.exit(7)"],
      { timeout: 5000 }
    ),
    (error) =>
      error.code === 7 &&
      error.stdout.trim() === "out" &&
      error.stderr.trim() === "err"
  );
});

test("Windows CRT quoting preserves trailing slashes, empty strings and embedded quotes", () => {
  assert.equal(quoteWindowsProcessArgument(""), '""');
  assert.equal(quoteWindowsProcessArgument("C:\\folder\\"), '"C:\\folder\\\\"');
  assert.equal(quoteWindowsProcessArgument('a\\"b'), '"a\\\\\\"b"');
  assert.throws(() => quoteWindowsProcessArgument("a\0b"), NULL_BYTE_ERROR);
});

test("recognizes only an intact npm Node shim and keeps multiline argv outside cmd.exe", async () => {
  const root = await mkdtemp(join(tmpdir(), "openmeld-command-"));
  try {
    const shim = join(root, "agent.cmd");
    await writeFile(join(root, "node.exe"), "fixture");
    await writeFile(shim, npmNodeShim("entry.cjs"));
    const invocation = resolvePlatformCommand(shim, payload, {}, "win32");
    assert.equal(invocation.bin, join(root, "node.exe"));
    assert.deepEqual(invocation.args, [join(root, "entry.cjs"), ...payload]);
    assert.equal(invocation.windowsVerbatimArguments, undefined);
    await writeFile(shim, `${npmNodeShim("entry.cjs")}echo customized\r\n`);
    assert.throws(
      () =>
        resolvePlatformCommand(
          shim,
          payload,
          { SystemRoot: "C:\\Windows" },
          "win32"
        ),
      MULTILINE_BATCH_ERROR
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "native Windows npm shim and JS entry preserve the exact special-character argv",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "OpenMeld 测试 & %PATH% "));
    try {
      const script = join(root, "capture.cjs");
      const shim = join(root, "capture.cmd");
      await writeFile(
        script,
        "process.stdout.write(JSON.stringify(process.argv.slice(2)))"
      );
      await writeFile(shim, npmNodeShim("capture.cjs"));
      for (const command of [script, shim]) {
        const result = await execute(command, payload, { timeout: 5000 });
        assert.deepEqual(JSON.parse(result.stdout), payload);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "native Windows custom batch wrappers receive escaped arguments, not executable operators",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "OpenMeld batch 测试 "));
    try {
      const script = join(root, "capture.cjs");
      const shim = join(root, "custom.cmd");
      await writeFile(
        script,
        "process.stdout.write(JSON.stringify(process.argv.slice(2)))"
      );
      await writeFile(
        shim,
        `@echo off\r\n"${process.execPath}" "%~dp0capture.cjs" %*\r\n`
      );
      const args = payload.filter((value) => !value.includes("\n"));
      const result = await execute(shim, args, { timeout: 5000 });
      assert.deepEqual(JSON.parse(result.stdout), args);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
