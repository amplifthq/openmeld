#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoSymlinkAncestors,
  listWorktreeDevData,
  manageWorktreeDevService,
} from "./dev-service.mjs";

const entry = fileURLToPath(import.meta.url);
const WORKTREE_PATH = /^worktree (.+)$/mu;
const WORKTREE_BRANCH = /^branch (.+)$/mu;
const WORKTREE_LOCKED = /^locked(?: |$)/mu;

export function assertWorktreeRemovable({
  target,
  worktrees,
  dirty,
  merged,
  cwdOwners,
}) {
  const worktree = worktrees.find((item) => item.path === target);
  if (
    !worktree ||
    worktrees[0]?.path === target ||
    worktree.locked ||
    worktree.branch === "refs/heads/main"
  ) {
    throw new Error(
      "Only a registered, unlocked, non-primary development worktree can be removed."
    );
  }
  if (dirty.trim()) {
    throw new Error(
      "Worktree has uncommitted files. Save the work before removing it."
    );
  }
  if (!merged) {
    throw new Error(
      "Worktree HEAD is not contained in origin/main. Keep it until the work is merged."
    );
  }
  if (cwdOwners.length) {
    throw new Error(
      `Worktree is still in use by processes: ${cwdOwners.join(", ")}. Close their sessions first.`
    );
  }
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function inspectRemoval(target) {
  const worktrees = git(target, ["worktree", "list", "--porcelain"])
    .split("\n\n")
    .map((block) => ({
      path: block.match(WORKTREE_PATH)?.[1],
      branch: block.match(WORKTREE_BRANCH)?.[1],
      locked: WORKTREE_LOCKED.test(block),
    }));
  let merged = false;
  try {
    git(target, ["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
    merged = true;
  } catch {
    // Missing refs and unmerged commits both prohibit removal.
  }
  if (process.platform === "win32") {
    throw new Error(
      "Automatic worktree removal requires a verified process working-directory inventory on this platform. The stopped worktree was preserved."
    );
  }
  const output = execFileSync("lsof", ["-nP", "-d", "cwd", "-F", "pn"], {
    encoding: "utf8",
  });
  const cwdOwners = [];
  let pid;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    }
    if (
      line.startsWith("n") &&
      pid !== process.pid &&
      (line.slice(1) === target || line.slice(1).startsWith(target + sep))
    ) {
      cwdOwners.push(pid);
    }
  }
  assertWorktreeRemovable({
    target,
    worktrees,
    dirty: git(target, ["status", "--porcelain", "--untracked-files=all"]),
    merged,
    cwdOwners,
  });
  return worktrees[0].path;
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--worktree") {
      if (!args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error("--worktree requires a path.");
      }
      index += 1;
    } else if (
      !["--dry-run", "--remove-worktree", "--help"].includes(args[index])
    ) {
      throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  if (args.includes("--help")) {
    console.log(
      "pnpm dev:clean -- [--dry-run] [--worktree <absolute-path>] [--remove-worktree]\nStops and uninstalls this environment's Service, stops its dev servers, then deletes disposable lane data. Worktree removal additionally requires merged, clean, unused work."
    );
    return;
  }
  const targetIndex = args.indexOf("--worktree");
  const target = resolve(
    targetIndex >= 0 ? args[targetIndex + 1] : `${dirname(entry)}/../..`
  );
  if (git(target, ["rev-parse", "--show-toplevel"]) !== target) {
    throw new Error("Target must be an exact Git worktree root.");
  }
  const dryRun = args.includes("--dry-run");
  const removeWorktree = args.includes("--remove-worktree");
  const paths = listWorktreeDevData(target);
  for (const path of paths) {
    assertNoSymlinkAncestors(path, target);
  }
  console.log(
    `[dev-clean] Worktree: ${target}\n[dev-clean] Disposable data: ${paths.join(", ")}`
  );
  if (dryRun) {
    manageWorktreeDevService(target, { clean: true, dryRun });
    console.log(
      `[dev-clean] No changes made. Worktree removal: ${removeWorktree ? "requested; eligibility rechecked after stop" : "not requested"}.`
    );
    return;
  }
  manageWorktreeDevService(target, { clean: true });
  execFileSync(
    process.execPath,
    [resolve(target, "scripts/dev/dev-stop.mjs")],
    { cwd: target, stdio: "inherit" }
  );
  // Check eligibility before deleting data, and again immediately before Git
  // removal. An open review or shared acceptance dependency is the caller's
  // explicit retention decision; the tool cannot infer it from inactivity.
  if (removeWorktree) {
    inspectRemoval(target);
  }
  for (const path of paths) {
    assertNoSymlinkAncestors(path, target);
    rmSync(path, { recursive: true, force: true });
  }
  if (removeWorktree) {
    const primary = inspectRemoval(target);
    execFileSync("git", ["worktree", "remove", target], {
      cwd: primary,
      stdio: "inherit",
    });
  }
  console.log(
    `[dev-clean] Cleaned ${target}. Worktree ${removeWorktree ? "removed" : "preserved"}.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === entry) {
  try {
    main();
  } catch (error) {
    console.error(`[dev-clean] ${error.message}`);
    process.exitCode = 1;
  }
}
