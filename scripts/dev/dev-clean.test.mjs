import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertNoNestedWorktrees,
  assertWorktreeRemovable,
} from "./dev-clean.mjs";
import {
  listWorktreeDevData,
  resolveWorktreeDevHome,
  resolveWorktreeDevServiceCommand,
} from "./dev-service.mjs";

const NESTED_WORKTREE_ERROR = /registered nested worktrees/u;

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
    {
      worktrees: [
        ...input.worktrees,
        { path: "/repo/a/dev-tmp/nested", locked: true },
      ],
    },
  ]) {
    assert.throws(() => assertWorktreeRemovable({ ...input, ...patch }));
  }
});

test("clean and removal preserve nested registered checkouts before touching lane data", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dev-clean-nested-")));
  const primary = join(root, "primary");
  const parent = join(root, "parent");
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  try {
    mkdirSync(primary);
    git(primary, "init", "-b", "main");
    git(primary, "config", "user.name", "Cleanup fixture");
    git(primary, "config", "user.email", "fixture@example.invalid");
    writeFileSync(
      join(primary, ".gitignore"),
      "dev-tmp/\n.turbo/\nlocal-only.txt\n"
    );
    git(primary, "add", ".gitignore");
    git(primary, "commit", "-m", "chore: create disposable fixture");
    git(primary, "worktree", "add", "-b", "codex/parent", parent);
    const roots = [
      join(parent, "dev-tmp", "nested"),
      join(listWorktreeDevData(parent)[0], "nested"),
    ];
    for (const [index, nested] of roots.entries()) {
      git(primary, "worktree", "add", "-b", `codex/child-${index}`, nested);
      writeFileSync(join(nested, "local-only.txt"), `retained ${index}`);
    }
    assert.equal(
      git(parent, "status", "--porcelain", "--untracked-files=all").trim(),
      ""
    );
    for (const args of [[], ["--remove-worktree"]]) {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("./dev-clean.mjs", import.meta.url)),
          "--worktree",
          parent,
          ...args,
        ],
        { encoding: "utf8" }
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, NESTED_WORKTREE_ERROR);
      for (const [index, nested] of roots.entries()) {
        assert.equal(
          readFileSync(join(nested, "local-only.txt"), "utf8"),
          `retained ${index}`
        );
      }
    }
    assert.doesNotThrow(() =>
      assertNoNestedWorktrees({
        target: parent,
        paths: listWorktreeDevData(parent),
        worktrees: [
          { path: parent },
          { path: roots[0] },
          { path: `${parent}-sibling` },
        ],
      })
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
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
