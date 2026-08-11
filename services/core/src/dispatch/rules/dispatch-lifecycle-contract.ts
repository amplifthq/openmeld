import { DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS } from "./dispatch-runtime-constants";

export const OPENMELD_DAEMON_DISPATCH_STATE = {
  queued: "queued",
  dispatching: "dispatching",
  succeeded: "succeeded",
  failedRetryable: "failed_retryable",
  failedTerminal: "failed_terminal",
  deduped: "deduped",
  blocked: "blocked",
  cancelled: "cancelled",
} as const;

export type OpenMeldDaemonDispatchState =
  (typeof OPENMELD_DAEMON_DISPATCH_STATE)[keyof typeof OPENMELD_DAEMON_DISPATCH_STATE];

export const OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE = {
  blocked: "blocked",
  dispatching: "dispatching",
  failedRetryable: "failed_retryable",
  failedTerminal: "failed_terminal",
  succeeded: "succeeded",
  superseded: "superseded",
  timedOut: "timed_out",
  waitingResult: "waiting_result",
} as const;

export type OpenMeldDaemonDispatchAttemptState =
  (typeof OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE)[keyof typeof OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE];

const ALL_DISPATCH_STATES = new Set<OpenMeldDaemonDispatchState>(
  Object.values(OPENMELD_DAEMON_DISPATCH_STATE)
);
const ALL_DISPATCH_ATTEMPT_STATES = new Set<OpenMeldDaemonDispatchAttemptState>(
  Object.values(OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE)
);
const TERMINAL_DISPATCH_STATES = new Set<OpenMeldDaemonDispatchState>([
  OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
  OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
  OPENMELD_DAEMON_DISPATCH_STATE.blocked,
  OPENMELD_DAEMON_DISPATCH_STATE.deduped,
  OPENMELD_DAEMON_DISPATCH_STATE.cancelled,
]);
const IN_FLIGHT_DISPATCH_STATES = new Set<OpenMeldDaemonDispatchState>([
  OPENMELD_DAEMON_DISPATCH_STATE.queued,
  OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
]);
const TERMINAL_DISPATCH_ATTEMPT_STATES =
  new Set<OpenMeldDaemonDispatchAttemptState>([
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.blocked,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.timedOut,
  ]);
const ACTIVE_DISPATCH_ATTEMPT_STATES =
  new Set<OpenMeldDaemonDispatchAttemptState>([
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching,
    OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.waitingResult,
  ]);

export const toOpenMeldDaemonDispatchState = (
  value: unknown
): OpenMeldDaemonDispatchState | null => {
  if (typeof value !== "string") {
    return null;
  }
  return ALL_DISPATCH_STATES.has(value as OpenMeldDaemonDispatchState)
    ? (value as OpenMeldDaemonDispatchState)
    : null;
};

export const toOpenMeldDaemonDispatchAttemptState = (
  value: unknown
): OpenMeldDaemonDispatchAttemptState | null => {
  if (typeof value !== "string") {
    return null;
  }
  return ALL_DISPATCH_ATTEMPT_STATES.has(
    value as OpenMeldDaemonDispatchAttemptState
  )
    ? (value as OpenMeldDaemonDispatchAttemptState)
    : null;
};

export const isTerminalDispatchState = (value: unknown): boolean => {
  const status = toOpenMeldDaemonDispatchState(value);
  return status ? TERMINAL_DISPATCH_STATES.has(status) : false;
};

export const isInFlightDispatchState = (value: unknown): boolean => {
  const status = toOpenMeldDaemonDispatchState(value);
  return status ? IN_FLIGHT_DISPATCH_STATES.has(status) : false;
};

export const isTerminalDispatchAttemptState = (value: unknown): boolean => {
  const status = toOpenMeldDaemonDispatchAttemptState(value);
  return status ? TERMINAL_DISPATCH_ATTEMPT_STATES.has(status) : false;
};

export const isActiveDispatchAttemptState = (value: unknown): boolean => {
  const status = toOpenMeldDaemonDispatchAttemptState(value);
  return status ? ACTIVE_DISPATCH_ATTEMPT_STATES.has(status) : false;
};

export const resolveAttemptStateForDispatchState = (
  status: OpenMeldDaemonDispatchState
): OpenMeldDaemonDispatchAttemptState => {
  switch (status) {
    case OPENMELD_DAEMON_DISPATCH_STATE.succeeded:
      return OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded;
    case OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable:
      return OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable;
    case OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal:
      return OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedTerminal;
    case OPENMELD_DAEMON_DISPATCH_STATE.blocked:
      return OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.blocked;
    case OPENMELD_DAEMON_DISPATCH_STATE.cancelled:
      return OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.superseded;
    default:
      return OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.dispatching;
  }
};

export const isDispatchLifecycleFresh = (input: {
  lastAttemptAtMs: number;
  nowMs: number;
  staleAfterMs?: number;
}): boolean => {
  const staleAfterMs =
    input.staleAfterMs ?? DISPATCH_IN_FLIGHT_STALE_RECLAIM_MS;
  return input.nowMs - input.lastAttemptAtMs < staleAfterMs;
};

export const isDispatchLifecycleStale = (input: {
  lastAttemptAtMs: number;
  nowMs: number;
  staleAfterMs?: number;
}): boolean => {
  return !isDispatchLifecycleFresh(input);
};
