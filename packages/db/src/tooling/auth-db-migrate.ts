import path from "node:path";
import { DB_FACT_SCHEMA_VERSION } from "@openmeld/schemas";
import type { DbCommandFactSummary } from "@openmeld/schemas/types";
import { getPackagesDbDirectoryPath } from "../auth/paths.ts";
import { getAuthDbWranglerConfigAbsolutePath } from "../auth/tooling-paths.ts";
import { buildDbCommandFactSummary } from "../diagnostics/fact-builders.ts";
import { listSharedLocalWorkerDbTargetDescriptors } from "../shared/local-worker-targets.ts";
import { buildSharedToolingDbFactSnapshot } from "../shared/tooling-fact-snapshot.ts";
import {
  defaultToolingCommandRunner,
  normalizeBlockedReason,
  type ToolingCommandRunner,
} from "./command-runner.ts";
import type { DbExecutionMode } from "./db-execution-mode.ts";
import { runSharedDbCheck } from "./shared-db-check.ts";
import { getSharedLocalDevWranglerStateDirectoryPath } from "./wrangler-d1-target.ts";

const getRelativeAuthWranglerConfigPathFromPackagesDb = (
  packagesDbDirectoryPath: string
): string => {
  return path.relative(
    packagesDbDirectoryPath,
    getAuthDbWranglerConfigAbsolutePath()
  );
};

const resolveWranglerExecutionArgs = (input: {
  commandArgs: string[];
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  wranglerConfigAbsolutePath?: string;
}) => {
  const relativeWranglerConfigPath = input.wranglerConfigAbsolutePath
    ? path.relative(
        input.packagesDbDirectoryPath,
        input.wranglerConfigAbsolutePath
      )
    : getRelativeAuthWranglerConfigPathFromPackagesDb(
        input.packagesDbDirectoryPath
      );

  return [
    "exec",
    "wrangler",
    "--config",
    relativeWranglerConfigPath,
    ...(input.mode === "prod" ? ["--env", "prod"] : []),
    ...input.commandArgs,
  ];
};

const buildDbMigrateSummary = (input: {
  blockedReason: string | null;
  command: "db:migrate:dev" | "db:migrate:prod";
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
      input.command === "db:migrate:prod" ? "prod" : "dev"
    ),
  });
};

const resolveSharedDbMigrateTargets = (
  mode: DbExecutionMode
): Array<{
  targetLabel: string | null;
  wranglerConfigAbsolutePath?: string;
}> => {
  return mode === "dev"
    ? listSharedLocalWorkerDbTargetDescriptors().map((target) => ({
        targetLabel: target.targetLabel,
        wranglerConfigAbsolutePath: target.wranglerConfigAbsolutePath,
      }))
    : [{ targetLabel: null, wranglerConfigAbsolutePath: undefined }];
};

const applySharedDbMigrations = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
}): string | null => {
  for (const migrateTarget of resolveSharedDbMigrateTargets(input.mode)) {
    const migrateResult = input.runner({
      args: resolveWranglerExecutionArgs({
        commandArgs: [
          "d1",
          "migrations",
          "apply",
          "OPENMELD_DB",
          ...(input.mode === "prod"
            ? ["--remote"]
            : [
                "--local",
                "--persist-to",
                getSharedLocalDevWranglerStateDirectoryPath(),
              ]),
        ],
        mode: input.mode,
        packagesDbDirectoryPath: input.packagesDbDirectoryPath,
        wranglerConfigAbsolutePath: migrateTarget.wranglerConfigAbsolutePath,
      }),
      cwd: input.packagesDbDirectoryPath,
    });

    if (migrateResult.error || migrateResult.status !== 0) {
      return migrateTarget.targetLabel
        ? `${migrateTarget.targetLabel}: ${normalizeBlockedReason(migrateResult)}`
        : normalizeBlockedReason(migrateResult);
    }
  }

  return null;
};

const runProductionMigrationPreflight = (input: {
  packagesDbDirectoryPath: string;
  runner: ToolingCommandRunner;
}): string | null => {
  // `db:check` validates the committed schema and migration artifacts. Keep it
  // on the local tooling target so production migrate can use Wrangler auth
  // instead of requiring Drizzle D1 HTTP credentials.
  const checkSummary = runSharedDbCheck({
    cwd: input.packagesDbDirectoryPath,
    mode: "dev",
    runner: input.runner,
  });
  if (checkSummary.result !== "no_diff") {
    return `production migration preflight db:check ${checkSummary.result}: ${
      checkSummary.blockedReason ?? "no detail"
    }`;
  }

  const pendingMigrationListResult = input.runner({
    args: resolveWranglerExecutionArgs({
      commandArgs: ["d1", "migrations", "list", "OPENMELD_DB", "--remote"],
      mode: "prod",
      packagesDbDirectoryPath: input.packagesDbDirectoryPath,
    }),
    cwd: input.packagesDbDirectoryPath,
  });
  if (
    pendingMigrationListResult.error ||
    pendingMigrationListResult.status !== 0
  ) {
    return `production migration preflight migrations list failed: ${normalizeBlockedReason(
      pendingMigrationListResult
    )}`;
  }

  return null;
};

export const runSharedDbMigrate = (input: {
  mode: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner?: ToolingCommandRunner;
}): DbCommandFactSummary => {
  const packagesDbDirectoryPath =
    input.packagesDbDirectoryPath ?? getPackagesDbDirectoryPath();
  const runner = input.runner ?? defaultToolingCommandRunner;

  if (input.mode === "prod") {
    const preflightBlockedReason = runProductionMigrationPreflight({
      packagesDbDirectoryPath,
      runner,
    });
    if (preflightBlockedReason) {
      return buildDbMigrateSummary({
        command: "db:migrate:prod",
        blockedReason: preflightBlockedReason,
        cwd: packagesDbDirectoryPath,
        result: "blocked",
      });
    }
  }

  const migrateBlockedReason = applySharedDbMigrations({
    mode: input.mode,
    packagesDbDirectoryPath,
    runner,
  });
  if (migrateBlockedReason) {
    return buildDbMigrateSummary({
      command: input.mode === "prod" ? "db:migrate:prod" : "db:migrate:dev",
      blockedReason: migrateBlockedReason,
      cwd: packagesDbDirectoryPath,
      result: "blocked",
    });
  }

  return buildDbMigrateSummary({
    command: input.mode === "prod" ? "db:migrate:prod" : "db:migrate:dev",
    blockedReason: null,
    cwd: packagesDbDirectoryPath,
    result: "applied",
  });
};

export const emitSharedDbMigrateSummary = (mode: DbExecutionMode): void => {
  const summary = runSharedDbMigrate({ mode });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(summary.result === "blocked" ? 1 : 0);
};

export const runAuthDbMigrate = runSharedDbMigrate;
export const emitAuthDbMigrateSummary = emitSharedDbMigrateSummary;
