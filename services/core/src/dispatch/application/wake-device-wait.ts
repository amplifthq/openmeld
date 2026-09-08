import {
  resolveAgentWakeAdmissionBlockReasonCode,
  resolveAgentWakeAvailability,
} from "@openmeld/agent-runtime";
import { wakeDeviceWaitAccessResponseSchema } from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  RuntimeTransportRuntimeCoordinatorHeadWaitingReasonCode,
  WakeDeviceWait,
} from "@openmeld/schemas/types";
import type { CoreAgentExecutionReadiness } from "../../agent-execution/application/agent-execution-readiness-service";
import type { CoreBindings } from "../../lib/bindings";
import { resolveSpaceStub } from "../../rpc/space-ref";

export function deviceWaitTargetMatches(input: {
  wait: WakeDeviceWait;
  targetProfileId: string;
  bindingId: string | null;
  openMeldServiceRuntimeId: string | null;
  runtimeKind: string | null;
}): boolean {
  return (
    input.runtimeKind === "openmeld_service" &&
    input.wait.targetProfileId === input.targetProfileId &&
    input.wait.bindingId === input.bindingId &&
    input.wait.openMeldServiceRuntimeId === input.openMeldServiceRuntimeId
  );
}

export function resolveDeviceWaitReason(
  readiness: CoreAgentExecutionReadiness
): RuntimeTransportRuntimeCoordinatorHeadWaitingReasonCode | null {
  const availability = resolveAgentWakeAvailability({
    agentControllerRef: readiness.agentControllerRef,
    agentWakeRouteRegistration: readiness.agentWakeRouteRegistration,
    readiness: readiness.agentExecutionReadiness,
    wakeRouteStatus: readiness.wakeRouteStatus,
  });
  if (
    (availability.category === "offline" && !availability.isRefreshing) ||
    (availability.reasonCode === "local_service.reconnecting" &&
      readiness.wakeRouteStatus.status === "offline")
  ) {
    return "daemon.profile.offline";
  }
  if (
    availability.category === "checking" &&
    readiness.agentWakeRouteRegistration.status === "pending"
  ) {
    return "daemon.profile.pending_first_report";
  }
  if (
    (availability.category === "checking" && availability.isRefreshing) ||
    resolveAgentWakeAdmissionBlockReasonCode(
      readiness.agentExecutionReadiness
    ) === "usage_checking"
  ) {
    return "wake.device_wait.readiness_checking";
  }
  return null;
}

export async function checkDeviceWaitingWakeAccess(input: {
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<boolean> {
  const stub = resolveSpaceStub(
    input.env.OPENMELD_SPACES,
    input.message.spaceId
  );
  if (!stub) {
    throw new Error("Device waiting Wake access could not be checked.");
  }
  const result = wakeDeviceWaitAccessResponseSchema.safeParse(
    await stub.rpcCheckDeviceWaitingWakeAccess({
      spaceId: input.message.spaceId,
      dispatchId: input.message.dispatchId,
      sourceSignalId: input.message.sourceEventId,
      targetProfileId: input.message.targetProfileId,
    })
  );
  if (!result.success) {
    throw new Error("Device waiting Wake access returned invalid evidence.");
  }
  return result.data.allowed;
}
