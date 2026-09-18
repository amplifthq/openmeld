import assert from "node:assert/strict";
import test from "node:test";
import {
  powerShellEncodedArguments,
  resolveWindowsPowerShellPath,
} from "../dist/windows-system.js";

const SYSTEM_DIRECTORY_ERROR = /system directory is unavailable/;

test("resolves the actual Windows system shell without relying on PATH spelling", () => {
  assert.equal(
    resolveWindowsPowerShellPath({ SYSTEMROOT: "D:\\Windows" }),
    "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  );
  assert.equal(
    resolveWindowsPowerShellPath({ WINDIR: "C:\\Windows" }),
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  );
  assert.throws(
    () => resolveWindowsPowerShellPath({ SystemRoot: "relative" }),
    SYSTEM_DIRECTORY_ERROR
  );
  assert.throws(() => resolveWindowsPowerShellPath({}), SYSTEM_DIRECTORY_ERROR);
});

test("encodes PowerShell source as UTF-16LE without enabling profiles or global policy changes", () => {
  const source = "[Console]::Write('测试')";
  const args = powerShellEncodedArguments(source);
  assert.deepEqual(args.slice(0, -1), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
  ]);
  assert.equal(Buffer.from(args.at(-1), "base64").toString("utf16le"), source);
});
