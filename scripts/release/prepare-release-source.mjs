#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireMainlineReleaseSha } from "./require-mainline-release-sha.mjs";

// Admission and checkout share one trusted owner. A dispatch input cannot
// select executable source until it belongs to this immutable control history.
export function prepareReleaseSource({ controlRoot, releaseSha }) {
  const root = path.resolve(controlRoot);
  const verified = requireMainlineReleaseSha({
    cwd: root,
    mainRef: "HEAD",
    releaseSha,
  });
  const sourceRoot = path.resolve(root, "../release-source");
  if (existsSync(sourceRoot)) {
    throw new Error(`Release source already exists: ${sourceRoot}`);
  }
  execFileSync(
    "git",
    ["worktree", "add", "--detach", sourceRoot, verified.releaseSha],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
  );
  const checkedOut = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
  if (checkedOut !== verified.releaseSha) {
    throw new Error("Prepared source does not match the verified release SHA.");
  }
  return { sourceRoot, releaseSha: checkedOut };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = prepareReleaseSource({
      controlRoot: path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../.."
      ),
      releaseSha: process.argv[2],
    });
    process.stdout.write(
      `Prepared ${result.sourceRoot} at ${result.releaseSha}.\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
