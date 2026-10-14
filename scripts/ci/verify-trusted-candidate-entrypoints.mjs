#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { isFinalCandidateControlPath } from "./final-candidate-control-paths.mjs";
import { projectFinalCandidateControl } from "./final-candidate-control-projection.mjs";

const LINE_SPLIT_PATTERN = /\r?\n/u;
const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function verifyTrustedCandidateEntrypoints(input) {
  const result = inspectTrustedCandidateEntrypoints(input);
  if (result.driftedPaths.length > 0) {
    throw new Error(
      [
        "Hosted Final Candidate cannot let the candidate rewrite its own test-control entrypoints.",
        "Run the guarded local Final Candidate for an intentional package-script or task-graph change.",
        "Drifted controls:",
        ...result.driftedPaths.map((relativePath) => `- ${relativePath}`),
      ].join("\n")
    );
  }
  return { checkedPaths: result.checkedPaths };
}

export function inspectTrustedCandidateEntrypoints(input) {
  const trustedRoot = path.resolve(input.trustedRoot);
  const candidateRoot = path.resolve(input.candidateRoot);
  if (input.candidateRef && !EXACT_SHA_PATTERN.test(input.candidateRef)) {
    throw new Error("Candidate data requires an exact Git commit SHA.");
  }
  const paths =
    input.paths ??
    collectControlPaths(trustedRoot, candidateRoot, input.candidateRef);
  const driftedPaths = paths.filter(
    (relativePath) =>
      controlProjection(trustedRoot, relativePath) !==
      controlProjection(candidateRoot, relativePath, input.candidateRef)
  );
  return { checkedPaths: paths, driftedPaths };
}

function collectControlPaths(trustedRoot, candidateRoot, candidateRef) {
  return [
    ...new Set([
      ".npmrc",
      "pnpm-workspace.yaml",
      ...listTrackedControls(trustedRoot),
      ...listTrackedControls(candidateRoot, candidateRef),
    ]),
  ].toSorted();
}

function listTrackedControls(root, ref) {
  return execFileSync(
    "git",
    ref ? ["ls-tree", "-r", "--name-only", ref] : ["ls-files"],
    { cwd: root, encoding: "utf8" }
  )
    .split(LINE_SPLIT_PATTERN)
    .filter(
      (relativePath) =>
        relativePath.endsWith("/package.json") ||
        relativePath === "package.json" ||
        relativePath.endsWith("/turbo.json") ||
        relativePath === "turbo.json" ||
        isFinalCandidateControlPath(relativePath)
    );
}

function controlProjection(root, relativePath, ref) {
  if (ref) {
    const readBlob = (file) => {
      const entry = execFileSync("git", ["ls-tree", ref, "--", file], {
        cwd: root,
        encoding: "utf8",
      });
      return entry
        ? execFileSync("git", ["show", `${ref}:${file}`], {
            cwd: root,
            encoding: "utf8",
            // Dependency patches can exceed Node's default 1 MiB stdout limit.
            maxBuffer: 16 * 1024 * 1024,
          })
        : null;
    };
    return projectFinalCandidateControl(
      relativePath,
      readBlob(relativePath),
      readBlob
    );
  }
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return projectFinalCandidateControl(relativePath, null);
  }
  return projectFinalCandidateControl(
    relativePath,
    readFileSync(absolutePath, "utf8"),
    (relatedPath) => {
      const relatedAbsolutePath = path.join(root, relatedPath);
      return existsSync(relatedAbsolutePath)
        ? readFileSync(relatedAbsolutePath, "utf8")
        : null;
    }
  );
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
