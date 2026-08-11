import { RUNTIME_TRANSPORT_SCHEMA_VERSION } from "@openmeld/schemas";
import type {
  RuntimeTransportRuntimeCoordinatorHeadWaitingRequest,
  RuntimeTransportRuntimeCoordinatorHeadWaitingResponse,
} from "@openmeld/schemas/types";
import {
  planRuntimeCoordinatorHeadAcceptedHandoffAlarmWork,
  type RuntimeCoordinatorHeadLifecycleRecord,
} from "./runtime-coordinator-authority";

export type RuntimeCoordinatorHeadAcceptedHandoffAlarmPorts = {
  readRecords: () => Promise<RuntimeCoordinatorHeadLifecycleRecord[]>;
  recordHeadWaitingBoundary: (
    request: RuntimeTransportRuntimeCoordinatorHeadWaitingRequest
  ) => Promise<RuntimeTransportRuntimeCoordinatorHeadWaitingResponse>;
  reserveWorkUnit: () => boolean;
};

export const processRuntimeCoordinatorHeadAcceptedHandoffAlarm = async (input: {
  nowMs: number;
  ports: RuntimeCoordinatorHeadAcceptedHandoffAlarmPorts;
}): Promise<void> => {
  const records = await input.ports.readRecords();
  const workItems = planRuntimeCoordinatorHeadAcceptedHandoffAlarmWork({
    nowMs: input.nowMs,
    records,
  });
  for (const record of workItems) {
    if (!input.ports.reserveWorkUnit()) {
      break;
    }
    await input.ports.recordHeadWaitingBoundary({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: record.primaryDispatchId,
      idempotencyKey: record.primaryIdempotencyKey,
      observedAtMs: input.nowMs,
      ownerUserId: record.ownerUserId,
      reasonCode: "daemon.profile.offline",
      targetWakeLifecycleIdentity: record.targetWakeLifecycleIdentity,
      userRecoveryAction: "start_or_restart_openmeld_service",
      waitingCategory: "service_not_connected",
    });
  }
};
