import {
  getSpaceAccessRequestId,
  type SpaceAccessContext,
} from "@openmeld/space";
import { sleep } from "@openmeld/utils";
import { CORE_LOG_EVENTS } from "../shared/observability/log-events";
import { durableObjectReplacementReason } from "../shared/rpc/durable-object-errors";

// This window limits only recovery. A healthy first read keeps its original lifetime.
const RECOVERY_WINDOW_MS = 10_000;

export async function withSpaceReadRecovery<T>(
  operation: "rpcGetMembers" | "rpcGetMemberDirectory" | "rpcGetWakeProgress",
  access: SpaceAccessContext,
  readWithFreshStub: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await readWithFreshStub();
  } catch (error) {
    const reason = durableObjectReplacementReason(error);
    if (
      !(reason && error && typeof error === "object") ||
      ("overloaded" in error && error.overloaded === true) ||
      ("retryable" in error && error.retryable === false)
    ) {
      throw error;
    }
    const deadline = startedAt + RECOVERY_WINDOW_MS;
    const delay = 50 + Math.floor(Math.random() * 50);
    if (Date.now() + delay >= deadline) {
      throw error;
    }
    await sleep(delay);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw error;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let recovered = false;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(error), remaining);
      });
      const snapshot = await Promise.race([readWithFreshStub(), timeout]);
      if (Date.now() >= deadline) {
        throw error;
      }
      recovered = true;
      return snapshot;
    } finally {
      clearTimeout(timer);
      console.info("[core.space.read_recovery]", {
        event: CORE_LOG_EVENTS.spaceReadRecovery,
        operation,
        reason,
        recovered,
        requestId: getSpaceAccessRequestId(access),
        spaceId: access.spaceId,
        elapsedMs: Date.now() - startedAt,
      });
    }
  }
}
