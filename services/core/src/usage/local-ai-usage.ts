import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { readRuntimeRegistryRecordByRuntimeId } from "../runtime-registry/infrastructure/d1/runtime-registry-repo";
import type { DispatchResultInboxRecord } from "../runtime-transport/infrastructure/d1/dispatch-result-inbox-repo";
import { readRuntimeCoordinatorExecutionProjectionById } from "../runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo";
import { readOwnedDeviceRegistryRecord } from "../start/infrastructure/d1/owned-device-registry-repo";
import { recordAiUsage } from "./ai-usage-repository";

// Called only for an accepted result from the durable result inbox. The local
// process supplies usage, never Organization, Computer, or attribution authority.
export async function recordAcceptedLocalAiUsage(input: {
  db: D1Database;
  identityDb: D1Database;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  inboxRecord: DispatchResultInboxRecord;
}): Promise<void> {
  const { dispatchMessage: message, inboxRecord: inbox } = input;
  const payload = inbox.taskResult.payload;
  const usage = "telemetry" in payload ? payload.telemetry?.aiUsage : undefined;
  if (!usage?.length) {
    return;
  }
  if (
    inbox.dispatchId !== message.dispatchId ||
    inbox.taskId !== message.taskId ||
    inbox.targetProfileId !== message.targetProfileId ||
    !message.organizationId ||
    !inbox.runtimeCoordinatorExecutionId
  ) {
    throw new Error(
      "Local AI usage requires matching accepted execution attribution."
    );
  }
  const execution = await readRuntimeCoordinatorExecutionProjectionById({
    db: input.db,
    runtimeCoordinatorExecutionId: inbox.runtimeCoordinatorExecutionId,
  });
  if (
    !execution ||
    execution.dispatchId !== message.dispatchId ||
    execution.targetProfileId !== message.targetProfileId ||
    execution.spaceId !== message.spaceId
  ) {
    throw new Error("Local AI usage execution attribution is unavailable.");
  }
  const runtime = await readRuntimeRegistryRecordByRuntimeId({
    db: input.identityDb,
    openMeldServiceRuntimeId: execution.openMeldServiceRuntimeId.value,
  });
  if (runtime.status !== "found") {
    throw new Error("Local AI usage Computer attribution is unavailable.");
  }
  const computer = await readOwnedDeviceRegistryRecord({
    db: input.identityDb,
    userId: runtime.record.runtimeLookupInput.owner.id,
    deviceId: runtime.record.runtimeLookupInput.deviceId,
  });
  for (const observation of usage) {
    if (observation.source === "openrouter_response") {
      throw new Error(
        "Local AI usage cannot report platform provider charges."
      );
    }
    await recordAiUsage(input.db, {
      ...observation,
      status: "reported",
      providerRequestId: null,
      organizationId: message.organizationId,
      runtime: "local",
      purpose: "agent",
      agentProfileId: message.targetProfileId,
      spaceId: message.spaceId,
      taskId: message.taskId,
      dispatchId: message.dispatchId,
      attemptId: inbox.attemptId,
      computerId: computer?.connectedComputerId ?? null,
      controller: execution.agentControllerRef,
    });
  }
}
