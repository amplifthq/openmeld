#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { decideD1MigrationStage } from "./release-stage-probes.mjs";

const LINE_SPLIT_REGEX = /\r?\n/u;
const COMPLETION_PROBE_TIMEOUT_MS = 30_000;
const PRODUCTION_D1_MIGRATION_LIST_ARGS = [
  "-C",
  "services/auth",
  "exec",
  "wrangler",
  "d1",
  "migrations",
  "list",
  "OPENMELD_DB",
  "--config",
  "wrangler.jsonc",
  "--env",
  "prod",
  "--remote",
];

export function buildProductionDbStepSpecs() {
  return [
    {
      args: ["turbo", "run", "build", "--filter=@openmeld/auth"],
      command: "pnpm",
      databaseExecutionMode: "dev",
      label: "Build database code generation dependencies",
    },
    {
      args: ["db:generate"],
      command: "pnpm",
      databaseExecutionMode: "dev",
      label: "Generate database artifacts",
    },
    {
      args: ["db:check"],
      command: "pnpm",
      databaseExecutionMode: "dev",
      label: "Check committed database schema and migration truth",
    },
    {
      args: ["db:migrate:prod"],
      command: "pnpm",
      completionProbe: "d1-migrations",
      databaseExecutionMode: "prod",
      label: "Apply production migrations with read-only preflight",
    },
    {
      args: ["db:verify:prod"],
      command: "pnpm",
      databaseExecutionMode: "prod",
      label: "Verify the production database contract",
    },
    {
      args: ["db:optimize:prod"],
      command: "pnpm",
      databaseExecutionMode: "prod",
      label: "Optimize query planner statistics after schema synchronization",
    },
  ];
}

function assertCleanWorktree() {
  const changes = readGitStatus();
  if (changes.length > 0) {
    throw new Error(
      [
        "Production database synchronization requires a clean worktree.",
        ...changes.map((change) => `- ${change}`),
      ].join("\n")
    );
  }
}

function assertGeneratedArtifactsStayedCommitted() {
  const changes = readGitStatus();
  if (changes.length === 0) {
    return;
  }
  throw new Error(
    [
      "Database generation changed committed schema or migration artifacts.",
      "Run pnpm db:generate locally, review the migration, and commit it before production synchronization.",
      ...changes.map((change) => `- ${change}`),
    ].join("\n")
  );
}

function readGitStatus() {
  return execFileSync(
    resolveCommandBinary("git"),
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" }
  )
    .split(LINE_SPLIT_REGEX)
    .filter(Boolean);
}

function runStep(step, env) {
  process.stdout.write(`\n[production-db] ${step.label}\n`);
  const result = spawnSync(resolveCommandBinary(step.command), step.args, {
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${step.command} ${step.args.join(" ")} failed with exit code ${String(result.status)}`
    );
  }
}

export function executeProductionDbSteps(input) {
  const adapters = {
    runCommand: input.adapters?.runCommand ?? runReadOnlyCommand,
    runStep: input.adapters?.runStep ?? runStep,
  };
  const write = input.write ?? ((value) => process.stdout.write(value));
  for (const step of input.steps) {
    const stepEnv = {
      ...input.env,
      OPENMELD_DB_EXECUTION_MODE: step.databaseExecutionMode,
    };
    if (step.completionProbe === "d1-migrations") {
      const decision = decideD1MigrationStage(
        adapters.runCommand({
          args: PRODUCTION_D1_MIGRATION_LIST_ARGS,
          command: "pnpm",
          env: stepEnv,
        })
      );
      printProductionDbStageDecision(step.label, decision, write);
      if (decision.action === "SKIP") {
        continue;
      }
    }
    adapters.runStep(step, stepEnv);
    input.afterStep?.(step);
  }
}

export function runProductionDbRelease() {
  assertCleanWorktree();
  const env = { ...process.env };
  const steps = buildProductionDbStepSpecs();
  executeProductionDbSteps({
    afterStep: (step) => {
      if (step.label === "Generate database artifacts") {
        assertGeneratedArtifactsStayedCommitted();
      }
    },
    env,
    steps,
  });
  assertCleanWorktree();
}

function printProductionDbStageDecision(label, decision, write) {
  if (decision.action === "SKIP") {
    write(
      `\n[production-db] ${label} — SKIP (already done; criterion=${decision.criterion}): ${decision.reason}\n`
    );
    return;
  }
  const probeFailure = decision.probeFailure
    ? "; completion probe failed, fail-open to execution"
    : "";
  write(
    `\n[production-db] ${label} — RUN: ${decision.reason}${probeFailure}\n`
  );
}

function runReadOnlyCommand(input) {
  const result = spawnSync(resolveCommandBinary(input.command), input.args, {
    encoding: "utf8",
    env: input.env,
    maxBuffer: 1024 * 1024 * 20,
    timeout: COMPLETION_PROBE_TIMEOUT_MS,
  });
  return {
    status: result.error ? 1 : (result.status ?? 1),
    stderr: [String(result.stderr ?? "").trim(), result.error?.message]
      .filter(Boolean)
      .join("\n"),
    stdout: String(result.stdout ?? ""),
  };
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  if (command === "git") {
    return "git.exe";
  }
  if (command === "pnpm") {
    return "pnpm.cmd";
  }
  return command;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runProductionDbRelease();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
