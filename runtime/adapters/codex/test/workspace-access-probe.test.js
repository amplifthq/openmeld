import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import {
  buildCodexWorkspaceProbeCommand,
  verifyCodexWorkspaceAccess,
} from "../dist/transport/codex-workspace-access-probe.js";

const execute = promisify(execFile);
const ACCESS_UNVERIFIED = /workspace_access_unverified/;
const ENCODED_PATHS_PATTERN = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/u;

it("passes Windows sentinel paths as UTF-8 data to the system PowerShell, not shell source", () => {
  const paths = [
    "C:\\Users\\测试 & %PATH%\\outside'file",
    "D:\\Project with spaces\\inside",
  ];
  const command = buildCodexWorkspaceProbeCommand(...paths, "win32", {
    systemroot: "C:\\Windows",
  });
  assert.equal(
    command[0],
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  );
  assert.equal(command.at(-2), "-EncodedCommand");
  const script = Buffer.from(command.at(-1), "base64").toString("utf16le");
  const payload = script.match(ENCODED_PATHS_PATTERN)?.[1];
  assert.deepEqual(
    JSON.parse(Buffer.from(payload, "base64").toString("utf8")),
    paths
  );
  assert.equal(script.includes(paths[0]), false);
});

it("rejects a runtime that can open a sibling task's files and cleans only its own sentinels", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "openmeld-probe-test-"))
  );
  try {
    await assert.rejects(
      verifyCodexWorkspaceAccess({
        boundary: {
          mode: "only_selected_folders",
          folders: [root],
          revision: 1,
          updatedAtMs: 1,
          executionContextAccess: "workspace",
        },
        workingDirectory: root,
        execute: async ({ command }) => {
          const result = await execute(command[0], command.slice(1));
          // CommandExecResponse from the generated Codex protocol schema.
          return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
        },
      }),
      ACCESS_UNVERIFIED
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it(
  "accepts real OS denial of sibling reads and writes while testing the requested own-folder access",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "openmeld-probe-test-"))
    );
    try {
      for (const [access, executionMode] of [
        ["workspace", "normal"],
        ["read_only", "normal"],
        ["workspace", "repair"],
      ]) {
        await verifyCodexWorkspaceAccess({
          executionMode,
          boundary: {
            mode: "only_selected_folders",
            folders: [root],
            revision: 1,
            updatedAtMs: 1,
            executionContextAccess: access,
          },
          workingDirectory: root,
          execute: async ({ command }) => {
            const outside = command[4];
            const inside = command[5];
            const policy = `(version 1)(allow default)(deny file-read* file-write* (literal ${JSON.stringify(outside)}))${access === "read_only" || executionMode === "repair" ? `(deny file-write* (literal ${JSON.stringify(inside)}))` : ""}`;
            const result = await execute("/usr/bin/sandbox-exec", [
              "-p",
              policy,
              ...command,
            ]);
            return {
              exitCode: 0,
              stdout: result.stdout,
              stderr: result.stderr,
            };
          },
        });
        assert.deepEqual(await readdir(root), []);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
