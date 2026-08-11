export type RuntimeHealthFindingSeverity = "warn" | "error";

export type RuntimeHealthHumanContext = Record<
  string,
  string | number | boolean | null
>;

export type RuntimeHealthReasonCode =
  | "runtime.heartbeat_unhealthy"
  | "runtime.replay_stuck"
  | "runtime.compensation_stuck"
  | "runtime.transition_contract_violation"
  | "runtime.result_mapping_violation";

export type RuntimeHealthSummaryKey =
  | "runtime.heartbeat_unhealthy"
  | "runtime.replay_stuck"
  | "runtime.compensation_stuck"
  | "runtime.transition_contract_violation"
  | "runtime.result_mapping_violation";

export type RuntimeHealthFinding = {
  reasonCode: RuntimeHealthReasonCode;
  severity: RuntimeHealthFindingSeverity;
  summaryKey: RuntimeHealthSummaryKey;
  humanContext: RuntimeHealthHumanContext | null;
};

export const RUNTIME_HEALTH_SEVERITY = {
  error: "error",
  warn: "warn",
} as const satisfies Record<string, RuntimeHealthFindingSeverity>;
