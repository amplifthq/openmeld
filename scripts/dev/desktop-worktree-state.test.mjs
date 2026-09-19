import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isResourceManagedDesktopCommand } from "./desktop-commands.mjs";
import {
  desktopProcessOwners,
  desktopProcessSnapshot,
  readDesktopRecord,
  writeDesktopRecord,
} from "./desktop-worktree-state.mjs";
import { admissionReason, resourcePolicy } from "./local-resources.mjs";

test("Desktop ownership fences reused PIDs, copied records, and foreign app paths", () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-owner-"));
  try {
    const executable = join(
      root,
      "clients/desktop/dist/development/mac/Owned.app/Contents/MacOS/Owned"
    );
    const owner = {
      pid: 10,
      startedAt: "first",
      parentPid: 1,
      command: "node launcher",
    };
    const child = {
      pid: 11,
      startedAt: "second",
      parentPid: 10,
      command: executable,
    };
    const other = {
      pid: 12,
      startedAt: "third",
      parentPid: 1,
      command: "/other/Electron.app/Contents/MacOS/Electron",
    };
    const rows = [owner, child, other];
    writeDesktopRecord(root, {
      pid: 10,
      startedAt: "first",
      executable,
      phase: "preparing",
    });
    assert.equal(desktopProcessSnapshot(root, rows).phase, "preparing");
    assert.deepEqual(
      desktopProcessSnapshot(root, rows).processes.map((row) => row.pid),
      [10, 11]
    );
    const record = readDesktopRecord(root);
    assert.deepEqual(
      desktopProcessOwners(root, rows, { ...record, repoRoot: "/other" }),
      []
    );
    assert.deepEqual(
      desktopProcessOwners(root, [other], {
        ...record,
        pid: 12,
        startedAt: "reused",
        executable: other.command,
      }),
      []
    );
    assert.deepEqual(
      desktopProcessOwners(root, [child], record).map((row) => row.pid),
      [11]
    );
    writeDesktopRecord(root, {
      ...record,
      pid: null,
      startedAt: null,
      phase: "stopped",
    });
    assert.equal(desktopProcessSnapshot(root, [child]).phase, "running");
    assert.equal(desktopProcessSnapshot(root, []).phase, "stopped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an idle Desktop consumes memory budget, not the heavy-work slot", () => {
  const policy = resourcePolicy({}, 16 * 1024 ** 3);
  const input = {
    kind: "heavy",
    policy,
    rows: [],
    availableBytes: 12 * 1024 ** 3,
    entries: [{ pid: 10, kind: "desktop", bytes: policy.costs.desktop }],
  };
  assert.equal(admissionReason(input), null);
  assert.notEqual(admissionReason({ ...input, availableBytes: 1 }), null);
  assert.notEqual(
    admissionReason({
      ...input,
      entries: [{ pid: 10, kind: "heavy", bytes: policy.costs.heavy }],
    }),
    null
  );
  assert.equal(isResourceManagedDesktopCommand(["pnpm", "desktop:dev"]), true);
  assert.equal(
    isResourceManagedDesktopCommand(["pnpm", "run", "desktop:prepare"]),
    true
  );
  for (const args of [
    ["pnpm", "build"],
    ["pnpm", "--dir", "other", "desktop:dev"],
    ["node", "arbitrary.mjs"],
  ]) {
    assert.equal(isResourceManagedDesktopCommand(args), false);
  }
});
