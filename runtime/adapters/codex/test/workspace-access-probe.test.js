import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import { verifyCodexWorkspaceAccess } from "../dist/transport/codex-workspace-access-probe.js";

const execute = promisify(execFile);
const ACCESS_UNVERIFIED = /workspace_access_unverified/;

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
