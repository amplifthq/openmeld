import {
  runtimeTransportSessionHistoryRequestSchema,
  sessionHistoryResultSchema,
} from "@openmeld/schemas";
import type {
  DaemonServiceLane,
  SessionHistoryResult,
  SessionHistoryServiceRequest,
} from "@openmeld/schemas/types";
import { callRuntimeTransportApi } from "../dispatch/infrastructure/runtime-transport/runtime-transport-api-client";
import type { CoreBindings } from "../lib/bindings";

export async function requestComputerSessionHistory(input: {
  env: CoreBindings;
  ownerUserId: string;
  deviceId: string;
  runtimeLane: DaemonServiceLane;
  request: SessionHistoryServiceRequest;
}): Promise<SessionHistoryResult> {
  const body = runtimeTransportSessionHistoryRequestSchema.parse({
    v: 1,
    ownerUserId: input.ownerUserId,
    deviceId: input.deviceId,
    lane: input.runtimeLane,
    requestId: crypto.randomUUID(),
    request: input.request,
  });
  const response = await callRuntimeTransportApi({
    body,
    env: input.env,
    ownerUserId: input.ownerUserId,
    path: "/session-history",
  });
  const parsed = sessionHistoryResultSchema.safeParse(response);
  return parsed.success
    ? parsed.data
    : {
        kind: "error",
        code: "unavailable",
        message:
          "Session history is unavailable. Check the Computer connection.",
      };
}
