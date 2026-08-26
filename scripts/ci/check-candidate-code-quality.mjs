#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { formatCommand } from "./final-candidate-policy.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const gitBinary = process.platform === "win32" ? "git.exe" : "git";
const pnpmBinary = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export function resolveCandidateCodeQualityPaths(baseSha, headSha) {
  const output = execFileSync(
    gitBinary,
    [
      "diff",
      "--name-only",
      "--diff-filter=ACMRTUXB",
      "-z",
      `${baseSha}...${headSha}`,
      "--",
    ],
    { cwd: process.cwd() }
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(isExistingFile)
    .toSorted();
}

function run() {
  const [requestedBase, requestedHead] = process.argv.slice(2);
  const baseSha = resolveExactCommit(requestedBase, "base");
  const headSha = resolveExactCommit(requestedHead, "head");
  const candidatePaths = resolveCandidateCodeQualityPaths(baseSha, headSha);
  const command = [
    "pnpm",
    "exec",
    "biome",
    "check",
    "--no-errors-on-unmatched",
    ...candidatePaths,
  ];
  process.stdout.write(
    [
      "Candidate code-quality paths:",
      ...(candidatePaths.length > 0
        ? candidatePaths.map((candidatePath) => `- ${candidatePath}`)
        : ["- none"]),
      `$ ${formatCommand(command)}`,
      "",
    ].join("\n")
  );

  const result = spawnSync(pnpmBinary, command.slice(1), {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Candidate code quality failed with exit ${result.status}.`
    );
  }
}

function resolveExactCommit(value, name) {
  if (!EXACT_SHA_PATTERN.test(String(value ?? ""))) {
    throw new Error(`Candidate code quality requires an exact ${name} SHA.`);
  }
  return execFileSync(
    gitBinary,
    ["rev-parse", "--verify", `${value}^{commit}`],
    { cwd: process.cwd(), encoding: "utf8" }
  ).trim();
}

function isExistingFile(candidatePath) {
  const absolutePath = path.resolve(process.cwd(), candidatePath);
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
