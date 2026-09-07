import { setTimeout as sleep } from "node:timers/promises";
import type { OpenMeldToolsUpdateOperation } from "@openmeld/schemas/types";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import { readPendingDaemonServiceUpdate } from "../lifecycle/daemon-service-update-state";
import { readPendingOpenMeldToolsUpdateAttempt } from "./openmeld-tools-update-attempt-state";

const DEFAULT_UPDATE_JOIN_POLL_INTERVAL_MS = 500;

export async function resolveExternalOpenMeldToolsUpdate(
  input: OpenMeldPathResolutionInput & {
    currentOperationId?: string | null;
  } = {}
): Promise<OpenMeldToolsUpdateOperation | null> {
  // The coordinator persists the Service job before discarding the tools
  // attempt. Reading in this order prevents observers from seeing a false idle
  // gap while ownership moves from the CLI download to the Service worker.
  const toolsAttempt = await readPendingOpenMeldToolsUpdateAttempt(input);
  const serviceJob = await readPendingDaemonServiceUpdate(input);
  if (serviceJob && serviceJob.jobId !== (input.currentOperationId ?? null)) {
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
    onWaiting?: (
      operation: OpenMeldToolsUpdateOperation
    ) => Promise<void> | void;
    pollIntervalMs?: number;
    allowRecoveryWhileWaitingForWork?: boolean;
  } = {}
): Promise<void> {
  let reportedOperationId: string | null = null;
  while (true) {
    const operation = await resolveExternalOpenMeldToolsUpdate(input);
    if (!operation) {
      return;
    }
    // Reconnect may be what lets the existing Service report safe-to-switch.
    // Actual switching still serializes through the lifecycle lock; never
    // cancel the update or infer safety from an unavailable Service.
    if (
      input.allowRecoveryWhileWaitingForWork &&
      operation.phase === "waiting_for_work"
    ) {
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
