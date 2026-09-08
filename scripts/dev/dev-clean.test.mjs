import assert from "node:assert/strict";
import test from "node:test";
import { assertWorktreeRemovable } from "./dev-clean.mjs";
import { listWorktreeDevData, resolveWorktreeDevHome } from "./dev-service.mjs";

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
