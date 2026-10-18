import { setTimeout as sleep } from "node:timers/promises";
import type {
  OpenMeldDaemonServiceUpdateReadinessPayload,
  OpenMeldToolsUpdateOperation,
} from "@openmeld/schemas/types";
import {
  type OpenMeldPathResolutionInput,
  resolveOpenMeldRootDir,
} from "../../config/paths";
import { requestLocalDaemonServiceUpdateReadiness } from "../control-plane/client";
import { readPendingDaemonServiceUpdate } from "../lifecycle/daemon-service-update-state";
import { readPendingOpenMeldToolsUpdateAttempt } from "./openmeld-tools-update-attempt-state";
import { resolveOpenMeldToolsUpdateOperation } from "./openmeld-tools-update-operation";

const DEFAULT_UPDATE_JOIN_POLL_INTERVAL_MS = 500;

// This is an observer of the existing durable operation, never an updater.
// The OS-owned worker continues even if this caller exits while waiting.
export async function waitForOpenMeldToolsUpdateCompletion(
  input: {
    operationId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    onWaiting?: (
      operation: OpenMeldToolsUpdateOperation
    ) => Promise<void> | void;
    onObservation?: (
      operation: OpenMeldToolsUpdateOperation,
      readiness: OpenMeldDaemonServiceUpdateReadinessPayload | null
    ) => void;
  } = {}
): Promise<OpenMeldToolsUpdateOperation | null> {
  let operationId = input.operationId ?? null;
  await waitForExternalOpenMeldToolsUpdate({
    completedServiceUpdateIsIdle: true,
    timeoutMs: input.timeoutMs,
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
    onObservation: input.onObservation,
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
      ...(serviceJob.targetCliVersion
        ? { targetCliVersion: serviceJob.targetCliVersion }
        : {}),
      ...(serviceJob.targetServiceVersion
        ? { targetServiceVersion: serviceJob.targetServiceVersion }
        : {}),
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
    unclaimedTimeoutMs?: number;
    timeoutMs?: number;
    onObservation?: (
      operation: OpenMeldToolsUpdateOperation,
      readiness: OpenMeldDaemonServiceUpdateReadinessPayload | null
    ) => void;
  } = {}
): Promise<void> {
  let reportedOperation: string | null = null;
  const deadline = Date.now() + (input.timeoutMs ?? Number.POSITIVE_INFINITY);
  let unclaimedSince: number | null = null;
  while (true) {
    const operation = await resolveExternalOpenMeldToolsUpdate(input);
    if (!operation) {
      return;
    }
    assertUpdateObservationActive(deadline);
    if (input.onObservation) {
      // Reuse the Service's public local control projection. Required updates
      // enter `updating` before drain, so the durable phase alone cannot say
      // whether accepted work still owns the wait. This read never extends
      // the observer deadline or reserves the setup mutation lock.
      const readiness = await readUpdateWorkReadiness(operation, input);
      input.onObservation(operation, readiness);
    }
    if (input.unclaimedTimeoutMs !== undefined) {
      const pending = await readPendingOpenMeldToolsUpdateAttempt(input);
      if (
        pending?.operation.operationId === operation.operationId &&
        pending.attempts === 0
      ) {
        unclaimedSince ??= Date.now();
        if (Date.now() - unclaimedSince >= input.unclaimedTimeoutMs) {
          throw new Error(
            "OpenMeld's background updater did not start. Run openmeld doctor to check the background service, then try setup again."
          );
        }
      } else {
        unclaimedSince = null;
      }
    }
    const observationKey = `${operation.operationId}:${operation.phase}`;
    if (reportedOperation !== observationKey) {
      reportedOperation = observationKey;
      await input.onWaiting?.(operation);
    }
    await sleep(
      Math.max(1, input.pollIntervalMs ?? DEFAULT_UPDATE_JOIN_POLL_INTERVAL_MS)
    );
  }
}

function assertUpdateObservationActive(deadline: number): void {
  if (Date.now() >= deadline) {
    throw new Error(
      "OpenMeld is still waiting for the background update. Current tasks and the update continue. Check their status, then try connecting again."
    );
  }
}

async function readUpdateWorkReadiness(
  operation: OpenMeldToolsUpdateOperation,
  input: OpenMeldPathResolutionInput
) {
  // The local control client is bound to this process's lane. Never query a
  // different Service while inspecting another root's durable update files.
  if (resolveOpenMeldRootDir(input) !== resolveOpenMeldRootDir()) {
    return null;
  }
  const pending = await readPendingDaemonServiceUpdate(input);
  if (
    pending?.jobId !== operation.operationId ||
    (pending.phase !== "updating" && pending.phase !== "waiting_for_work")
  ) {
    return null;
  }
  return await requestLocalDaemonServiceUpdateReadiness({
    timeoutMs: 2000,
  }).catch(() => null);
}
