#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const BRANCH_REF_PREFIX = "refs/heads/";
const VERSIONED_RELEASE_BRANCH_PATTERN =
  /^codex\/release-(?<version>\d+\.\d+\.\d+)-(?<baseSha>[0-9a-f]{8,40})$/iu;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const RELEASE_ONLY_PATHS = [
  "clients/openmeld-cli/package.json",
  "release/local-components.json",
];

export function parseVersionedReleaseBranchName(value) {
  const match = VERSIONED_RELEASE_BRANCH_PATTERN.exec(
    String(value ?? "").trim()
  );
  if (!(match?.groups?.version && match.groups.baseSha)) {
    return null;
  }
  return {
    baseSha: match.groups.baseSha.toLowerCase(),
    version: match.groups.version,
  };
}

export function isVersionedReleaseBranchName(value) {
  return parseVersionedReleaseBranchName(value) !== null;
}

export function isVersionedReleaseBranchRef(value) {
  const ref = String(value ?? "").trim();
  return (
    ref.startsWith(BRANCH_REF_PREFIX) &&
    isVersionedReleaseBranchName(ref.slice(BRANCH_REF_PREFIX.length))
  );
}

export function assertVersionedReleaseBranchFacts(input) {
  const designation = parseVersionedReleaseBranchName(input.branchName);
  if (!designation) {
    throw new Error(
      "A strict release PR requires codex/release-X.Y.Z-<baseSHA>."
    );
  }
  const baseSha = String(input.baseSha ?? "")
    .trim()
    .toLowerCase();
  if (!EXACT_SHA_PATTERN.test(baseSha)) {
    throw new Error("A strict release PR requires an exact base commit SHA.");
  }
  if (!baseSha.startsWith(designation.baseSha)) {
    throw new Error(
      `The release branch base commit ${designation.baseSha} does not match ${baseSha}.`
    );
  }
  if (input.packageVersion !== designation.version) {
    throw new Error(
      `The release branch version ${designation.version} does not match the CLI package version ${String(input.packageVersion)}.`
    );
  }
  if (input.manifestVersion !== designation.version) {
    throw new Error(
      `The release branch version ${designation.version} does not match the release manifest version ${String(input.manifestVersion)}.`
    );
  }
  const changedPaths = [...new Set(input.changedPaths ?? [])].sort();
  if (
    changedPaths.length !== RELEASE_ONLY_PATHS.length ||
    RELEASE_ONLY_PATHS.some((path, index) => changedPaths[index] !== path)
  ) {
    throw new Error(
      [
        "A strict release PR requires a release-only diff:",
        ...RELEASE_ONLY_PATHS.map((path) => `- ${path}`),
        "Actual changed paths:",
        ...(changedPaths.length > 0
          ? changedPaths.map((path) => `- ${path}`)
          : ["- none"]),
      ].join("\n")
    );
  }
}

export function resolvePullRequestReleaseMode(input) {
  if (!isVersionedReleaseBranchName(input.branchName)) {
    return "deferred";
  }
  assertVersionedReleaseBranchFacts(input);
  return "strict";
}

export function assertCurrentVersionedReleaseBranch(input) {
  const repoRoot = input.repoRoot ?? process.cwd();
  const baseSha = resolveGitCommitSha(input.baseSha, repoRoot);
  const packageManifest = readJson(
    `${repoRoot}/clients/openmeld-cli/package.json`
  );
  const releaseManifest = readJson(`${repoRoot}/release/local-components.json`);
  const changedPaths = execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["diff", "--name-only", "--no-renames", `${baseSha}...HEAD`, "--"],
    { cwd: repoRoot, encoding: "utf8" }
  )
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean);

  assertVersionedReleaseBranchFacts({
    baseSha,
    branchName: input.branchName,
    changedPaths,
    manifestVersion: releaseManifest.components?.cli?.packageVersion,
    packageVersion: packageManifest.version,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function resolveGitCommitSha(value, repoRoot) {
  return execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["rev-parse", "--verify", `${value}^{commit}`],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim();
}

function run() {
  const branchName = process.argv[2]?.trim();
  if (!branchName) {
    throw new Error("A pull request head branch is required.");
  }
  if (!isVersionedReleaseBranchName(branchName)) {
    process.stdout.write("mode=deferred\n");
    return;
  }
  const baseSha = process.argv[3]?.trim();
  if (!baseSha) {
    throw new Error("A strict release PR requires its exact base commit SHA.");
  }
  assertCurrentVersionedReleaseBranch({ baseSha, branchName });
  process.stdout.write("mode=strict\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
