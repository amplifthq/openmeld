import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  parseAgentControllerRef,
  type RuntimeAgentControllerReportStatus,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import {
  lookupRuntime,
  type RuntimeLookupStore,
} from "./runtime-lookup-service";

export type RuntimeAgentControllerReportInput = {
  agentControllerRef: string;
  agentControllerInterface?: AgentControllerInterfaceSnapshot;
  expiresAtMs: number;
  observedAtMs: number;
  reasonCodes?: readonly string[];
  status: RuntimeAgentControllerReportStatus;
};

export type AcceptedRuntimeAgentControllerReport = {
  agentControllerRef: string;
  agentControllerInterface?: AgentControllerInterfaceSnapshot;
  expiresAtMs: number;
  observedAtMs: number;
  reasonCodes: readonly string[];
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  status: RuntimeAgentControllerReportStatus;
};

export type RuntimeAgentControllerReportAcceptanceOutcome =
  | "created"
  | "updated"
  | "reused";

export type RuntimeAgentControllerReportRejectionReason =
  | "agent_controller_ref_invalid"
  | "conflict"
  | "out_of_order"
  | "report_status_invalid"
  | "report_time_invalid"
  | "openmeld_service_runtime_id_invalid"
  | "openmeld_service_runtime_id_mismatch"
  | "openmeld_service_runtime_identity_invalid"
  | "runtime_lookup_conflict"
  | "runtime_missing"
  | "stale";

export type RuntimeAgentControllerReportAcceptanceResult =
  | {
      currentReport: AcceptedRuntimeAgentControllerReport;
      outcome: RuntimeAgentControllerReportAcceptanceOutcome;
      status: "accepted";
    }
  | {
      currentReport?: AcceptedRuntimeAgentControllerReport;
      reason: RuntimeAgentControllerReportRejectionReason;
      status: "rejected";
    };

export type RuntimeAgentControllerReportStoreInput = {
  nowMs: number;
  report: AcceptedRuntimeAgentControllerReport;
};

export type RuntimeAgentControllerReportStore = {
  acceptRuntimeAgentControllerReport: (
    input: RuntimeAgentControllerReportStoreInput
  ) => Promise<RuntimeAgentControllerReportAcceptanceResult>;
};

const RUNTIME_AGENT_CONTROLLER_REPORT_STATUSES = new Set<string>([
  "ready",
  "disabled",
  "unavailable",
  "unknown",
]);

export async function acceptRuntimeAgentControllerReport(input: {
  nowMs: number;
  report: RuntimeAgentControllerReportInput;
  reportStore: RuntimeAgentControllerReportStore;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
  runtimeLookupStore: RuntimeLookupStore;
}): Promise<RuntimeAgentControllerReportAcceptanceResult> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT runtime-agent-controller-report
  // Core accepts the current Agent Controller fact for an account/device/lane runtime.
  // This is the authority shape Phase 2 should route local agent inventory through.
  const openMeldServiceRuntimeId = resolveAuthorityOpenMeldServiceRuntimeId({
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    runtimeLookupInput: input.runtimeLookupInput,
  });
  if (!openMeldServiceRuntimeId.ok) {
    return {
      reason: "openmeld_service_runtime_id_invalid",
      status: "rejected",
    };
  }

  const lookupResult = await lookupRuntime({
    runtimeLookupInput: input.runtimeLookupInput,
    store: input.runtimeLookupStore,
  });
  if (lookupResult.status === "invalid_identity") {
    return {
      reason: "openmeld_service_runtime_identity_invalid",
      status: "rejected",
    };
  }
  if (lookupResult.status === "missing") {
    return {
      reason: "runtime_missing",
      status: "rejected",
    };
  }
  if (lookupResult.status === "conflict") {
    return {
      reason: "runtime_lookup_conflict",
      status: "rejected",
    };
  }
  if (
    lookupResult.openMeldServiceRuntimeId.value !==
    openMeldServiceRuntimeId.value.value
  ) {
    return {
      reason: "openmeld_service_runtime_id_mismatch",
      status: "rejected",
    };
  }

  const report = resolveCurrentReport({
    report: input.report,
    openMeldServiceRuntimeId: openMeldServiceRuntimeId.value,
  });
  if (!report.ok) {
    return {
      reason: report.reason,
      status: "rejected",
    };
  }
  if (report.value.expiresAtMs <= input.nowMs) {
    return {
      reason: "stale",
      status: "rejected",
    };
  }

  return input.reportStore.acceptRuntimeAgentControllerReport({
    nowMs: input.nowMs,
    report: report.value,
  });
}

function resolveAuthorityOpenMeldServiceRuntimeId(input: {
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
}):
  | {
      ok: true;
      value: AuthorityOpenMeldServiceRuntimeId;
    }
  | {
      ok: false;
    } {
  try {
    return {
      ok: true,
      value: createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: input.runtimeLookupInput,
        openMeldServiceRuntimeId: input.openMeldServiceRuntimeId.value,
        source: input.openMeldServiceRuntimeId.source,
      }),
    };
  } catch {
    return {
      ok: false,
    };
  }
}

function resolveCurrentReport(input: {
  report: RuntimeAgentControllerReportInput;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
}):
  | {
      ok: true;
      value: AcceptedRuntimeAgentControllerReport;
    }
  | {
      ok: false;
      reason: RuntimeAgentControllerReportRejectionReason;
    } {
  const agentControllerRef = parseAgentControllerRef(
    input.report.agentControllerRef
  );
  if (!agentControllerRef) {
    return {
      ok: false,
      reason: "agent_controller_ref_invalid",
    };
  }
  if (
    input.report.agentControllerInterface &&
    input.report.agentControllerInterface.agentControllerRef !==
      agentControllerRef.ref
  ) {
    return {
      ok: false,
      reason: "agent_controller_ref_invalid",
    };
  }
  if (!RUNTIME_AGENT_CONTROLLER_REPORT_STATUSES.has(input.report.status)) {
    return {
      ok: false,
      reason: "report_status_invalid",
    };
  }
  if (
    !(
      isPositiveInteger(input.report.observedAtMs) &&
      isPositiveInteger(input.report.expiresAtMs)
    ) ||
    input.report.expiresAtMs <= input.report.observedAtMs
  ) {
    return {
      ok: false,
      reason: "report_time_invalid",
    };
  }

  return {
    ok: true,
    value: {
      agentControllerRef: agentControllerRef.ref,
      ...(input.report.agentControllerInterface
        ? { agentControllerInterface: input.report.agentControllerInterface }
        : {}),
      expiresAtMs: input.report.expiresAtMs,
      observedAtMs: input.report.observedAtMs,
      reasonCodes: normalizeReasonCodes(input.report.reasonCodes),
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      status: input.report.status,
    },
  };
}

function normalizeReasonCodes(
  reasonCodes: readonly string[] | undefined
): readonly string[] {
  return Array.from(
    new Set(
      (reasonCodes ?? [])
        .map((reasonCode) => reasonCode.trim())
        .filter((reasonCode) => reasonCode.length > 0)
    )
  );
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
