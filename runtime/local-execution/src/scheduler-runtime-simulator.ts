import type { OpenMeldDaemonHealthPayload } from "@openmeld/schemas";
import { openMeldDaemonHealthPayloadSchema } from "@openmeld/schemas";
import {
  type BindingDispatchRecord,
  buildIdempotencyKey,
  hasRequiredObservabilityFields,
  shouldDedupeWithinWindow,
} from "./data-plane-contract.js";
import {
  type ExternalHealthState,
  isHealthReasonCodeConsistent,
  mapRuntimeHealthToExternalHealth,
  type RuntimeHealthState,
  resolveHealthReasonCode,
} from "./heartbeat-policy.js";
import { resolveRuntimeHeartbeatHealthFinding } from "./runtime-health-invariant-policy.js";
import { emitRuntimeHealthFinding } from "./runtime-health-view.js";
import {
  INITIAL_SCHEDULER_STATE,
  type SchedulerPriority,
  type SchedulerState,
  type SchedulerTask,
  selectNextTask,
} from "./scheduler-policy.js";

export type SchedulerRuntimeTask = SchedulerTask & {
  spaceId: string;
  sourceEventId: string;
  agentId: string;
};

export type SchedulerRuntimeResult = {
  dispatches: BindingDispatchRecord[];
  dispatchPriorities: SchedulerPriority[];
  duplicateReplyCount: number;
  duplicateSuppressedCount: number;
  healthPayload: OpenMeldDaemonHealthPayload;
  logs: Record<string, string>[];
  processedTaskIds: string[];
};

export type SchedulerRuntimeSimulationInput = {
  dedupeWindowMs?: number;
  initialSchedulerState?: SchedulerState;
  startTimeMs: number;
  tasks: SchedulerRuntimeTask[];
};

type SchedulerRuntimeLabels = {
  invalidHealthMessage: string;
  invalidObservabilityMessage: string;
  runIdPrefix: string;
  inconsistentHealthMessage: string;
};

const SCHEDULER_RUNTIME_LABELS: SchedulerRuntimeLabels = {
  invalidHealthMessage: "runtime simulation produced invalid health payload",
  invalidObservabilityMessage:
    "runtime simulation emitted invalid observability log entry",
  runIdPrefix: "scheduler",
  inconsistentHealthMessage:
    "runtime simulation produced inconsistent health reason code",
};

const buildLogEntry = (input: {
  deduped: boolean;
  runId: string;
  task: SchedulerRuntimeTask;
  timestampMs: number;
}): Record<string, string> => ({
  ts: new Date(input.timestampMs).toISOString(),
  level: "info",
  component: "openMeldDaemon",
  code: input.deduped ? "task.deduped" : "task.dispatched",
  message: input.deduped ? "deduped duplicate task" : "task dispatched",
  runId: input.runId,
  bindingKey: input.task.bindingKey,
  taskId: input.task.taskId,
  eventId: input.task.sourceEventId,
  errorType: input.deduped ? "policy" : "none",
});

const resolveRuntimeState = (input: {
  dispatchedCount: number;
  duplicateReplyCount: number;
  pendingTaskCount: number;
}): RuntimeHealthState => {
  if (input.pendingTaskCount > 0) {
    return "down";
  }
  if (input.duplicateReplyCount > 0) {
    return "suspect";
  }
  return input.dispatchedCount > 0 ? "healthy" : "idle";
};

const buildHealthPayloadOrThrow = (input: {
  checkedAtIso: string;
  externalState: ExternalHealthState;
  invalidHealthMessage: string;
  reasonCode: string;
  runtimeState: RuntimeHealthState;
}): OpenMeldDaemonHealthPayload => {
  const healthPayloadResult = openMeldDaemonHealthPayloadSchema.safeParse({
    state: input.externalState,
    runtimeState: input.runtimeState,
    reasonCode: input.reasonCode,
    checkedAt: input.checkedAtIso,
  });
  if (!healthPayloadResult.success) {
    throw new Error(input.invalidHealthMessage);
  }
  return healthPayloadResult.data;
};

const emitSchedulerHeartbeatHealthFinding = (input: {
  checkedAtIso: string;
  dispatchCount: number;
  duplicateReplyCount: number;
  externalState: ExternalHealthState;
  pendingTaskCount: number;
  processedTaskCount: number;
  reasonCode: string;
  runId: string;
  runtimeState: RuntimeHealthState;
}): void => {
  const heartbeatFinding = resolveRuntimeHeartbeatHealthFinding({
    externalState: input.externalState,
    humanContext: {
      checkedAt: input.checkedAtIso,
      dispatchCount: input.dispatchCount,
      duplicateReplyCount: input.duplicateReplyCount,
      pendingTaskCount: input.pendingTaskCount,
      processedTaskCount: input.processedTaskCount,
      runId: input.runId,
    },
    runtimeState: input.runtimeState,
  });
  if (!heartbeatFinding) {
    return;
  }
  emitRuntimeHealthFinding({
    eventName: "[runtime.openMeldDaemon.health.heartbeat_unhealthy]",
    fields: {
      checkedAt: input.checkedAtIso,
      externalState: input.externalState,
      reasonCode: input.reasonCode,
      runtimeState: input.runtimeState,
    },
    finding: heartbeatFinding,
  });
};

export const runSchedulerRuntimeSimulation = (input: {
  dedupeWindowMs?: number;
  initialSchedulerState?: SchedulerState;
  startTimeMs: number;
  tasks: SchedulerRuntimeTask[];
}): SchedulerRuntimeResult =>
  runSimulationWithLabels(input, SCHEDULER_RUNTIME_LABELS);

const runSimulationWithLabels = (
  input: SchedulerRuntimeSimulationInput,
  labels: SchedulerRuntimeLabels
): SchedulerRuntimeResult => {
  const dedupeFirstSeenAt = new Map<string, number>();
  const emittedReplyCountByIdempotencyKey = new Map<string, number>();
  const queue = [...input.tasks];
  const dispatches: BindingDispatchRecord[] = [];
  const dispatchPriorities: SchedulerPriority[] = [];
  const logs: Record<string, string>[] = [];
  const processedTaskIds: string[] = [];

  let duplicateReplyCount = 0;
  let duplicateSuppressedCount = 0;
  let nowMs = input.startTimeMs;
  let state = input.initialSchedulerState ?? INITIAL_SCHEDULER_STATE;

  while (queue.length > 0) {
    const selected = selectNextTask({
      pendingTasks: queue,
      nowMs,
      state,
    });
    if (!selected) {
      break;
    }

    const task = selected.task as SchedulerRuntimeTask;
    processedTaskIds.push(task.taskId);

    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: task.sourceEventId,
      targetProfileId: task.agentId,
    });

    const firstSeenAtMs = dedupeFirstSeenAt.get(idempotencyKey);
    const deduped =
      firstSeenAtMs !== undefined &&
      shouldDedupeWithinWindow({
        firstSeenAtMs,
        nowMs,
        ...(input.dedupeWindowMs ? { windowMs: input.dedupeWindowMs } : {}),
      });

    if (firstSeenAtMs === undefined) {
      dedupeFirstSeenAt.set(idempotencyKey, nowMs);
    }

    if (deduped) {
      duplicateSuppressedCount += 1;
    } else {
      dispatches.push({
        bindingKey: task.bindingKey,
        sequence: task.sequence,
      });
      dispatchPriorities.push(selected.effectivePriority);
    }

    const emittedReply = !deduped;
    if (emittedReply) {
      const emittedCount =
        emittedReplyCountByIdempotencyKey.get(idempotencyKey) ?? 0;
      if (emittedCount > 0) {
        duplicateReplyCount += 1;
      }
      emittedReplyCountByIdempotencyKey.set(idempotencyKey, emittedCount + 1);
    }

    const logEntry = buildLogEntry({
      deduped,
      runId: `${labels.runIdPrefix}-${input.startTimeMs}`,
      task,
      timestampMs: nowMs,
    });
    if (!hasRequiredObservabilityFields(logEntry)) {
      throw new Error(labels.invalidObservabilityMessage);
    }
    logs.push(logEntry);

    const removeIndex = queue.findIndex((item) => item.taskId === task.taskId);
    if (removeIndex < 0) {
      throw new Error("selected task not found in simulation queue");
    }
    queue.splice(removeIndex, 1);

    state = selected.nextState;
    nowMs += 1000;
  }

  const runtimeState = resolveRuntimeState({
    dispatchedCount: dispatches.length,
    duplicateReplyCount,
    pendingTaskCount: queue.length,
  });
  const externalState = mapRuntimeHealthToExternalHealth(runtimeState);
  const reasonCode = resolveHealthReasonCode(runtimeState);
  const checkedAtIso = new Date(nowMs).toISOString();

  if (
    !isHealthReasonCodeConsistent({
      runtimeState,
      externalState,
      reasonCode,
    })
  ) {
    throw new Error(labels.inconsistentHealthMessage);
  }
  const healthPayload = buildHealthPayloadOrThrow({
    checkedAtIso,
    externalState,
    invalidHealthMessage: labels.invalidHealthMessage,
    reasonCode,
    runtimeState,
  });
  emitSchedulerHeartbeatHealthFinding({
    checkedAtIso: healthPayload.checkedAt,
    dispatchCount: dispatches.length,
    duplicateReplyCount,
    externalState,
    pendingTaskCount: queue.length,
    processedTaskCount: processedTaskIds.length,
    reasonCode,
    runId: `${labels.runIdPrefix}-${input.startTimeMs}`,
    runtimeState,
  });

  return {
    dispatches,
    dispatchPriorities,
    duplicateReplyCount,
    duplicateSuppressedCount,
    healthPayload,
    logs,
    processedTaskIds,
  };
};
