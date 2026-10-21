import { WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE } from "@openmeld/schemas";
import type { WakeProgressWaitReasonCode } from "@openmeld/schemas/types";

/**
 * The Wake progress wait reason for a Service `localQueue` lifecycle payload.
 * A task queued behind another task in its folder has not started, so Web
 * must not show it as working.
 */
export function resolveWakeProgressLocalQueueWaitReasonCode(
  localQueue: unknown
): WakeProgressWaitReasonCode | null {
  if (!localQueue || typeof localQueue !== "object") {
    return null;
  }
  const queue = localQueue as { status?: unknown; waitReason?: unknown };
  return queue.status === "queued" && queue.waitReason === "workspace_conflict"
    ? WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE
    : null;
}
