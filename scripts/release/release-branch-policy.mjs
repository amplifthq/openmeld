#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const BRANCH_REF_PREFIX = "refs/heads/";
const LINE_SPLIT_PATTERN = /\r?\n/u;
const CLI_PACKAGE_PATH = "clients/openmeld-cli/package.json";
const LOCAL_COMPONENTS_MANIFEST_PATH = "release/local-components.json";

export function isReleaseBranchRef(value) {
  const ref = String(value ?? "").trim();
  return ref.startsWith(`${BRANCH_REF_PREFIX}codex/release-`);
}

export function assertStampedReleaseFacts(input) {
  if (
    typeof input.packageVersion !== "string" ||
    !input.packageVersion.trim() ||
    input.packageVersion !== input.manifestVersion
  ) {
    throw new Error(
      `The CLI package version ${String(input.packageVersion)} does not match the release manifest version ${String(input.manifestVersion)}.`
    );
  }
}

export function resolvePullRequestReleaseMode(input) {
  if (!(input.changedPaths ?? []).includes(LOCAL_COMPONENTS_MANIFEST_PATH)) {
    assertDeferredReleaseBranchFacts(input);
    return "deferred";
  }
  assertStampedReleaseFacts(input);
  return "strict";
}

export function assertDeferredReleaseBranchFacts(input) {
  const errors = [];
  const comparison = compareDeferredReleaseBranchFacts(input);
  if (!comparison.packageVersionMatches) {
    errors.push(
      `CLI package version changed without a stamped candidate diff: base=${String(input.basePackageVersion ?? "missing")} current=${String(input.currentPackageVersion ?? "missing")}.`
    );
  }
  if (!comparison.manifestMatches) {
    errors.push(
      "release/local-components.json changed without a stamped candidate diff."
    );
  }
  if (errors.length > 0) {
    throw new Error(
      [
        ...errors,
        "Stamp the release manifest with the matching CLI version so release-ready verification checks the built candidate.",
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

function run() {
  const branchName = process.argv[2]?.trim();
  if (!branchName) {
    throw new Error("A pull request head branch is required.");
  }
  const baseSha = process.argv[3]?.trim();
  if (!baseSha) {
    throw new Error("Release branch policy requires an exact base commit SHA.");
  }
  const repoRoot = process.cwd();
  const changedPaths = execFileSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["diff", "--name-only", "--no-renames", `${baseSha}...HEAD`, "--"],
    { cwd: repoRoot, encoding: "utf8" }
  )
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean);
  const currentPackage = readJson(`${repoRoot}/${CLI_PACKAGE_PATH}`);
  const currentManifest = readJson(
    `${repoRoot}/${LOCAL_COMPONENTS_MANIFEST_PATH}`
  );
  const basePackage = readJsonAtRevision(repoRoot, baseSha, CLI_PACKAGE_PATH);
  const baseManifest = readJsonAtRevision(
    repoRoot,
    baseSha,
    LOCAL_COMPONENTS_MANIFEST_PATH
  );
  const mode = resolvePullRequestReleaseMode({
    baseManifest,
    basePackageVersion: basePackage.version,
    changedPaths,
    currentManifest,
    currentPackageVersion: currentPackage.version,
    manifestVersion: currentManifest.components?.cli?.packageVersion,
    packageVersion: currentPackage.version,
  });
  process.stdout.write(`mode=${mode}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
