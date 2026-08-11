export type RuntimeHealthState = "healthy" | "idle" | "suspect" | "down";
export type ExternalHealthState = "ok" | "degraded" | "down";

export const HEALTH_REASON_CODE_BY_RUNTIME_STATE: Record<
  RuntimeHealthState,
  string
> = {
  healthy: "health.ok",
  idle: "health.idle",
  suspect: "health.suspect",
  down: "health.down",
} as const;

export const HEARTBEAT_POLICY_DEFAULTS = {
  watchdogTimeoutMs: 45_000,
  heartbeatIdleIntervalMs: 60_000,
  heartbeatSuspectIntervalMs: 15_000,
  suspectAfterMissed: 1,
  downAfterMissed: 2,
  reconnectBackoffMs: [1000, 2000, 5000, 10_000, 30_000],
} as const;

export const mapRuntimeHealthToExternalHealth = (
  state: RuntimeHealthState
): ExternalHealthState => {
  if (state === "down") {
    return "down";
  }
  if (state === "suspect") {
    return "degraded";
  }
  return "ok";
};

export const resolveHealthReasonCode = (state: RuntimeHealthState): string =>
  HEALTH_REASON_CODE_BY_RUNTIME_STATE[state];

export const isHealthReasonCodeConsistent = (input: {
  runtimeState: RuntimeHealthState;
  externalState: ExternalHealthState;
  reasonCode: string;
}): boolean =>
  mapRuntimeHealthToExternalHealth(input.runtimeState) ===
    input.externalState &&
  resolveHealthReasonCode(input.runtimeState) === input.reasonCode;

export const heartbeatSentCountPerMinute = (intervalMs: number): number => {
  if (intervalMs <= 0) {
    throw new Error("intervalMs must be greater than 0");
  }
  return 60_000 / intervalMs;
};

export const reconnectSuccessRate = (
  successes: number,
  attempts: number
): number => {
  if (attempts <= 0) {
    return 1;
  }
  return successes / attempts;
};

export const suspectTransitionRatePerMinute = (
  transitions: number,
  durationSeconds: number
): number => {
  if (durationSeconds <= 0) {
    throw new Error("durationSeconds must be greater than 0");
  }
  return transitions / (durationSeconds / 60);
};
