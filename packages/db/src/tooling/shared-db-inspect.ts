import { DB_FACT_SCHEMA_VERSION } from "@openmeld/schemas";
import type { DbInspectionSummary } from "@openmeld/schemas/types";
import { getAuthServiceDirectoryPath } from "../auth/paths.ts";
import { resolveAuthToolingDbTarget } from "../auth/tooling-facts.ts";
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
import {
  inspectSharedCoreDispatchPhysicalContract,
  type SharedDbPhysicalContractInspection,
} from "./shared-db-physical-check.ts";
import {
  inspectUnsupportedLegacyCoreDispatchShape,
  type SharedDbUnsupportedLegacyShapeInspection,
} from "./shared-db-unsupported-legacy-shape.ts";

const buildSharedDbInspectSummary = (input: {
  authServiceDirectoryPath: string;
  checks: DbInspectionSummary["checks"];
  cwd: string;
  mode: DbExecutionMode;
  result: DbInspectionSummary["result"];
}): DbInspectionSummary => {
  const snapshot = buildSharedToolingDbFactSnapshot(
    input.authServiceDirectoryPath,
    input.mode
  );
  let blockedCheckDetail: string | null = null;
  if (input.checks.legacyCoreDispatchShape.status === "blocked") {
    blockedCheckDetail = input.checks.legacyCoreDispatchShape.detail;
  } else if (
    input.checks.sharedCoreDispatchPhysicalContract.status === "blocked"
  ) {
    blockedCheckDetail = input.checks.sharedCoreDispatchPhysicalContract.detail;
  }
  const firstNonNullDetail =
    input.checks.legacyCoreDispatchShape.detail ??
    input.checks.sharedCoreDispatchPhysicalContract.detail;
  const blockedReason =
    input.result === "blocked"
      ? (blockedCheckDetail ?? firstNonNullDetail)
      : null;

  return {
    contractVersion: DB_FACT_SCHEMA_VERSION,
    command: `db:inspect:${input.mode}`,
    cwd: input.cwd,
    subject: "shared",
    mode: input.mode,
    result: input.result,
    blockedReason,
    snapshot: {
      ...snapshot,
      subject: "shared",
      mode: "tooling",
    },
    checks: input.checks,
    notes: [
      "This is a read-only shared DB migration readiness inspection.",
      "ready means the current target passed both the legacy-shape guard and the shared physical contract check.",
    ],
  };
};

const buildConfigBlockedSummary = (input: {
  authServiceDirectoryPath: string;
  cwd: string;
  mode: DbExecutionMode;
  reason: string;
}): DbInspectionSummary => {
  return buildSharedDbInspectSummary({
    authServiceDirectoryPath: input.authServiceDirectoryPath,
    checks: {
      legacyCoreDispatchShape: {
        status: "blocked",
        detail: input.reason,
      },
      sharedCoreDispatchPhysicalContract: {
        status: "blocked",
        detail: input.reason,
      },
    },
    cwd: input.cwd,
    mode: input.mode,
    result: "blocked",
  });
};

const resolveInspectionResult = (input: {
  legacyShape: SharedDbUnsupportedLegacyShapeInspection;
  physicalContract: SharedDbPhysicalContractInspection;
}): DbInspectionSummary["result"] => {
  if (
    input.legacyShape.status === "blocked" ||
    input.physicalContract.status === "blocked"
  ) {
    return "blocked";
  }

  if (
    input.legacyShape.status === "drift_detected" ||
    input.physicalContract.status === "drift_detected"
  ) {
    return "drift_detected";
  }

  return "ready";
};

export const runSharedDbInspect = (input?: {
  authServiceDirectoryPath?: string;
  cwd?: string;
  mode?: DbExecutionMode;
  runner?: ToolingCommandRunner;
}): DbInspectionSummary => {
  const authServiceDirectoryPath =
    input?.authServiceDirectoryPath ?? getAuthServiceDirectoryPath();
  const cwd = input?.cwd ?? process.cwd();
  const mode = input?.mode ?? resolveDbExecutionMode();
  const runner = input?.runner ?? defaultToolingCommandRunner;

  try {
    resolveAuthToolingDbTarget(authServiceDirectoryPath, mode);
  } catch (error) {
    return buildConfigBlockedSummary({
      authServiceDirectoryPath,
      cwd,
      mode,
      reason: normalizeBlockedReason({
        error: error instanceof Error ? error : new Error(String(error)),
        stderr: "",
        status: 1,
        stdout: "",
      }),
    });
  }

  const legacyShape = inspectUnsupportedLegacyCoreDispatchShape({
    mode,
    runner,
    skipMissingLocalTargets: mode === "dev",
  });
  const physicalContract = inspectSharedCoreDispatchPhysicalContract({
    mode,
    runner,
  });

  return buildSharedDbInspectSummary({
    authServiceDirectoryPath,
    checks: {
      legacyCoreDispatchShape: {
        status: legacyShape.status,
        detail: legacyShape.detail,
      },
      sharedCoreDispatchPhysicalContract: {
        status: physicalContract.status,
        detail: physicalContract.detail,
      },
    },
    cwd,
    mode,
    result: resolveInspectionResult({
      legacyShape,
      physicalContract,
    }),
  });
};

export const emitSharedDbInspectSummary = (mode: DbExecutionMode): void => {
  const summary = runSharedDbInspect({ mode });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(summary.result === "ready" ? 0 : 1);
};
