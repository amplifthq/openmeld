export type CoreDispatchHealthFindingSeverity = "warn" | "error";

export type CoreDispatchHealthHumanContext = Record<
  string,
  string | number | boolean | null
>;

export type CoreDispatchHealthReasonCode =
  | "outbox.read_ledger_status_failed"
  | "outbox.redrive_loop_suspected"
  | "dispatch.transition_contract_violation";

export type CoreDispatchHealthSummaryKey =
  | "core.outbox.read_ledger_status_failed"
  | "core.outbox.redrive_loop_suspected"
  | "core.dispatch.transition_contract_violation";

export type CoreDispatchHealthFinding = {
  reasonCode: CoreDispatchHealthReasonCode;
  severity: CoreDispatchHealthFindingSeverity;
  summaryKey: CoreDispatchHealthSummaryKey;
  humanContext: CoreDispatchHealthHumanContext | null;
};

export const CORE_DISPATCH_HEALTH_SEVERITY = {
  error: "error",
  warn: "warn",
} as const satisfies Record<string, CoreDispatchHealthFindingSeverity>;
