import { DB_FACT_SCHEMA_VERSION } from "@openmeld/schemas";
import type { DbCommandFactSummary } from "@openmeld/schemas/types";
import {
  getAuthServiceDirectoryPath,
  getPackagesDbDirectoryPath,
} from "../auth/paths.ts";
import { buildDbCommandFactSummary } from "../diagnostics/fact-builders.ts";
import { buildSharedToolingDbFactSnapshot } from "../shared/tooling-fact-snapshot.ts";
import { resolveSharedDrizzleConfigInput } from "../shared/tooling-facts.ts";
import {
  defaultToolingCommandRunner,
  normalizeBlockedReason,
  type ToolingCommandRunner,
  type ToolingCommandRunnerResult,
} from "./command-runner.ts";
import {
  type DbExecutionMode,
  resolveDbExecutionMode,
  SHARED_DB_EXECUTION_MODE_ENV_NAME,
} from "./db-execution-mode.ts";

const DRIZZLE_CHECK_ARGS = [
  "exec",
  "drizzle-kit",
  "check",
  "--config",
  "drizzle.config.ts",
] as const;
const DRIFT_OUTPUT_PATTERNS = [
  /drift/i,
  /not in sync/i,
  /schema changes?/i,
  /migration.+missing/i,
  /no file .* found in .* migrations?/i,
] as const;

const buildSharedDbCheckSummary = (input: {
  authServiceDirectoryPath: string;
  blockedReason: string | null;
  cwd: string;
  mode: DbExecutionMode;
  result: "blocked" | "diff_detected" | "no_diff";
}): DbCommandFactSummary => {
  return buildDbCommandFactSummary({
    contractVersion: DB_FACT_SCHEMA_VERSION,
    command: "db:check",
    cwd: input.cwd,
    phase: "migration_phase",
    subject: "shared",
    result: input.result,
    blockedReason: input.blockedReason,
    snapshot: buildSharedToolingDbFactSnapshot(
      input.authServiceDirectoryPath,
      input.mode
    ),
  });
};

const resolveDbCheckFailureResult = (
  result: ToolingCommandRunnerResult
): "blocked" | "diff_detected" => {
  const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
  if (
    DRIFT_OUTPUT_PATTERNS.some((pattern) => {
      return pattern.test(combinedOutput);
    })
  ) {
    return "diff_detected";
  }

  return "blocked";
};

export const runSharedDbCheck = (input?: {
  authServiceDirectoryPath?: string;
  cwd?: string;
  mode?: DbExecutionMode;
  runner?: ToolingCommandRunner;
}): DbCommandFactSummary => {
  const authServiceDirectoryPath =
    input?.authServiceDirectoryPath ?? getAuthServiceDirectoryPath();
  const cwd = input?.cwd ?? process.cwd();
  const mode = input?.mode ?? resolveDbExecutionMode();
  const runner = input?.runner ?? defaultToolingCommandRunner;
  try {
    resolveSharedDrizzleConfigInput(authServiceDirectoryPath, mode);
  } catch (error) {
    return buildSharedDbCheckSummary({
      authServiceDirectoryPath,
      blockedReason: normalizeBlockedReason({
        error: error instanceof Error ? error : new Error(String(error)),
        stderr: "",
        status: 1,
        stdout: "",
      }),
      cwd,
      mode,
      result: "blocked",
    });
  }

  const result = runner({
    args: [...DRIZZLE_CHECK_ARGS],
    cwd: getPackagesDbDirectoryPath(),
    env: {
      ...process.env,
      [SHARED_DB_EXECUTION_MODE_ENV_NAME]: mode,
    },
  });

  if (result.error || result.status !== 0) {
    return buildSharedDbCheckSummary({
      authServiceDirectoryPath,
      blockedReason: normalizeBlockedReason(result),
      cwd,
      mode,
      result: resolveDbCheckFailureResult(result),
    });
  }

  return buildSharedDbCheckSummary({
    authServiceDirectoryPath,
    blockedReason: null,
    cwd,
    mode,
    result: "no_diff",
  });
};

export const emitSharedDbCheckSummary = (): void => {
  const summary = runSharedDbCheck();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(summary.result === "no_diff" ? 0 : 1);
};
