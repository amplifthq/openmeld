#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const BRANCH_REF_PREFIX = "refs/heads/";
const VERSIONED_RELEASE_BRANCH_PATTERN =
  /^codex\/release-(?<version>\d+\.\d+\.\d+)-(?<baseSha>[0-9a-f]{8,40})$/iu;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const CLI_PACKAGE_PATH = "clients/openmeld-cli/package.json";
const LOCAL_COMPONENTS_MANIFEST_PATH = "release/local-components.json";
const RELEASE_ONLY_PATHS = [CLI_PACKAGE_PATH, LOCAL_COMPONENTS_MANIFEST_PATH];

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
  const isVersionBump = pathsMatch(changedPaths, RELEASE_ONLY_PATHS);
  const isManifestOnlyRestamp = pathsMatch(changedPaths, [
    LOCAL_COMPONENTS_MANIFEST_PATH,
  ]);
  if (!(isVersionBump || isManifestOnlyRestamp)) {
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
  if (
    isManifestOnlyRestamp &&
    !(
      input.basePackageVersion === designation.version &&
      input.baseManifestVersion === designation.version
    )
  ) {
    throw new Error(
      "A manifest-only restamp requires the base package and release manifest to already declare the release version."
    );
  }
}

export function resolvePullRequestReleaseMode(input) {
  if (!isVersionedReleaseBranchName(input.branchName)) {
    assertDeferredReleaseBranchFacts(input);
    return "deferred";
  }
  assertVersionedReleaseBranchFacts(input);
  return "strict";
}

export function assertDeferredReleaseBranchFacts(input) {
  const errors = [];
  const comparison = compareDeferredReleaseBranchFacts(input);
  if (!comparison.packageVersionMatches) {
    errors.push(
      `CLI package version must match the PR base outside a versioned release branch: base=${String(input.basePackageVersion ?? "missing")} current=${String(input.currentPackageVersion ?? "missing")}.`
    );
  }
  if (!comparison.manifestMatches) {
    errors.push(
      "release/local-components.json must match the PR base outside a versioned release branch."
    );
  }
  if (errors.length > 0) {
    throw new Error(
      [
        ...errors,
        "Move the release stamp to the formal codex/release-X.Y.Z-<baseSHA> branch after the feature PR merges.",
      ].join("\n")
    );
  }
}

export function compareDeferredReleaseBranchFacts(input) {
  return {
    manifestMatches: isDeepStrictEqual(
      input.currentManifest,
      input.baseManifest
    ),
    packageVersionMatches:
      input.currentPackageVersion === input.basePackageVersion,
  };
}

export function assertCurrentDeferredReleaseBranch(input) {
  const repoRoot = input.repoRoot ?? process.cwd();
  const baseSha = resolveGitCommitSha(input.baseSha, repoRoot);
  const packageManifest = readJson(`${repoRoot}/${CLI_PACKAGE_PATH}`);
  const releaseManifest = readJson(
    `${repoRoot}/${LOCAL_COMPONENTS_MANIFEST_PATH}`
  );
  const basePackageManifest = readJsonAtRevision(
    repoRoot,
    baseSha,
    CLI_PACKAGE_PATH
  );
  const baseReleaseManifest = readJsonAtRevision(
    repoRoot,
    baseSha,
    LOCAL_COMPONENTS_MANIFEST_PATH
  );

  assertDeferredReleaseBranchFacts({
    baseManifest: baseReleaseManifest,
    basePackageVersion: basePackageManifest.version,
    currentManifest: releaseManifest,
    currentPackageVersion: packageManifest.version,
  });
}

export function assertCurrentVersionedReleaseBranch(input) {
  const repoRoot = input.repoRoot ?? process.cwd();
  const baseSha = resolveGitCommitSha(input.baseSha, repoRoot);
  const packageManifest = readJson(`${repoRoot}/${CLI_PACKAGE_PATH}`);
  const releaseManifest = readJson(
    `${repoRoot}/${LOCAL_COMPONENTS_MANIFEST_PATH}`
  );
  const basePackageManifest = readJsonAtRevision(
    repoRoot,
    baseSha,
    CLI_PACKAGE_PATH
  );
  const baseReleaseManifest = readJsonAtRevision(
    repoRoot,
    baseSha,
    LOCAL_COMPONENTS_MANIFEST_PATH
  );
  const changedPaths = execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["diff", "--name-only", "--no-renames", `${baseSha}...HEAD`, "--"],
    { cwd: repoRoot, encoding: "utf8" }
  )
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean);

  assertVersionedReleaseBranchFacts({
    baseSha,
    baseManifestVersion: baseReleaseManifest.components?.cli?.packageVersion,
    basePackageVersion: basePackageManifest.version,
    branchName: input.branchName,
    changedPaths,
    manifestVersion: releaseManifest.components?.cli?.packageVersion,
    packageVersion: packageManifest.version,
  });
}

function pathsMatch(actual, expected) {
  return (
    actual.length === expected.length &&
    expected.every((path, index) => actual[index] === path)
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonAtRevision(repoRoot, revision, filePath) {
  return JSON.parse(
    execFileSync(
      process.platform === "win32" ? "git.exe" : "git",
      ["show", `${revision}:${filePath}`],
      { cwd: repoRoot, encoding: "utf8" }
    )
  );
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
  const baseSha = process.argv[3]?.trim();
  if (!baseSha) {
    throw new Error("Release branch policy requires an exact base commit SHA.");
  }
  if (!isVersionedReleaseBranchName(branchName)) {
    assertCurrentDeferredReleaseBranch({ baseSha });
    process.stdout.write("mode=deferred\n");
    return;
  }
  assertCurrentVersionedReleaseBranch({ baseSha, branchName });
  process.stdout.write("mode=strict\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
