import assert from "node:assert/strict";
import test from "node:test";
import { readProcessRows } from "./process-rows.mjs";

test("reads POSIX process rows from ps output", () => {
  const rows = readProcessRows({
    repoRoot: "/repo",
    platform: "linux",
    spawnSyncImpl: () => ({
      status: 0,
      stdout:
        "123 1 /usr/bin/node worker.js\n456 123 wrangler dev /repo/services/core/\n",
      stderr: "",
    }),
  });

  assert.deepEqual(rows, [
    { pid: 123, parentPid: 1, command: "/usr/bin/node worker.js" },
    {
      pid: 456,
      parentPid: 123,
      command: "wrangler dev /repo/services/core/",
    },
  ]);
});

test("falls back to PowerShell process discovery on Windows", () => {
  const calls = [];
  const rows = readProcessRows({
    repoRoot: "C:/repo",
    platform: "win32",
    spawnSyncImpl: (command) => {
      calls.push(command);
      if (command === "powershell.exe") {
        return {
          status: null,
          stdout: "",
          stderr: "",
          error: Object.assign(new Error("missing"), { code: "ENOENT" }),
        };
      }

      return {
        status: 0,
        stdout:
          '[{"pid":101,"parentPid":1,"command":"node C:/repo/scripts/dev/dev-guard.mjs"},{"pid":102,"parentPid":101,"command":"wrangler dev C:/repo/services/core/"}]',
        stderr: "",
      };
    },
  });

  assert.deepEqual(calls, ["powershell.exe", "pwsh"]);
  assert.deepEqual(rows, [
    {
      pid: 101,
      parentPid: 1,
      command: "node C:/repo/scripts/dev/dev-guard.mjs",
    },
    {
      pid: 102,
      parentPid: 101,
      command: "wrangler dev C:/repo/services/core/",
    },
  ]);
});

test("skips Windows records without a usable command line", () => {
  const rows = readProcessRows({
    repoRoot: "C:/repo",
    platform: "win32",
    spawnSyncImpl: () => ({
      status: 0,
      stdout:
        '[{"pid":101,"parentPid":1,"command":"node C:/repo/scripts/dev/dev-guard.mjs"},{"pid":102,"parentPid":1,"command":null},{"pid":103,"parentPid":1,"command":"   "}]',
      stderr: "",
    }),
  });

  assert.deepEqual(rows, [
    {
      pid: 101,
      parentPid: 1,
      command: "node C:/repo/scripts/dev/dev-guard.mjs",
    },
  ]);
});
