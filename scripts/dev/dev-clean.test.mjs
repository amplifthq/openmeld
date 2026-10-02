import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertWorktreeRemovable } from "./dev-clean.mjs";
import {
  listWorktreeDevData,
  resolveWorktreeDevHome,
  resolveWorktreeDevServiceCommand,
} from "./dev-service.mjs";

test("cleanup uses the existing lane CLI without requiring a rebuild or falling back to another home", () => {
  const root = mkdtempSync(join(tmpdir(), "dev-stop-cli-"));
  try {
    const home = resolveWorktreeDevHome(root);
    const binary = join(
      home,
      "bin",
      process.platform === "win32" ? "openmeld.exe" : "openmeld"
    );
    assert.throws(() => resolveWorktreeDevServiceCommand(root));
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(binary, "fixture executable");
    chmodSync(binary, 0o700);
    assert.deepEqual(resolveWorktreeDevServiceCommand(root), {
      command: binary,
      args: [],
    });
    // File symlink creation needs additional privileges on Windows; the actual
    // resolver's realpath fence is exercised on macOS/Linux without such privileges.
    if (process.platform !== "win32") {
      rmSync(binary);
      const foreign = join(root, "foreign-cli");
      writeFileSync(foreign, "foreign fixture");
      chmodSync(foreign, 0o700);
      symlinkSync(foreign, binary);
      assert.throws(() => resolveWorktreeDevServiceCommand(root));
    }
    const entry = join(root, "clients/openmeld-cli/dist/openmeld-dev.js");
    mkdirSync(join(root, "clients/openmeld-cli/dist"), { recursive: true });
    writeFileSync(entry, "// repo-local fixture");
    assert.deepEqual(resolveWorktreeDevServiceCommand(root), {
      command: process.execPath,
      args: [entry],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("worktree retirement rejects unmerged, dirty, locked, primary and in-use work", () => {
  const input = {
    target: "/repo/a",
    worktrees: [
      { path: "/repo/main", branch: "refs/heads/main" },
      { path: "/repo/a", branch: "refs/heads/codex/a" },
    ],
    dirty: "",
    merged: true,
    cwdOwners: [],
  };
  assert.doesNotThrow(() => assertWorktreeRemovable(input));
  for (const patch of [
    { merged: false },
    { dirty: "?? notes.txt" },
    { cwdOwners: [42] },
    { target: "/repo/main" },
    { target: "/unknown" },
    {
      worktrees: [input.worktrees[0], { ...input.worktrees[1], locked: true }],
    },
  ]) {
    assert.throws(() => assertWorktreeRemovable({ ...input, ...patch }));
  }
});

test("cleanup paths belong only to the selected worktree", () => {
  const a = listWorktreeDevData("/repo/a");
  const b = listWorktreeDevData("/repo/b");
  assert.equal(
    a.every((path) => path.startsWith("/repo/a/")),
    true
  );
  assert.equal(
    a.some((path) => b.includes(path)),
    false
  );
  assert.equal(resolveWorktreeDevHome("/repo/a").startsWith(`${a[0]}/`), true);
});
