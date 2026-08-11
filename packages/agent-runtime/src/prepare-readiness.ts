import { parseAgentControllerRef } from "./agent-controller-ref";
import type { RuntimeAgentControllerReportStatus } from "./runtime-registry-contract";

export type PrepareReadinessDisplayState =
  | "ready"
  | "pending"
  | "unavailable"
  | "needs_prepare"
  | "needs_repair"
  | "stale"
  | "unknown";

export type AllRunnableCapabilitiesPreparedStatus =
  | "prepared"
  | "not_prepared"
  | "partial"
  | "unknown";

export type PrepareServiceReadinessStatus =
  | "running"
  | "starting"
  | "not_running"
  | "not_installed"
  | "needs_repair"
  | "unavailable"
  | "unknown";

export type PrepareNextStep = {
  kind: string;
};

export type PrepareReadinessProjection = {
  projectionStatus: PrepareReadinessDisplayState;
  allRunnableCapabilitiesPrepared?: {
    status: AllRunnableCapabilitiesPreparedStatus;
  };
  serviceReadiness?: {
    status: PrepareServiceReadinessStatus;
  };
  reasonCodes: readonly string[];
  observedAt?: string;
  expiresAt?: string;
  nextSteps?: readonly PrepareNextStep[];
};

export type PrepareReadinessSummary = {
  ready: boolean;
  displayState: PrepareReadinessDisplayState;
  reasonCodes: string[];
};

export type PrepareReadinessAgentControllerReportFact = {
  agentControllerRef: string;
  expiresAtMs: number;
  observedAtMs: number;
  reasonCodes?: readonly string[];
  status: RuntimeAgentControllerReportStatus;
};

export type PrepareReadinessRunnableCapability = {
  agentControllerRef: string;
  expiresAtMs: number;
  observedAtMs: number;
  reasonCodes: readonly string[];
  status: "ready";
};

export type PrepareReadinessNonRunnableCapability = {
  agentControllerRef: string;
  expiresAtMs?: number;
  observedAtMs?: number;
  reasonCodes: readonly string[];
  status:
    | "disabled"
    | "invalid"
    | "missing"
    | "stale"
    | "unavailable"
    | "unknown";
};

export type PrepareReadinessAgentControllerReportProjection = {
  nonRunnableCapabilities: readonly PrepareReadinessNonRunnableCapability[];
  projection: PrepareReadinessProjection;
  runnableCapabilities: readonly PrepareReadinessRunnableCapability[];
  summary: PrepareReadinessSummary;
};

const READY_REASON_CODES = [
  "runtime.ready",
  "capability.ready",
  "service.ready",
] as const;

const DEFAULT_REASON_CODE_BY_STATE: Record<
  Exclude<PrepareReadinessDisplayState, "ready" | "stale">,
  string
> = {
  pending: "runtime.projection_pending",
  unavailable: "runtime.projection_unavailable",
  needs_prepare: "runtime.prepare_required",
  needs_repair: "service.needs_repair",
  unknown: "runtime.projection_unknown",
};

const FORBIDDEN_BINDING_STEP_KINDS = new Set([
  "bind_agent_profile",
  "create_binding",
  "update_binding",
  "write_binding",
]);

const FORBIDDEN_EXECUTABLE_WORK_STEP_KINDS = new Set([
  ...FORBIDDEN_BINDING_STEP_KINDS,
  "claim_dispatch",
  "create_space",
  "join_space",
  "send_wake",
  "wake",
  "write_claim",
  "write_result",
]);

const uniqueReasonCodes = (codes: readonly string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const code of codes) {
    const reasonCode = code.trim();
    if (!(reasonCode && !seen.has(reasonCode))) {
      continue;
    }
    seen.add(reasonCode);
    normalized.push(reasonCode);
  }
  return normalized;
};

export const resolvePrepareReadinessFromAgentControllerReports = (input: {
  agentControllerRefsToEvaluate?: readonly string[];
  currentReports: readonly PrepareReadinessAgentControllerReportFact[];
  nowMs: number;
  serviceReadiness?: PrepareReadinessProjection["serviceReadiness"];
}): PrepareReadinessAgentControllerReportProjection => {
  const reportByAgentControllerRef = new Map<
    string,
    PrepareReadinessAgentControllerReportFact
  >();
  for (const report of input.currentReports) {
    const agentControllerRef = normalizeAgentControllerRef(
      report.agentControllerRef
    );
    if (agentControllerRef) {
      reportByAgentControllerRef.set(agentControllerRef, report);
    }
  }

  const agentControllerRefsToEvaluate = resolveAgentControllerRefsToEvaluate({
    agentControllerRefsToEvaluate: input.agentControllerRefsToEvaluate,
    reportByAgentControllerRef,
  });
  const runnableCapabilities: PrepareReadinessRunnableCapability[] = [];
  const nonRunnableCapabilities: PrepareReadinessNonRunnableCapability[] =
    agentControllerRefsToEvaluate.invalid.map((agentControllerRef) => ({
      agentControllerRef,
      reasonCodes: ["runtime.agent_controller_ref_invalid"],
      status: "invalid",
    }));

  for (const agentControllerRef of agentControllerRefsToEvaluate.valid) {
    const report = reportByAgentControllerRef.get(agentControllerRef);
    if (!report) {
      nonRunnableCapabilities.push({
        agentControllerRef,
        reasonCodes: ["runtime.agent_controller_report_missing"],
        status: "missing",
      });
      continue;
    }
    if (report.expiresAtMs <= input.nowMs) {
      nonRunnableCapabilities.push({
        agentControllerRef,
        expiresAtMs: report.expiresAtMs,
        observedAtMs: report.observedAtMs,
        reasonCodes: uniqueReasonCodes([
          "runtime.agent_controller_report_stale",
          ...(report.reasonCodes ?? []),
        ]),
        status: "stale",
      });
      continue;
    }
    if (report.status === "ready") {
      runnableCapabilities.push({
        agentControllerRef,
        expiresAtMs: report.expiresAtMs,
        observedAtMs: report.observedAtMs,
        reasonCodes: uniqueReasonCodes(report.reasonCodes ?? []),
        status: "ready",
      });
      continue;
    }
    nonRunnableCapabilities.push({
      agentControllerRef,
      expiresAtMs: report.expiresAtMs,
      observedAtMs: report.observedAtMs,
      reasonCodes: uniqueReasonCodes([
        `runtime.agent_controller_report_${report.status}`,
        ...(report.reasonCodes ?? []),
      ]),
      status: report.status,
    });
  }

  const projection = resolveAgentControllerReportProjection({
    nonRunnableCapabilities,
    runnableCapabilities,
    serviceReadiness: input.serviceReadiness,
  });

  return {
    nonRunnableCapabilities,
    projection,
    runnableCapabilities,
    summary: resolvePrepareReadinessSummary(projection, {
      now: new Date(input.nowMs),
    }),
  };
};

const normalizeAgentControllerRef = (
  agentControllerRef: string
): string | undefined => {
  return parseAgentControllerRef(agentControllerRef)?.ref;
};

const resolveAgentControllerRefsToEvaluate = (input: {
  agentControllerRefsToEvaluate: readonly string[] | undefined;
  reportByAgentControllerRef: ReadonlyMap<
    string,
    PrepareReadinessAgentControllerReportFact
  >;
}): {
  invalid: readonly string[];
  valid: readonly string[];
} => {
  const explicitAgentControllerRefs = input.agentControllerRefsToEvaluate ?? [];
  if (explicitAgentControllerRefs.length === 0) {
    return {
      invalid: [],
      valid: Array.from(input.reportByAgentControllerRef.keys()).sort(),
    };
  }

  const invalid: string[] = [];
  const valid: string[] = [];
  for (const agentControllerRef of explicitAgentControllerRefs) {
    const parsed = normalizeAgentControllerRef(agentControllerRef);
    if (parsed) {
      valid.push(parsed);
      continue;
    }
    invalid.push(agentControllerRef.trim());
  }

  return {
    invalid: uniqueReasonCodes(invalid),
    valid: uniqueReasonCodes(valid),
  };
};

const resolveAgentControllerReportProjection = (input: {
  nonRunnableCapabilities: readonly PrepareReadinessNonRunnableCapability[];
  runnableCapabilities: readonly PrepareReadinessRunnableCapability[];
  serviceReadiness?: PrepareReadinessProjection["serviceReadiness"];
}): PrepareReadinessProjection => {
  if (input.nonRunnableCapabilities.length === 0) {
    return {
      allRunnableCapabilitiesPrepared: {
        status: input.runnableCapabilities.length > 0 ? "prepared" : "unknown",
      },
      projectionStatus:
        input.runnableCapabilities.length > 0 ? "ready" : "unknown",
      reasonCodes:
        input.runnableCapabilities.length > 0
          ? []
          : ["runtime.agent_controller_report_missing"],
      serviceReadiness: input.serviceReadiness,
    };
  }

  return {
    allRunnableCapabilitiesPrepared: {
      status:
        input.runnableCapabilities.length > 0 ? "partial" : "not_prepared",
    },
    projectionStatus: resolveNonRunnableDisplayState(
      input.nonRunnableCapabilities
    ),
    reasonCodes: uniqueReasonCodes(
      input.nonRunnableCapabilities.flatMap(
        (capability) => capability.reasonCodes
      )
    ),
    serviceReadiness: input.serviceReadiness,
  };
};

const resolveNonRunnableDisplayState = (
  capabilities: readonly PrepareReadinessNonRunnableCapability[]
): PrepareReadinessDisplayState => {
  if (capabilities.some((capability) => capability.status === "stale")) {
    return "stale";
  }
  if (capabilities.some((capability) => capability.status === "unavailable")) {
    return "unavailable";
  }
  if (capabilities.some((capability) => capability.status === "unknown")) {
    return "unknown";
  }
  return "needs_prepare";
};

const withReasonCodes = (input: {
  ready: boolean;
  displayState: PrepareReadinessDisplayState;
  reasonCodes: readonly string[];
  fallbackReasonCode: string;
}): PrepareReadinessSummary => ({
  ready: input.ready,
  displayState: input.displayState,
  reasonCodes: uniqueReasonCodes(
    input.reasonCodes.length > 0
      ? input.reasonCodes
      : [input.fallbackReasonCode]
  ),
});

const isProjectionExpired = (
  projection: PrepareReadinessProjection,
  now: Date
): boolean => {
  if (!projection.expiresAt) {
    return false;
  }
  const expiresAt = Date.parse(projection.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }
  return expiresAt <= now.getTime();
};

const resolveNow = (value: Date | string | undefined): Date => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  return new Date();
};

export const resolvePrepareReadinessSummary = (
  projection: PrepareReadinessProjection | null | undefined,
  options?: {
    now?: Date | string;
  }
): PrepareReadinessSummary => {
  if (!projection) {
    return {
      ready: false,
      displayState: "unknown",
      reasonCodes: ["runtime.projection_missing"],
    };
  }

  if (isProjectionExpired(projection, resolveNow(options?.now))) {
    return withReasonCodes({
      ready: false,
      displayState: "stale",
      reasonCodes: projection.reasonCodes,
      fallbackReasonCode: "runtime.projection_stale",
    });
  }

  if (projection.projectionStatus !== "ready") {
    const displayState = projection.projectionStatus;
    return withReasonCodes({
      ready: false,
      displayState,
      reasonCodes: projection.reasonCodes,
      fallbackReasonCode:
        displayState === "stale"
          ? "runtime.projection_stale"
          : DEFAULT_REASON_CODE_BY_STATE[displayState],
    });
  }

  const allRunnableStatus = projection.allRunnableCapabilitiesPrepared?.status;
  if (allRunnableStatus !== "prepared") {
    const displayState =
      allRunnableStatus === "not_prepared" || allRunnableStatus === "partial"
        ? "needs_prepare"
        : "unknown";
    return withReasonCodes({
      ready: false,
      displayState,
      reasonCodes: projection.reasonCodes,
      fallbackReasonCode:
        displayState === "needs_prepare"
          ? "runtime.prepare_required"
          : "capability.readiness_unknown",
    });
  }

  if (projection.serviceReadiness) {
    const serviceStatus = projection.serviceReadiness.status;
    if (serviceStatus === "needs_repair") {
      return withReasonCodes({
        ready: false,
        displayState: "needs_repair",
        reasonCodes: projection.reasonCodes,
        fallbackReasonCode: "service.needs_repair",
      });
    }
    if (serviceStatus === "unavailable") {
      return withReasonCodes({
        ready: false,
        displayState: "unavailable",
        reasonCodes: projection.reasonCodes,
        fallbackReasonCode: "service.unavailable",
      });
    }
    if (serviceStatus !== "running") {
      return withReasonCodes({
        ready: false,
        displayState: "needs_prepare",
        reasonCodes: projection.reasonCodes,
        fallbackReasonCode: "service.not_running",
      });
    }
  }

  return {
    ready: true,
    displayState: "ready",
    reasonCodes: uniqueReasonCodes(
      projection.reasonCodes.length > 0
        ? projection.reasonCodes
        : READY_REASON_CODES
    ),
  };
};

export const assertPrepareOutputHasNoBindingWriteAction = (input: {
  nextSteps?: readonly PrepareNextStep[];
}): void => {
  for (const step of input.nextSteps ?? []) {
    if (!FORBIDDEN_BINDING_STEP_KINDS.has(step.kind)) {
      continue;
    }
    throw new Error(
      `prepare.contract_invalid: Prepare output must not include Binding write action: ${step.kind}`
    );
  }
};

export const assertPrepareOutputHasNoExecutableWorkAction = (input: {
  nextSteps?: readonly PrepareNextStep[];
}): void => {
  for (const step of input.nextSteps ?? []) {
    if (!FORBIDDEN_EXECUTABLE_WORK_STEP_KINDS.has(step.kind)) {
      continue;
    }
    throw new Error(
      `prepare.contract_invalid: Prepare output must not include executable work action: ${step.kind}`
    );
  }
};
