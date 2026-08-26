#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const LINE_SPLIT_PATTERN = /\r?\n/u;

export function verifyTrustedCandidateEntrypoints(input) {
  const trustedRoot = path.resolve(input.trustedRoot);
  const candidateRoot = path.resolve(input.candidateRoot);
  const paths = input.paths ?? collectControlPaths(trustedRoot, candidateRoot);
  const drifted = paths.filter(
    (relativePath) =>
      controlProjection(trustedRoot, relativePath) !==
      controlProjection(candidateRoot, relativePath)
  );
  if (drifted.length > 0) {
    throw new Error(
      [
        "Hosted Final Candidate cannot let the candidate rewrite its own test-control entrypoints.",
        "Run the guarded local Final Candidate for an intentional package-script or task-graph change.",
        "Drifted controls:",
        ...drifted.map((relativePath) => `- ${relativePath}`),
      ].join("\n")
    );
  }
  return { checkedPaths: paths };
}

function collectControlPaths(trustedRoot, candidateRoot) {
  return [
    ...new Set([
      "pnpm-workspace.yaml",
      ...listTrackedControls(trustedRoot),
      ...listTrackedControls(candidateRoot),
    ]),
  ].toSorted();
}

function listTrackedControls(root) {
  return execFileSync(
    "git",
    ["ls-files", "--", ":(glob)**/package.json", ":(glob)**/turbo.json"],
    { cwd: root, encoding: "utf8" }
  )
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean);
}

function controlProjection(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return "missing";
  }
  if (relativePath.endsWith("package.json")) {
    const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
    return JSON.stringify({
      packageManager: manifest.packageManager ?? null,
      scripts: manifest.scripts ?? {},
    });
  }
  return readFileSync(absolutePath, "utf8");
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!(option?.startsWith("--") && value)) {
      throw new Error(
        "Trusted candidate entrypoint verification requires --trusted-root and --candidate-root."
      );
    }
    const key = {
      "--candidate-root": "candidateRoot",
      "--trusted-root": "trustedRoot",
    }[option];
    if (!key) {
      throw new Error(`Unknown trusted entrypoint option: ${option}`);
    }
    options[key] = value;
  }
  if (!(options.trustedRoot && options.candidateRoot)) {
    throw new Error(
      "Trusted candidate entrypoint verification requires --trusted-root and --candidate-root."
    );
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyTrustedCandidateEntrypoints(
      parseOptions(process.argv.slice(2))
    );
    process.stdout.write(
      `Trusted candidate entrypoints match current main (${String(result.checkedPaths.length)} controls).\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
