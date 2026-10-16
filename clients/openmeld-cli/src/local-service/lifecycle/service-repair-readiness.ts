import type { CurrentLocalRuntimeReplyReadinessResponse } from "@openmeld/schemas/types";
import { readCurrentLocalRuntimeReplyReadiness } from "../../system/current-local-runtime-reply-readiness";
import {
  requestLocalDaemonServiceUpdateReadiness,
  sendLocalDaemonControlPlaneRequest,
} from "../control-plane/client";

// Process existence proves ownership, not that the carrier and Host can work.
export async function isRunningServiceRepairHealthy(input: {
  deviceId: string;
  runtimeLane: string;
  gatewayUrl: string;
}): Promise<boolean> {
  const [health, readiness] = await Promise.all([
    sendLocalDaemonControlPlaneRequest({
      request: { v: 1, command: "health" },
      timeoutMs: 3000,
    }),
    readCurrentLocalRuntimeReplyReadiness({ gatewayUrl: input.gatewayUrl }),
    requestLocalDaemonServiceUpdateReadiness({ timeoutMs: 3000 }),
  ]);
  return (
    health.code === "service.health" &&
    health.payload.state === "ok" &&
    isServiceRepairReadinessCurrent({ ...input, readiness })
  );
}

export function isServiceRepairReadinessCurrent(input: {
  deviceId: string;
  runtimeLane: string;
  readiness: Pick<
    CurrentLocalRuntimeReplyReadinessResponse,
    "currentTarget" | "service"
  >;
}): boolean {
  const { readiness } = input;
  const host = readiness.service.executionHost;
  return (
    readiness.currentTarget.availability === "resolved" &&
    readiness.currentTarget.deviceId === input.deviceId &&
    readiness.currentTarget.runtimeLane === input.runtimeLane &&
    readiness.service.connected &&
    readiness.service.matchingCurrentRuntime &&
    readiness.service.sessionDeviceId === input.deviceId &&
    readiness.service.sessionLane === input.runtimeLane &&
    readiness.service.executionCompatibility?.status === "compatible" &&
    host?.responsive === true &&
    host.admission === "open" &&
    host.startupReplayPending === false
  );
}
