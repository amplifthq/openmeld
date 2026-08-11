#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  assertCurrentVersionedReleaseBranch,
  isVersionedReleaseBranchRef,
} from "./release-branch-policy.mjs";
import { selectPrePushReleaseVerificationPaths } from "./release-ready-paths.mjs";

const MAIN_REF = "refs/heads/main";
const BRANCH_REF_PREFIX = "refs/heads/";
const ZERO_SHA_PATTERN = /^0+$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const FIELD_SPLIT_PATTERN = /\s+/u;
const REPOSITORY_LOCAL_GIT_ENV_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
];

export function resolvePrePushReleaseMode(input) {
  const updates = parsePushUpdates(input);
  if (!updates || updates.length === 0) {
    return "strict";
  }

  if (
    updates.some(
      (update) =>
        update.remoteRef === MAIN_REF ||
        isVersionedReleaseBranchRef(update.remoteRef) ||
        !update.remoteRef.startsWith(BRANCH_REF_PREFIX)
    )
  ) {
    return "strict";
  }

  const nonDeletionUpdates = updates.filter(
    (update) => !ZERO_SHA_PATTERN.test(update.localSha)
  );
  if (nonDeletionUpdates.length === 0) {
    return "skip";
  }
  return "deferred";
}

export function assertPushedObjectsMatchHead(input, dependencies = {}) {
  const updates = parsePushUpdates(input);
  if (!updates) {
    throw new Error(
      "Pre-push release verification could not parse the pushed object IDs."
    );
  }
  const pushedObjectIds = [
    ...new Set(
      updates
        .filter((update) => !ZERO_SHA_PATTERN.test(update.localSha))
        .map((update) => update.localSha)
    ),
  ];
  if (pushedObjectIds.length === 0) {
    return;
  }

  const resolveCommit = dependencies.resolveCommit ?? resolveGitCommitSha;
  const headSha = resolveCommit("HEAD");
  for (const pushedObjectId of pushedObjectIds) {
    const pushedCommitSha = resolveCommit(pushedObjectId);
    if (pushedCommitSha !== headSha) {
      throw new Error(
        `Pre-push release verification rejected pushed object ${pushedObjectId}: commit ${pushedCommitSha} does not match the checked-out HEAD ${headSha}. Check out the commit you intend to push and retry.`
      );
    }
  }
}

export function assertReleaseVerificationWorktreeClean(input = {}) {
  const repoRoot = input.repoRoot ?? process.cwd();
  let changedPaths;
  try {
    changedPaths = resolveWorktreeChangedPaths(repoRoot);
  } catch (cause) {
    throw new Error(
      `Pre-push release verification could not inspect the worktree at ${repoRoot}.`,
      { cause }
    );
  }
  const verificationPaths = selectPrePushReleaseVerificationPaths(changedPaths);
  if (verificationPaths.length === 0) {
    return;
  }
  throw new Error(
    [
      "Pre-push release verification requires release-relevant and gate-control paths to match the checked-out HEAD.",
      ...verificationPaths.map((path) => `- ${path}`),
      "Commit or restore these paths, then retry the push so the verifier checks the exact tree being pushed.",
    ].join("\n")
  );
}

function parsePushUpdates(input) {
  const lines = String(input ?? "")
    .split(LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const updates = [];
  for (const line of lines) {
    const fields = line.split(FIELD_SPLIT_PATTERN);
    if (fields.length !== 4) {
      return null;
    }
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (!(localRef && localSha && remoteRef && remoteSha)) {
      return null;
    }
    updates.push({ localRef, localSha, remoteRef, remoteSha });
  }

  return updates;
}

function resolveExactBaseSha() {
  const requestedBase =
    process.env.OPENMELD_AFFECTED_BASE?.trim() || "origin/main";
  return resolveGitCommitSha(requestedBase);
}

function resolveGitCommitSha(value) {
  return execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["rev-parse", "--verify", `${value}^{commit}`],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: isolatedGitEnvironment(process.env),
    }
  ).trim();
}

function resolveWorktreeChangedPaths(repoRoot) {
  const options = {
    cwd: repoRoot,
    encoding: "utf8",
    env: isolatedGitEnvironment(process.env),
  };
  const trackedPaths = execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"],
    options
  );
  const untrackedPaths = execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
    options
  );
  return [
    ...new Set(`${trackedPaths}${untrackedPaths}`.split("\0").filter(Boolean)),
  ];
}

function isolatedGitEnvironment(env) {
  const isolated = { ...env };
  for (const name of REPOSITORY_LOCAL_GIT_ENV_VARS) {
    delete isolated[name];
  }
  return isolated;
}

function run() {
  const pushUpdates = readFileSync(0, "utf8");
  const mode = resolvePrePushReleaseMode(pushUpdates);
  if (mode === "skip") {
    process.stdout.write(
      "Release-ready pre-push gate skipped: this push only deletes remote refs.\n"
    );
    return;
  }
  assertPushedObjectsMatchHead(pushUpdates);
  assertReleaseVerificationWorktreeClean();

  const releaseBranchName =
    resolvePushedVersionedReleaseBranchName(pushUpdates);
  const baseSha =
    mode === "deferred" || releaseBranchName ? resolveExactBaseSha() : null;
  if (releaseBranchName) {
    assertCurrentVersionedReleaseBranch({
      baseSha,
      branchName: releaseBranchName,
    });
  }

  const args = ["run", "verify:release-ready"];
  if (mode === "deferred") {
    args.push("--", "--defer-release", "--base", baseSha);
    process.stdout.write(
      `Pre-push release mode: deferred feature verification against ${baseSha}.\n`
    );
  } else {
    process.stdout.write("Pre-push release mode: strict.\n");
  }
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
    { cwd: process.cwd(), stdio: "inherit" }
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

function resolvePushedVersionedReleaseBranchName(input) {
  const updates = parsePushUpdates(input) ?? [];
  const branchNames = [
    ...new Set(
      updates
        .filter(
          (update) =>
            !ZERO_SHA_PATTERN.test(update.localSha) &&
            isVersionedReleaseBranchRef(update.remoteRef)
        )
        .map((update) => update.remoteRef.slice(BRANCH_REF_PREFIX.length))
    ),
  ];
  if (branchNames.length > 1) {
    throw new Error(
      "A single push cannot designate more than one versioned release branch."
    );
  }
  return branchNames[0] ?? null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
