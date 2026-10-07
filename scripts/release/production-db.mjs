#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { assertProductDatabaseReleaseSupported } from "./database-backend-admission.mjs";
import { admitProductionTrainArtifacts } from "./production-train-artifact-admission.mjs";
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

function assertCleanWorktree(cwd = process.cwd()) {
  const changes = readGitStatus(cwd);
  if (changes.length > 0) {
    throw new Error(
      [
        "Production database synchronization requires a clean worktree.",
        ...changes.map((change) => `- ${change}`),
      ].join("\n")
    );
  }
}

function assertGeneratedArtifactsStayedCommitted(cwd = process.cwd()) {
  const changes = readGitStatus(cwd);
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

function readGitStatus(cwd) {
  return execFileSync(
    resolveCommandBinary("git"),
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd, encoding: "utf8" }
  )
    .split(LINE_SPLIT_REGEX)
    .filter(Boolean);
}

function runStep(step, env, cwd) {
  process.stdout.write(`\n[production-db] ${step.label}\n`);
  const result = spawnSync(resolveCommandBinary(step.command), step.args, {
    cwd,
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
          cwd: input.cwd,
          env: stepEnv,
        })
      );
      printProductionDbStageDecision(step.label, decision, write);
      if (decision.action === "SKIP") {
        continue;
      }
    }
    adapters.runStep(step, stepEnv, input.cwd);
    input.afterStep?.(step);
  }
}

export async function runProductionDbRelease(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const env = { ...(input.env ?? process.env) };
  const adapters = {
    admitTrainArtifacts:
      input.adapters?.admitTrainArtifacts ?? admitProductionTrainArtifacts,
    assertCleanWorktree:
      input.adapters?.assertCleanWorktree ?? assertCleanWorktree,
    buildPlan: input.adapters?.buildPlan,
    checkArtifact: input.adapters?.checkArtifact,
    checkNpmArtifact: input.adapters?.checkNpmArtifact,
    readHeadSha:
      input.adapters?.readHeadSha ??
      ((root) =>
        execFileSync(resolveCommandBinary("git"), ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim()),
    runCommand: input.adapters?.runCommand,
    runStep: input.adapters?.runStep,
  };
  adapters.assertCleanWorktree(cwd);
  const sourceSha = adapters.readHeadSha(cwd);
  const declaredSourceSha = String(env.RELEASE_SHA ?? "").trim();
  if (declaredSourceSha && declaredSourceSha !== sourceSha) {
    throw new Error(
      "Production database source must match the checked-out RELEASE_SHA."
    );
  }
  await adapters.admitTrainArtifacts(
    { env, root: cwd, selectedScopes: "db", sourceSha },
    {
      ...(adapters.buildPlan ? { buildPlan: adapters.buildPlan } : {}),
      ...(adapters.checkArtifact
        ? { checkArtifact: adapters.checkArtifact }
        : {}),
      ...(adapters.checkNpmArtifact
        ? { checkNpmArtifact: adapters.checkNpmArtifact }
        : {}),
      readHeadSha: adapters.readHeadSha,
    }
  );
  const steps = buildProductionDbStepSpecs();
  executeProductionDbSteps({
    afterStep: (step) => {
      if (step.label === "Generate database artifacts") {
        assertGeneratedArtifactsStayedCommitted(cwd);
      }
    },
    adapters: {
      ...(adapters.runCommand ? { runCommand: adapters.runCommand } : {}),
      ...(adapters.runStep ? { runStep: adapters.runStep } : {}),
    },
    cwd,
    env,
    steps,
    write: input.write,
  });
  adapters.assertCleanWorktree(cwd);
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
    cwd: input.cwd,
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
    assertProductDatabaseReleaseSupported();
    await runProductionDbRelease();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
