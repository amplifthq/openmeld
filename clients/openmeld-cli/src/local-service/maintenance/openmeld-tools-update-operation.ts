import type {
  DaemonServiceUpdateJob,
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

const TERMINAL_VISIBILITY_MS = 24 * 60 * 60 * 1000;

export async function resolveOpenMeldToolsUpdateOperation(
  pathInput: OpenMeldPathResolutionInput = {},
  nowMs = Date.now()
): Promise<OpenMeldToolsUpdateOperation | null> {
  const [servicePending, toolsPending] = await Promise.all([
    readPendingDaemonServiceUpdate(pathInput),
    readPendingOpenMeldToolsUpdateAttempt(pathInput),
  ]);
  if (servicePending) {
    return projectServiceJob(servicePending);
  }
  if (toolsPending) {
    return toolsPending.operation;
  }

  const [serviceLast, toolsLast] = await Promise.all([
    readLastDaemonServiceUpdate(pathInput),
    readLastOpenMeldToolsUpdateAttempt(pathInput),
  ]);
  const candidates = [
    ...(serviceLast ? [projectServiceJob(serviceLast)] : []),
    ...(toolsLast ? [toolsLast.operation] : []),
  ]
    .filter((operation) => isRecentTerminal(operation, nowMs))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return candidates[0] ?? null;
}

function projectServiceJob(
  job: DaemonServiceUpdateJob
): OpenMeldToolsUpdateOperation {
  return {
    operationId: job.jobId,
    phase: job.phase,
    requestSource: job.requestSource,
    requestedAt: job.requestedAt,
    targetVersion: job.targetVersion,
    updatedAt: job.updatedAt,
    urgency: job.urgency,
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
