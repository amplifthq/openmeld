import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import {
  powerShellEncodedArguments,
  readWindowsProcessStartFileTime,
  resolveWindowsPowerShellPath,
} from "../dist/windows-system.js";

const SYSTEM_DIRECTORY_ERROR = /system directory is unavailable/;
const FILETIME_PATTERN = /^\d{10,20}$/u;

test(
  "native Windows process identity remains exact while alive and disappears after exit",
  { skip: process.platform !== "win32" },
  async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore", windowsHide: true }
    );
    try {
      await once(child, "spawn");
      const identity = readWindowsProcessStartFileTime(child.pid);
      assert.match(identity ?? "", FILETIME_PATTERN);
      assert.equal(readWindowsProcessStartFileTime(child.pid), identity);
      assert.match(
        readWindowsProcessStartFileTime(process.pid) ?? "",
        FILETIME_PATTERN
      );
      const exited = once(child, "close");
      child.kill();
      await exited;
      assert.equal(readWindowsProcessStartFileTime(child.pid), null);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    }
  }
);

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
