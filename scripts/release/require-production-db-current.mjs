#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const PENDING_EVIDENCE_LIMIT = 4000;
const NO_PENDING_D1_MIGRATIONS_PATTERN = /No migrations to apply[.!]?/iu;
const PENDING_D1_MIGRATIONS_PATTERN =
  /Migrations to be applied:|\b\d{4}_[\w-]+\.sql\b/iu;

export function requireProductionDatabaseCurrent(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const command = {
    command: "pnpm",
    args: [
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
    ],
    cwd,
  };
  const result = (input.runCommand ?? runCommand)(command);
  const combinedEvidence = [result.stdout, result.stderr]
    .map((value) => String(value ?? ""))
    .join("\n");
  const hasPendingMigrations =
    PENDING_D1_MIGRATIONS_PATTERN.test(combinedEvidence);
  if (
    result.status === 0 &&
    !hasPendingMigrations &&
    NO_PENDING_D1_MIGRATIONS_PATTERN.test(combinedEvidence)
  ) {
    return {
      status: "current",
      reason: "the remote D1 pending migration list is empty",
    };
  }

  const evidence = formatProbeEvidence(result);
  if (result.status !== 0 || !hasPendingMigrations) {
    throw new Error(
      [
        "CLI/Core release refused: could not prove that the Production database is current.",
        "Fix the migration-list access or credentials, then rerun the CLI release.",
        evidence,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  throw new Error(
    [
      "Production database is behind the release source.",
      "CLI Release also deploys Core, so publishing now could run new Core code against an older database schema.",
      "Run Scoped Production Release for the exact release SHA with scope `database`, wait for it to succeed, then rerun CLI Release.",
      evidence,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function runCommand(input) {
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function formatProbeEvidence(result) {
  const raw = [result.stdout, result.stderr]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n");
  if (!raw) {
    return "Migration probe returned no diagnostic output.";
  }
  return `Migration probe evidence:\n${raw.slice(0, PENDING_EVIDENCE_LIMIT)}`;
}

function parseArguments(argv) {
  if (
    argv.length === 2 &&
    argv[0] === "--release-source" &&
    String(argv[1] ?? "").trim()
  ) {
    return { cwd: argv[1] };
  }
  throw new Error(
    "Usage: require-production-db-current.mjs --release-source <path>"
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    requireProductionDatabaseCurrent(parseArguments(process.argv.slice(2)));
    process.stdout.write("Production database migrations are current.\n");
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
