import { DB_FACT_SCHEMA_VERSION } from "@openmeld/schemas";
import type { DbCommandFactSummary } from "@openmeld/schemas/types";
import { getAuthServiceDirectoryPath } from "../auth/paths.ts";
import { buildDbCommandFactSummary } from "../diagnostics/fact-builders.ts";
import { buildSharedToolingDbFactSnapshot } from "../shared/tooling-fact-snapshot.ts";
import {
  defaultToolingCommandRunner,
  type ToolingCommandRunner,
} from "./command-runner.ts";
import {
  type DbExecutionMode,
  resolveDbExecutionMode,
} from "./db-execution-mode.ts";
import { runSharedDbInspect } from "./shared-db-inspect.ts";

const buildDbVerifySummary = (input: {
  blockedReason: string | null;
  command: "db:verify:dev" | "db:verify:prod";
  cwd: string;
  result: "blocked" | "diff_detected" | "no_diff";
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
      input.command === "db:verify:prod" ? "prod" : "dev"
    ),
  });
};

const resolveVerifyDetail = (
  inspection: ReturnType<typeof runSharedDbInspect>
): string | null => {
  if (inspection.result === "blocked") {
    return inspection.blockedReason;
  }

  if (inspection.result === "drift_detected") {
    return (
      inspection.checks.legacyCoreDispatchShape.detail ??
      inspection.checks.sharedCoreDispatchPhysicalContract.detail
    );
  }

  return null;
};

export const runSharedDbVerify = (input?: {
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
  const inspection = runSharedDbInspect({
    authServiceDirectoryPath,
    cwd,
    mode,
    runner,
  });
  let result: "blocked" | "diff_detected" | "no_diff" = "blocked";

  if (inspection.result === "ready") {
    result = "no_diff";
  } else if (inspection.result === "drift_detected") {
    result = "diff_detected";
  }

  return buildDbVerifySummary({
    command: mode === "prod" ? "db:verify:prod" : "db:verify:dev",
    blockedReason: resolveVerifyDetail(inspection),
    cwd,
    result,
  });
};

export const emitSharedDbVerifySummary = (mode: DbExecutionMode): void => {
  const summary = runSharedDbVerify({ mode });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(summary.result === "no_diff" ? 0 : 1);
};

export const runAuthDbVerify = runSharedDbVerify;
export const emitAuthDbVerifySummary = emitSharedDbVerifySummary;
