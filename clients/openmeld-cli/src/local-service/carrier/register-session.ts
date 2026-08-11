import type { RuntimeTransportRegisterSessionResponse } from "@openmeld/schemas/types";
import type { PendingFrameWaiters } from "../core/types";
import { DaemonServiceRunError } from "../core/types";

export function waitForRegisterResponse(input: {
  timeoutMs: number;
  waiters: PendingFrameWaiters;
}): Promise<RuntimeTransportRegisterSessionResponse> {
  // OPENMELD_SERVICE_THIN_CORE: registration acknowledgement.
  // Registration proves this daemon stream was accepted for its current
  // account/device/lane route catalog. It is not final Agent readiness.
  if (input.waiters.registerResolver || input.waiters.registerRejecter) {
    return Promise.reject(
      new DaemonServiceRunError({
        code: "daemon.run.register_response_busy",
        message: "register response waiter is already pending",
      })
    );
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      input.waiters.registerResolver = null;
      input.waiters.registerRejecter = null;
      reject(
        new DaemonServiceRunError({
          code: "daemon.run.register_timeout",
          message: "register response timeout",
        })
      );
    }, input.timeoutMs);

    input.waiters.registerResolver = (payload) => {
      clearTimeout(timeout);
      input.waiters.registerRejecter = null;
      resolve(payload);
    };
    input.waiters.registerRejecter = (error) => {
      clearTimeout(timeout);
      input.waiters.registerResolver = null;
      input.waiters.registerRejecter = null;
      reject(error);
    };
  });
}
