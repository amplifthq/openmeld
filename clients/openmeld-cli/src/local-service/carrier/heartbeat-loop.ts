import type { RuntimeTransportHeartbeatResponse } from "@openmeld/schemas/types";
import type { PendingFrameWaiters } from "../core/types";
import { DaemonServiceRunError } from "../core/types";

export function waitForHeartbeatResponse(input: {
  timeoutMs: number;
  waiters: PendingFrameWaiters;
}): Promise<RuntimeTransportHeartbeatResponse> {
  // OPENMELD_SERVICE_THIN_CORE: heartbeat acknowledgement.
  // Heartbeat keeps the local carrier observable and lease-aware. It is local
  // liveness evidence, not a Space or AgentExecutionReadiness verdict.
  if (input.waiters.heartbeatResolver || input.waiters.heartbeatRejecter) {
    return Promise.reject(
      new DaemonServiceRunError({
        code: "daemon.run.heartbeat_response_busy",
        message: "heartbeat response waiter is already pending",
      })
    );
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      input.waiters.heartbeatResolver = null;
      input.waiters.heartbeatRejecter = null;
      reject(
        new DaemonServiceRunError({
          code: "daemon.run.heartbeat_timeout",
          message: "heartbeat response timeout",
        })
      );
    }, input.timeoutMs);

    input.waiters.heartbeatResolver = (payload) => {
      clearTimeout(timeout);
      input.waiters.heartbeatRejecter = null;
      resolve(payload);
    };
    input.waiters.heartbeatRejecter = (error) => {
      clearTimeout(timeout);
      input.waiters.heartbeatResolver = null;
      input.waiters.heartbeatRejecter = null;
      reject(error);
    };
  });
}
