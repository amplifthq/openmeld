import type {
  DaemonServiceUpdateJob,
  OpenMeldToolsUpdateAttempt,
  OpenMeldToolsUpdateFailureCode,
  OpenMeldToolsUpdateOperation,
} from "@openmeld/schemas/types";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import {
  readLastDaemonServiceUpdate,
  readPendingDaemonServiceUpdate,
} from "../lifecycle/daemon-service-update-state";
import {
  readLastOpenMeldToolsUpdateAttempt,
  readPendingOpenMeldToolsUpdateAttempt,
} from "./openmeld-tools-update-attempt-state";
import { resolvePersistedOpenMeldToolsUpdateFailure } from "./openmeld-tools-update-failure";

const TERMINAL_VISIBILITY_MS = 24 * 60 * 60 * 1000;

export type OpenMeldToolsUpdateOperationProjection = {
  failureCode: OpenMeldToolsUpdateFailureCode | null;
  operation: OpenMeldToolsUpdateOperation;
};

export async function resolveOpenMeldToolsUpdateOperation(
  pathInput: OpenMeldPathResolutionInput = {},
  nowMs = Date.now()
): Promise<OpenMeldToolsUpdateOperation | null> {
  const projection = await resolveOpenMeldToolsUpdateOperationProjection(
    pathInput,
    nowMs
  );
  return projection?.operation ?? null;
}

export async function resolveOpenMeldToolsUpdateOperationProjection(
  pathInput: OpenMeldPathResolutionInput = {},
  nowMs = Date.now()
): Promise<OpenMeldToolsUpdateOperationProjection | null> {
  const [servicePending, toolsPending] = await Promise.all([
    readPendingDaemonServiceUpdate(pathInput),
    readPendingOpenMeldToolsUpdateAttempt(pathInput),
  ]);
  if (servicePending) {
    return projectServiceJob(servicePending);
  }
  if (toolsPending) {
    return projectToolsAttempt(toolsPending);
  }

  const [serviceLast, toolsLast] = await Promise.all([
    readLastDaemonServiceUpdate(pathInput),
    readLastOpenMeldToolsUpdateAttempt(pathInput),
  ]);
  const candidates = [
    ...(serviceLast ? [projectServiceJob(serviceLast)] : []),
    ...(toolsLast ? [projectToolsAttempt(toolsLast)] : []),
  ]
    .filter((candidate) => isRecentTerminal(candidate.operation, nowMs))
    .sort(
      (a, b) =>
        Date.parse(b.operation.updatedAt) - Date.parse(a.operation.updatedAt)
    );
  return candidates[0] ?? null;
}

function projectToolsAttempt(
  attempt: OpenMeldToolsUpdateAttempt
): OpenMeldToolsUpdateOperationProjection {
  const terminalFailure =
    attempt.operation.phase === "needs_help" ||
    attempt.operation.phase === "restored";
  return {
    failureCode: terminalFailure
      ? (resolvePersistedOpenMeldToolsUpdateFailure(attempt.errorMessage) ??
        "cli.update.failed")
      : null,
    operation: attempt.operation,
  };
}

function projectServiceJob(
  job: DaemonServiceUpdateJob
): OpenMeldToolsUpdateOperationProjection {
  return {
    failureCode:
      job.phase === "needs_help" || job.phase === "restored"
        ? "cli.update.service_alignment_failed"
        : null,
    operation: {
      operationId: job.jobId,
      phase: job.phase,
      requestSource: job.requestSource,
      requestedAt: job.requestedAt,
      targetVersion: job.targetVersion,
      updatedAt: job.updatedAt,
      urgency: job.urgency,
    },
  };
}

function isRecentTerminal(
  operation: OpenMeldToolsUpdateOperation,
  nowMs: number
): boolean {
  if (
    operation.phase !== "updated" &&
    operation.phase !== "restored" &&
    operation.phase !== "needs_help"
  ) {
    return false;
  }
  const updatedAtMs = Date.parse(operation.updatedAt);
  return (
    Number.isFinite(updatedAtMs) &&
    nowMs >= updatedAtMs &&
    nowMs - updatedAtMs <= TERMINAL_VISIBILITY_MS
  );
}
