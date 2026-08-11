import type { DispatchIdempotencyInput as DispatchIdempotencyInputShared } from "@openmeld/agent-runtime";
import {
  buildIdempotencyKey as buildIdempotencyKeyShared,
  DEFAULT_AGENT_EXECUTION_TIMEOUT_MS,
  DEFAULT_IDEMPOTENCY_WINDOW_MS,
  shouldDedupeWithinWindow as shouldDedupeWithinWindowShared,
} from "@openmeld/agent-runtime";
import type { OpenMeldDaemonDispatchDeliveryRecoveryReason } from "@openmeld/schemas/types";

const DEDUPE_WINDOW_MS = DEFAULT_IDEMPOTENCY_WINDOW_MS;

export type DispatchIdempotencyInput = DispatchIdempotencyInputShared;

export const buildIdempotencyKey = buildIdempotencyKeyShared;

const REQUIRED_OBSERVABILITY_FIELDS = [
  "ts",
  "level",
  "component",
  "code",
  "message",
  "runId",
  "bindingKey",
  "taskId",
  "eventId",
  "errorType",
] as const;

export type DataPlaneObservabilityEntry = Record<string, unknown>;

export type DedupeWindowInput = {
  firstSeenAtMs: number;
  nowMs: number;
  windowMs?: number;
};

export type BindingDispatchRecord = {
  bindingKey: string;
  sequence: number;
};

export const shouldDedupeWithinWindow = (input: DedupeWindowInput): boolean => {
  return shouldDedupeWithinWindowShared({
    firstSeenAtMs: input.firstSeenAtMs,
    nowMs: input.nowMs,
    ...(typeof input.windowMs === "number" ? { windowMs: input.windowMs } : {}),
  });
};

export const shouldBypassDedupeForDeliveryRecoveryReason = (
  reason?: OpenMeldDaemonDispatchDeliveryRecoveryReason | null
): boolean => {
  return reason === "connection_replaced" || reason === "route_lost";
};

export const assertSameBindingFifo = (
  dispatches: BindingDispatchRecord[]
): boolean => {
  const latestByBinding = new Map<string, number>();
  for (const dispatch of dispatches) {
    const latest = latestByBinding.get(dispatch.bindingKey);
    if (latest !== undefined && dispatch.sequence < latest) {
      return false;
    }
    latestByBinding.set(dispatch.bindingKey, dispatch.sequence);
  }
  return true;
};

export const hasRequiredObservabilityFields = (
  entry: DataPlaneObservabilityEntry
): boolean => {
  for (const field of REQUIRED_OBSERVABILITY_FIELDS) {
    const value = entry[field];
    if (typeof value !== "string" || value.length === 0) {
      return false;
    }
  }
  return true;
};

export const DATA_PLANE_DEFAULTS = {
  dedupeWindowMs: DEDUPE_WINDOW_MS,
  globalConcurrency: 4,
  perBindingQueue: 32,
  timeoutMs: DEFAULT_AGENT_EXECUTION_TIMEOUT_MS,
  backoffMs: [1000, 2000, 5000, 10_000, 30_000],
} as const;
