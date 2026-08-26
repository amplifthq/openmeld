#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { isFinalCandidateControlPath } from "./final-candidate-control-paths.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const CONTROL_ENTRYPOINT = "scripts/ci/final-candidate.mjs";

function run() {
  const parsed = parseBootstrapArguments(process.argv.slice(2));
  const candidateRoot = resolveRepositoryRoot(process.cwd());
  fetchCurrentMain(candidateRoot);
  const baseSha = resolveCommit("refs/remotes/origin/main", candidateRoot);
  const headSha = resolveCommit("HEAD", candidateRoot);
  const controlChanges = resolveChangedPaths(
    baseSha,
    headSha,
    candidateRoot
  ).filter(isFinalCandidateControlPath);
  const bootstrap = resolveControlSelection({
    baseSha,
    bootstrapControlSha: parsed.bootstrapControlSha,
    bootstrapReason: parsed.bootstrapReason,
    candidateRoot,
    command: parsed.command,
    controlChanges,
    headSha,
  });
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "openmeld-final-candidate-control-")
  );
  const controlRoot = path.join(temporaryRoot, "control");
  try {
    execFileSync(
      "git",
      [
        "worktree",
        "add",
        "--detach",
        "--quiet",
        controlRoot,
        bootstrap.controlSha,
      ],
      { cwd: candidateRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    installTrustedControlDependencies(controlRoot);
    process.stdout.write(
      [
        "Final Candidate control",
        `Candidate root: ${candidateRoot}`,
        `Candidate head: ${headSha}`,
        `Current main: ${baseSha}`,
        `Control source: ${bootstrap.controlSha}`,
        `Control trust: ${bootstrap.controlTrust}`,
        ...(bootstrap.bootstrapReason
          ? [`Bootstrap reason: ${bootstrap.bootstrapReason}`]
          : []),
        ...(controlChanges.length > 0
          ? [
              "Delivery-control changes:",
              ...controlChanges.map((changedPath) => `- ${changedPath}`),
            ]
          : []),
        "",
      ].join("\n")
    );
    const forwardedArguments = [
      parsed.command,
      ...parsed.forwardedArguments,
      "--candidate-root",
      candidateRoot,
      "--head",
      headSha,
      "--base",
      baseSha,
      "--plan-source",
      bootstrap.controlSha,
      "--control-trust",
      bootstrap.controlTrust,
      ...(bootstrap.bootstrapReason
        ? ["--bootstrap-reason", bootstrap.bootstrapReason]
        : []),
    ];
    const result = spawnSync(
      process.execPath,
      [
        realpathSync(path.join(controlRoot, CONTROL_ENTRYPOINT)),
        ...forwardedArguments,
      ],
      {
        cwd: candidateRoot,
        encoding: "utf8",
        env: process.env,
        stdio: ["inherit", "pipe", "pipe"],
      }
    );
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  } finally {
    if (existsSync(controlRoot)) {
      spawnSync("git", ["worktree", "remove", "--force", controlRoot], {
        cwd: candidateRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function parseBootstrapArguments(args) {
  const [command = "help", ...remaining] = args;
  const forwardedArguments = [];
  let bootstrapControlSha = null;
  let bootstrapReason = null;
  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index];
    if (argument === "--") {
      continue;
    }
    if (
      argument === "--candidate-root" ||
      argument === "--head" ||
      argument === "--base" ||
      argument === "--plan-source" ||
      argument === "--control-trust"
    ) {
      throw new Error(`${argument} is owned by the Final Candidate bootstrap.`);
    }
    if (
      argument === "--bootstrap-control-sha" ||
      argument === "--bootstrap-reason"
    ) {
      const value = remaining[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === "--bootstrap-control-sha") {
        bootstrapControlSha = value;
      } else {
        bootstrapReason = value;
      }
      continue;
    }
    forwardedArguments.push(argument);
  }
  return {
    bootstrapControlSha,
    bootstrapReason,
    command,
    forwardedArguments,
  };
}

function resolveControlSelection(input) {
  if (!input.bootstrapControlSha) {
    if (
      !commitContainsPath(
        input.baseSha,
        CONTROL_ENTRYPOINT,
        input.candidateRoot
      )
    ) {
      throw new Error(
        [
          "Current main does not contain the guarded Final Candidate control plane.",
          "For an intentional one-time delivery-control bootstrap, inspect the exact control diff and rerun locally with:",
          "  --bootstrap-control-sha <exact-candidate-head> --bootstrap-reason <why-current-main-cannot-own-this-run>",
        ].join("\n")
      );
    }
    if (input.controlChanges.length > 0) {
      throw new Error(
        [
          "The candidate changes Final Candidate delivery control and cannot be certified by silently reusing candidate-owned control.",
          "Inspect the exact control diff, then use the explicit local bootstrap only when that escalation is justified:",
          `  --bootstrap-control-sha ${input.headSha} --bootstrap-reason <why-this-control-change-is-acceptable>`,
          "Changed controls:",
          ...input.controlChanges.map((changedPath) => `- ${changedPath}`),
        ].join("\n")
      );
    }
    return {
      bootstrapReason: null,
      controlSha: input.baseSha,
      controlTrust: "current-main",
    };
  }
  if (input.command === "request") {
    throw new Error(
      "A hosted request always uses current-main control. Use the explicit local bootstrap for an intentional delivery-control change."
    );
  }
  if (!EXACT_SHA_PATTERN.test(input.bootstrapControlSha)) {
    throw new Error(
      "--bootstrap-control-sha must be an exact lowercase commit SHA."
    );
  }
  const resolvedBootstrapSha = resolveCommit(
    input.bootstrapControlSha,
    input.candidateRoot
  );
  if (resolvedBootstrapSha !== input.headSha) {
    throw new Error(
      `Bootstrap control must equal the exact candidate head ${input.headSha}; found ${resolvedBootstrapSha}.`
    );
  }
  const reason = String(input.bootstrapReason ?? "").trim();
  if (reason.length < 20) {
    throw new Error(
      "--bootstrap-reason must explain why current-main control cannot own this run."
    );
  }
  if (
    !commitContainsPath(
      resolvedBootstrapSha,
      CONTROL_ENTRYPOINT,
      input.candidateRoot
    )
  ) {
    throw new Error(
      `Bootstrap control ${resolvedBootstrapSha} does not contain ${CONTROL_ENTRYPOINT}.`
    );
  }
  return {
    bootstrapReason: reason,
    controlSha: resolvedBootstrapSha,
    controlTrust: "explicit-bootstrap",
  };
}

function installTrustedControlDependencies(controlRoot) {
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "install",
      "--frozen-lockfile",
      "--filter",
      "@openmeld/schemas",
      "--ignore-scripts",
    ],
    {
      cwd: controlRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        "Could not install the trusted Final Candidate parser without lifecycle scripts.",
        result.stderr?.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

function resolveRepositoryRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function fetchCurrentMain(cwd) {
  execFileSync(
    "git",
    [
      "fetch",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
}

function resolveCommit(value, cwd) {
  return execFileSync("git", ["rev-parse", "--verify", `${value}^{commit}`], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function resolveChangedPaths(baseSha, headSha, cwd) {
  return execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", `${baseSha}...${headSha}`, "--"],
    { cwd, encoding: "utf8" }
  )
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean)
    .toSorted();
}

function commitContainsPath(commitSha, relativePath, cwd) {
  const result = spawnSync(
    "git",
    ["cat-file", "-e", `${commitSha}:${relativePath}`],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  return result.status === 0;
}

try {
  run();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
