import type { AdapterDispatchTelemetry } from "@openmeld/adapter-core";
import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas";
import type {
  OpenMeldDaemonProviderAccessEvidence,
  RuntimeTransportMode,
} from "@openmeld/schemas/types";
import {
  type OpenMeldDaemonInflightTaskState,
  type OpenMeldDaemonLedgerStateV1,
  settleInflightTask,
} from "./ledger-store.js";

export type TaskResultErrorType =
  | "config"
  | "network"
  | "adapter"
  | "policy"
  | "timeout"
  | "internal"
  | "auth";

export const COMPENSATION_DELAYS_MS = [5000, 15_000, 30_000] as const;

export type RecoveryRuntimeState = "idle" | "recovering";

export type RecoveryReplayCandidate = OpenMeldDaemonInflightTaskState & {
  replayAttempt: 1;
};

export type CompensationStep = {
  attempt: 1 | 2 | 3;
  delayMs: number;
};

const cloneLedgerState = (
  state: OpenMeldDaemonLedgerStateV1
): OpenMeldDaemonLedgerStateV1 => ({
  dedupeFirstSeenByKey: { ...state.dedupeFirstSeenByKey },
  inflightByTaskId: Object.fromEntries(
    Object.entries(state.inflightByTaskId).map(([taskId, inflight]) => [
      taskId,
      {
        ...inflight,
      },
    ])
  ),
  replayedTaskIds: { ...state.replayedTaskIds },
  agentContextByLookupKey: Object.fromEntries(
    Object.entries(state.agentContextByLookupKey).map(
      ([agentContextLookupKey, session]) => [
        agentContextLookupKey,
        {
          ...session,
        },
      ]
    )
  ),
  bootstrapExecutionByLookupKey: Object.fromEntries(
    Object.entries(state.bootstrapExecutionByLookupKey).map(
      ([agentContextLookupKey, executionState]) => [
        agentContextLookupKey,
        {
          ...executionState,
          ...(executionState.lastResolvedAgentControllerConversation
            ? {
                lastResolvedAgentControllerConversation: {
                  ...executionState.lastResolvedAgentControllerConversation,
                },
              }
            : {}),
        },
      ]
    )
  ),
  agentContextLifecycleCounters: {
    ...state.agentContextLifecycleCounters,
  },
  agentContextRotations: state.agentContextRotations.map((record) => ({
    ...record,
  })),
  updatedAtMs: state.updatedAtMs,
  v: state.v,
});

const compareRecoveryCandidate = (
  left: RecoveryReplayCandidate,
  right: RecoveryReplayCandidate
): number => {
  if (left.bindingKey !== right.bindingKey) {
    return left.bindingKey.localeCompare(right.bindingKey);
  }

  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  if (left.firstSeenAtMs !== right.firstSeenAtMs) {
    return left.firstSeenAtMs - right.firstSeenAtMs;
  }

  return left.taskId.localeCompare(right.taskId);
};

const normalizeOutput = (output: string | undefined): string | null => {
  if (typeof output !== "string") {
    return null;
  }
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
};

export const getCompensationDelayMs = (attempt: number): number | null => {
  if (!Number.isInteger(attempt)) {
    return null;
  }
  if (attempt <= 0 || attempt > COMPENSATION_DELAYS_MS.length) {
    return null;
  }
  return COMPENSATION_DELAYS_MS[attempt - 1] ?? null;
};

export const isCompensationAttemptAllowed = (attempt: number): boolean =>
  getCompensationDelayMs(attempt) !== null;

export const buildCompensationExecutionPlan = (): CompensationStep[] => [
  {
    attempt: 1,
    delayMs: COMPENSATION_DELAYS_MS[0],
  },
  {
    attempt: 2,
    delayMs: COMPENSATION_DELAYS_MS[1],
  },
  {
    attempt: 3,
    delayMs: COMPENSATION_DELAYS_MS[2],
  },
];

export const resolveCompensationProgress = (input: {
  attemptsCompleted: number;
  lastAttemptSucceeded: boolean;
}): {
  nextDelayMs: number | null;
  terminal: boolean;
} => {
  if (input.lastAttemptSucceeded) {
    return {
      nextDelayMs: null,
      terminal: true,
    };
  }

  const nextAttempt = input.attemptsCompleted + 1;
  const nextDelayMs = getCompensationDelayMs(nextAttempt);
  return {
    nextDelayMs,
    terminal: nextDelayMs === null,
  };
};

export const planRecoveryReplay = (input: {
  state: OpenMeldDaemonLedgerStateV1;
}): {
  replayCandidates: RecoveryReplayCandidate[];
  runtimeState: RecoveryRuntimeState;
} => {
  const replayCandidates: RecoveryReplayCandidate[] = [];

  for (const inflight of Object.values(input.state.inflightByTaskId)) {
    const hasReplayed = input.state.replayedTaskIds[inflight.taskId] === true;
    if (hasReplayed) {
      continue;
    }
    replayCandidates.push({
      ...inflight,
      replayAttempt: 1,
    });
  }

  replayCandidates.sort(compareRecoveryCandidate);

  return {
    replayCandidates,
    runtimeState: replayCandidates.length > 0 ? "recovering" : "idle",
  };
};

export const markRecoveryReplayCommitted = (input: {
  state: OpenMeldDaemonLedgerStateV1;
  taskId: string;
}): OpenMeldDaemonLedgerStateV1 => {
  if (!(input.taskId in input.state.inflightByTaskId)) {
    return input.state;
  }

  const nextState = cloneLedgerState(input.state);
  nextState.replayedTaskIds[input.taskId] = true;
  nextState.updatedAtMs = Date.now();
  return nextState;
};

export const settleRecoveredTask = (input: {
  state: OpenMeldDaemonLedgerStateV1;
  taskId: string;
}): OpenMeldDaemonLedgerStateV1 =>
  settleInflightTask({
    state: markRecoveryReplayCommitted({
      state: input.state,
      taskId: input.taskId,
    }),
    taskId: input.taskId,
  });

type BuildTaskResultPayloadInput = {
  agentId: string;
  attemptId: string;
  deduped: boolean;
  emitFailed: boolean;
  errorCode?: string;
  errorMessage?: string;
  errorType?: TaskResultErrorType;
  output?: string;
  originalError?: string;
  partialReason?: string;
  providerAccessEvidence?: OpenMeldDaemonProviderAccessEvidence;
  sourceEventId: string;
  taskId: string;
  telemetry?: AdapterDispatchTelemetry;
  transportMode?: RuntimeTransportMode | null;
};

type TaskResultCommonFields = {
  agentId: string;
  attemptId: string;
  deduped: boolean;
  sourceEventId: string;
  taskId: string;
  telemetry?: AdapterDispatchTelemetry;
  transportMode?: RuntimeTransportMode;
};

type TaskResultErrorFields = {
  errorCode?: string;
  errorMessage?: string;
  originalError?: string;
};

export const buildTaskResultPayloadFromOutcome = (
  input: BuildTaskResultPayloadInput
): OpenMeldDaemonTaskResultPayload => {
  const output = normalizeOutput(input.output);
  const errorType = input.errorType ?? "internal";
  const commonFields = buildTaskResultCommonFields(input);
  const errorFields = buildTaskResultErrorFields(input);

  if (output && input.emitFailed) {
    return {
      ...commonFields,
      errorType: input.errorType ?? "network",
      ...errorFields,
      output,
      partialReason: input.partialReason ?? "emit_failed",
      status: "partial_success",
    };
  }

  if (output) {
    return {
      ...commonFields,
      output,
      status: "success",
    };
  }

  return {
    ...commonFields,
    errorType,
    ...errorFields,
    ...(input.providerAccessEvidence
      ? { providerAccessEvidence: input.providerAccessEvidence }
      : {}),
    status: "failed",
  };
};

function buildTaskResultCommonFields(
  input: BuildTaskResultPayloadInput
): TaskResultCommonFields {
  return {
    agentId: input.agentId,
    attemptId: input.attemptId,
    deduped: input.deduped,
    sourceEventId: input.sourceEventId,
    taskId: input.taskId,
    ...(input.telemetry ? { telemetry: input.telemetry } : {}),
    ...(input.transportMode ? { transportMode: input.transportMode } : {}),
  };
}

function buildTaskResultErrorFields(
  input: BuildTaskResultPayloadInput
): TaskResultErrorFields {
  return {
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    ...(input.originalError ? { originalError: input.originalError } : {}),
  };
}
