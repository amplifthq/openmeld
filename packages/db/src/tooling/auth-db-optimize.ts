import path from "node:path";
import { DB_FACT_SCHEMA_VERSION } from "@openmeld/schemas";
import type { DbCommandFactSummary } from "@openmeld/schemas/types";
import { getPackagesDbDirectoryPath } from "../auth/paths.ts";
import { getAuthDbWranglerConfigAbsolutePath } from "../auth/tooling-paths.ts";
import { buildDbCommandFactSummary } from "../diagnostics/fact-builders.ts";
import { buildSharedToolingDbFactSnapshot } from "../shared/tooling-fact-snapshot.ts";
import {
  defaultToolingCommandRunner,
  normalizeBlockedReason,
  type ToolingCommandRunner,
} from "./command-runner.ts";
import type { DbExecutionMode } from "./db-execution-mode.ts";

const buildDbOptimizeSummary = (input: {
  blockedReason: string | null;
  command: "db:optimize:dev" | "db:optimize:prod";
  cwd: string;
  result: "applied" | "blocked";
}): DbCommandFactSummary => {
  return buildDbCommandFactSummary({
    contractVersion: DB_FACT_SCHEMA_VERSION,
    command: input.command,
    cwd: input.cwd,
    phase: "migration_phase",
    subject: "shared",
    result: input.result,
    blockedReason: input.blockedReason,
    snapshot: buildSharedToolingDbFactSnapshot(
      undefined,
      input.command === "db:optimize:prod" ? "prod" : "dev"
    ),
  });
};

const getRelativeAuthWranglerConfigPathFromPackagesDb = (
  packagesDbDirectoryPath: string
): string => {
  return path.relative(
    packagesDbDirectoryPath,
    getAuthDbWranglerConfigAbsolutePath()
  );
};

export const runSharedDbOptimize = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner?: ToolingCommandRunner;
}): DbCommandFactSummary => {
  const packagesDbDirectoryPath =
    input.packagesDbDirectoryPath ?? getPackagesDbDirectoryPath();
  const runner = input.runner ?? defaultToolingCommandRunner;
  const result = runner({
    args: [
      "exec",
      "wrangler",
      "--config",
      getRelativeAuthWranglerConfigPathFromPackagesDb(packagesDbDirectoryPath),
      ...(input.mode === "prod" ? ["--env", "prod"] : []),
      "d1",
      "execute",
      "OPENMELD_DB",
      input.mode === "prod" ? "--remote" : "--local",
      "--yes",
      "--command",
      "PRAGMA optimize;",
    ],
    cwd: packagesDbDirectoryPath,
  });

  if (result.error || result.status !== 0) {
    return buildDbOptimizeSummary({
      command: input.mode === "prod" ? "db:optimize:prod" : "db:optimize:dev",
      blockedReason: normalizeBlockedReason(result),
      cwd: packagesDbDirectoryPath,
      result: "blocked",
    });
  }

  return buildDbOptimizeSummary({
    command: input.mode === "prod" ? "db:optimize:prod" : "db:optimize:dev",
    blockedReason: null,
    cwd: packagesDbDirectoryPath,
    result: "applied",
  });
};

export const emitSharedDbOptimizeSummary = (mode: DbExecutionMode): void => {
  const summary = runSharedDbOptimize({ mode });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(summary.result === "blocked" ? 1 : 0);
};

export const runAuthDbOptimize = runSharedDbOptimize;
export const emitAuthDbOptimizeSummary = emitSharedDbOptimizeSummary;
