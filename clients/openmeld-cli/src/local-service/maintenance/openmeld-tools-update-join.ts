import { setTimeout as sleep } from "node:timers/promises";
import type { OpenMeldToolsUpdateOperation } from "@openmeld/schemas/types";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import { readPendingDaemonServiceUpdate } from "../lifecycle/daemon-service-update-state";
import { readPendingOpenMeldToolsUpdateAttempt } from "./openmeld-tools-update-attempt-state";
import { resolveOpenMeldToolsUpdateOperation } from "./openmeld-tools-update-operation";

const DEFAULT_UPDATE_JOIN_POLL_INTERVAL_MS = 500;

// This is an observer of the existing durable operation, never an updater.
// The OS-owned worker continues even if this caller exits while waiting.
export async function waitForOpenMeldToolsUpdateCompletion(
  input: {
    operationId?: string;
    pollIntervalMs?: number;
    onWaiting?: (
      operation: OpenMeldToolsUpdateOperation
    ) => Promise<void> | void;
  } = {}
): Promise<OpenMeldToolsUpdateOperation | null> {
  let operationId = input.operationId ?? null;
  await waitForExternalOpenMeldToolsUpdate({
    completedServiceUpdateIsIdle: true,
    pollIntervalMs: input.pollIntervalMs,
    onWaiting: async (operation) => {
      if (operationId !== null && operationId !== operation.operationId) {
        throw new Error(
          `OpenMeld update ${operationId} was replaced before its completion could be verified.`
        );
      }
      operationId = operation.operationId;
      await input.onWaiting?.(operation);
    },
  });
  const completed = await resolveOpenMeldToolsUpdateOperation();
  if (
    operationId !== null &&
    (completed?.operationId !== operationId || completed.phase !== "updated")
  ) {
    throw new Error(
      `OpenMeld update ${operationId} did not finish successfully (${completed?.phase ?? "completion evidence unavailable"}).`
    );
  }
  return completed;
}

export async function resolveExternalOpenMeldToolsUpdate(
  input: OpenMeldPathResolutionInput & {
    currentOperationId?: string | null;
    completedServiceUpdateIsIdle?: boolean;
  } = {}
): Promise<OpenMeldToolsUpdateOperation | null> {
  // The coordinator persists the Service job before discarding the tools
  // attempt. Reading in this order prevents observers from seeing a false idle
  // gap while ownership moves from the CLI download to the Service worker.
  const toolsAttempt = await readPendingOpenMeldToolsUpdateAttempt(input);
  const serviceJob = await readPendingDaemonServiceUpdate(input);
  if (
    serviceJob &&
    serviceJob.jobId !== (input.currentOperationId ?? null) &&
    !(input.completedServiceUpdateIsIdle && serviceJob.phase === "updated")
  ) {
    return {
      operationId: serviceJob.jobId,
      phase: serviceJob.phase,
      requestSource: serviceJob.requestSource,
      requestedAt: serviceJob.requestedAt,
      targetVersion: serviceJob.targetVersion,
      updatedAt: serviceJob.updatedAt,
      urgency: serviceJob.urgency,
    };
  }
  if (
    toolsAttempt &&
    toolsAttempt.operation.operationId !== (input.currentOperationId ?? null)
  ) {
    return toolsAttempt.operation;
  }
  return null;
}

export async function waitForExternalOpenMeldToolsUpdate(
  input: OpenMeldPathResolutionInput & {
    currentOperationId?: string | null;
    completedServiceUpdateIsIdle?: boolean;
    onWaiting?: (
      operation: OpenMeldToolsUpdateOperation
    ) => Promise<void> | void;
    pollIntervalMs?: number;
  } = {}
): Promise<void> {
  let reportedOperationId: string | null = null;
  while (true) {
    const operation = await resolveExternalOpenMeldToolsUpdate(input);
    if (!operation) {
      return;
    }
    if (reportedOperationId !== operation.operationId) {
      reportedOperationId = operation.operationId;
      await input.onWaiting?.(operation);
    }
    await sleep(
      Math.max(1, input.pollIntervalMs ?? DEFAULT_UPDATE_JOIN_POLL_INTERVAL_MS)
    );
  }
}
