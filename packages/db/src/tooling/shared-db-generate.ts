import fs from "node:fs";
import path from "node:path";
import { DB_FACT_SCHEMA_VERSION } from "@openmeld/schemas";
import type { DbCommandFactSummary } from "@openmeld/schemas/types";
import { getPackagesDbDirectoryPath } from "../auth/paths.ts";
import {
  getAuthDbGeneratedSchemaAbsolutePath,
  getAuthDbMigrationDirectoryAbsolutePath,
} from "../auth/tooling-paths.ts";
import { buildDbCommandFactSummary } from "../diagnostics/fact-builders.ts";
import { buildSharedToolingDbFactSnapshot } from "../shared/tooling-fact-snapshot.ts";
import {
  defaultToolingCommandRunner,
  normalizeBlockedReason,
  type ToolingCommandRunner,
} from "./command-runner.ts";
import {
  type DbExecutionMode,
  resolveDbExecutionMode,
} from "./db-execution-mode.ts";
import { runSharedDbCheck } from "./shared-db-check.ts";

const DRIZZLE_GENERATE_ARGS = [
  "exec",
  "drizzle-kit",
  "generate",
  "--config",
  "drizzle.config.ts",
] as const;

const readSharedDbArtifactState = (input?: {
  generatedSchemaPath?: string;
  migrationDirectoryPath?: string;
}): Map<string, string> => {
  const migrationDirectoryPath =
    input?.migrationDirectoryPath ?? getAuthDbMigrationDirectoryAbsolutePath();
  const generatedSchemaPath =
    input?.generatedSchemaPath ?? getAuthDbGeneratedSchemaAbsolutePath();
  const state = new Map<string, string>();

  if (fs.existsSync(generatedSchemaPath)) {
    state.set(
      path.relative(migrationDirectoryPath, generatedSchemaPath),
      fs.readFileSync(generatedSchemaPath, "utf8")
    );
  }

  if (!fs.existsSync(migrationDirectoryPath)) {
    return state;
  }

  const walk = (directoryPath: string) => {
    for (const entry of fs.readdirSync(directoryPath, {
      withFileTypes: true,
    })) {
      const absolutePath = path.resolve(directoryPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      const relativePath = path.relative(migrationDirectoryPath, absolutePath);
      state.set(relativePath, fs.readFileSync(absolutePath, "utf8"));
    }
  };

  walk(migrationDirectoryPath);
  return state;
};

const didSharedDbArtifactsChange = (
  before: Map<string, string>,
  after: Map<string, string>
): boolean => {
  if (before.size !== after.size) {
    return true;
  }

  for (const [relativePath, beforeContents] of before) {
    if (after.get(relativePath) !== beforeContents) {
      return true;
    }
  }

  return false;
};

const buildSharedDbGenerateSummary = (input: {
  blockedReason: string | null;
  cwd: string;
  mode: DbExecutionMode;
  result: "applied" | "blocked" | "no_diff";
}): DbCommandFactSummary => {
  return buildDbCommandFactSummary({
    contractVersion: DB_FACT_SCHEMA_VERSION,
    command: "db:generate",
    cwd: input.cwd,
    phase: "migration_phase",
    subject: "shared",
    result: input.result,
    blockedReason: input.blockedReason,
    snapshot: buildSharedToolingDbFactSnapshot(undefined, input.mode),
  });
};

export const runSharedDbGenerate = (input?: {
  authServiceDirectoryPath?: string;
  generatedSchemaPath?: string;
  migrationDirectoryPath?: string;
  mode?: DbExecutionMode;
  packagesDbDirectoryPath?: string;
  runner?: ToolingCommandRunner;
}): DbCommandFactSummary => {
  const packagesDbDirectoryPath =
    input?.packagesDbDirectoryPath ?? getPackagesDbDirectoryPath();
  const migrationDirectoryPath =
    input?.migrationDirectoryPath ?? getAuthDbMigrationDirectoryAbsolutePath();
  const generatedSchemaPath =
    input?.generatedSchemaPath ?? getAuthDbGeneratedSchemaAbsolutePath();
  const mode = input?.mode ?? resolveDbExecutionMode();
  const runner = input?.runner ?? defaultToolingCommandRunner;
  const checkSummary = runSharedDbCheck({
    authServiceDirectoryPath: input?.authServiceDirectoryPath,
    cwd: packagesDbDirectoryPath,
    mode,
    runner,
  });

  if (checkSummary.result === "blocked") {
    return buildSharedDbGenerateSummary({
      blockedReason: checkSummary.blockedReason,
      cwd: packagesDbDirectoryPath,
      mode,
      result: "blocked",
    });
  }

  const beforeState = readSharedDbArtifactState({
    generatedSchemaPath,
    migrationDirectoryPath,
  });

  const codegenResult = runner({
    args: ["run", "auth:generate"],
    cwd: packagesDbDirectoryPath,
  });
  if (codegenResult.error || codegenResult.status !== 0) {
    return buildSharedDbGenerateSummary({
      blockedReason: normalizeBlockedReason(codegenResult),
      cwd: packagesDbDirectoryPath,
      mode,
      result: "blocked",
    });
  }

  const generateResult = runner({
    args: [...DRIZZLE_GENERATE_ARGS],
    cwd: packagesDbDirectoryPath,
  });
  if (generateResult.error || generateResult.status !== 0) {
    return buildSharedDbGenerateSummary({
      blockedReason: normalizeBlockedReason(generateResult),
      cwd: packagesDbDirectoryPath,
      mode,
      result: "blocked",
    });
  }

  const afterState = readSharedDbArtifactState({
    generatedSchemaPath,
    migrationDirectoryPath,
  });
  if (!didSharedDbArtifactsChange(beforeState, afterState)) {
    return buildSharedDbGenerateSummary({
      blockedReason: null,
      cwd: packagesDbDirectoryPath,
      mode,
      result: "no_diff",
    });
  }

  return buildSharedDbGenerateSummary({
    blockedReason: null,
    cwd: packagesDbDirectoryPath,
    mode,
    result: "applied",
  });
};

export const emitSharedDbGenerateSummary = (): void => {
  const summary = runSharedDbGenerate();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(summary.result === "blocked" ? 1 : 0);
};
