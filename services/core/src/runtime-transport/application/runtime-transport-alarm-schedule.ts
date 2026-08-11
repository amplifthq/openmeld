import { resolveNextLeaseCleanupAtMs } from "./runtime-transport-session-service";
import type { RuntimeTransportMutableState } from "./runtime-transport-state";
import { resolveNextDispatchCleanupAtMs } from "./runtime-transport-wait-service";

export const resolveNextRuntimeTransportAlarmAtMs = (
  state: RuntimeTransportMutableState
): number | null => {
  const nextLeaseCleanupAtMs = resolveNextLeaseCleanupAtMs(state);
  const nextDispatchCleanupAtMs = resolveNextDispatchCleanupAtMs(state);

  if (nextLeaseCleanupAtMs === null) {
    return nextDispatchCleanupAtMs;
  }
  if (nextDispatchCleanupAtMs === null) {
    return nextLeaseCleanupAtMs;
  }
  return Math.min(nextLeaseCleanupAtMs, nextDispatchCleanupAtMs);
};

export const reconcileRuntimeTransportAlarmAtMs = (input: {
  nowMs: number;
  nextRequiredAlarmAtMs: number | null;
  scheduledAlarmAtMs: number | null;
}):
  | {
      kind: "keep";
      alarmAtMs: number | null;
    }
  | {
      kind: "delete";
    }
  | {
      kind: "set";
      alarmAtMs: number;
    } => {
  const normalizedNextRequiredAlarmAtMs =
    typeof input.nextRequiredAlarmAtMs === "number"
      ? Math.max(input.nowMs, Math.trunc(input.nextRequiredAlarmAtMs))
      : null;

  if (normalizedNextRequiredAlarmAtMs === null) {
    return input.scheduledAlarmAtMs === null
      ? {
          kind: "keep",
          alarmAtMs: null,
        }
      : {
          kind: "delete",
        };
  }

  if (
    typeof input.scheduledAlarmAtMs === "number" &&
    input.scheduledAlarmAtMs <= normalizedNextRequiredAlarmAtMs
  ) {
    return {
      kind: "keep",
      alarmAtMs: input.scheduledAlarmAtMs,
    };
  }

  return {
    kind: "set",
    alarmAtMs: normalizedNextRequiredAlarmAtMs,
  };
};
