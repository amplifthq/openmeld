import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  type PrepareReadinessAgentControllerReportFact,
  type PrepareReadinessAgentControllerReportProjection,
  type PrepareReadinessDisplayState,
  type PrepareReadinessProjection,
  parseAgentControllerRef,
  type RuntimeLookupInput,
  resolvePrepareReadinessFromAgentControllerReports,
  resolvePrepareReadinessSummary,
} from "@openmeld/agent-runtime";
import type { AcceptedRuntimeAgentControllerReport } from "./runtime-agent-controller-report-service";
import {
  lookupRuntime,
  type RuntimeLookupStore,
} from "./runtime-lookup-service";

export type RuntimeAgentControllerReportReadStore = {
  readCurrentRuntimeAgentControllerReports: (input: {
    agentControllerRefs?: readonly string[];
    openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
  }) => Promise<readonly AcceptedRuntimeAgentControllerReport[]>;
};

export type RuntimePrepareReadinessReason =
  | "openmeld_service_runtime_identity_invalid"
  | "openmeld_service_runtime_id_invalid"
  | "openmeld_service_runtime_id_mismatch"
  | "runtime_lookup_conflict"
  | "runtime_missing"
  | "runtime_not_ready";

export type RuntimePrepareReadinessResult =
  | (PrepareReadinessAgentControllerReportProjection & {
      agentControllerReportsRead: true;
      reason?: RuntimePrepareReadinessReason;
      openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
      status: "not_ready" | "ready";
    })
  | (PrepareReadinessAgentControllerReportProjection & {
      agentControllerReportsRead: false;
      reason: RuntimePrepareReadinessReason;
      openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId;
      status: "not_ready";
    });

export async function resolveRuntimePrepareReadiness(input: {
  agentControllerRefsToEvaluate?: readonly string[];
  nowMs: number;
  reportReadStore: RuntimeAgentControllerReportReadStore;
  openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
  runtimeLookupStore: RuntimeLookupStore;
}): Promise<RuntimePrepareReadinessResult> {
  const suppliedRuntimeId = resolveSuppliedRuntimeId({
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    runtimeLookupInput: input.runtimeLookupInput,
  });
  if (!suppliedRuntimeId.ok) {
    return createNotReadyResult({
      displayState: "unknown",
      reason: "openmeld_service_runtime_id_invalid",
      reasonCodes: ["runtime.id_invalid"],
    });
  }

  const lookupResult = await lookupRuntime({
    runtimeLookupInput: input.runtimeLookupInput,
    store: input.runtimeLookupStore,
  });
  if (lookupResult.status === "invalid_identity") {
    return createNotReadyResult({
      displayState: "unknown",
      reason: "openmeld_service_runtime_identity_invalid",
      reasonCodes: ["runtime.identity_invalid"],
    });
  }
  if (lookupResult.status === "missing") {
    return createNotReadyResult({
      displayState: "unknown",
      reason: "runtime_missing",
      reasonCodes: ["runtime.missing"],
    });
  }
  if (lookupResult.status === "conflict") {
    return createNotReadyResult({
      displayState: "unknown",
      reason: "runtime_lookup_conflict",
      reasonCodes: ["runtime.lookup_conflict"],
    });
  }

  if (
    suppliedRuntimeId.value &&
    suppliedRuntimeId.value.value !==
      lookupResult.openMeldServiceRuntimeId.value
  ) {
    return createNotReadyResult({
      displayState: "unknown",
      reason: "openmeld_service_runtime_id_mismatch",
      reasonCodes: ["runtime.id_mismatch"],
    });
  }

  const reportReadPlan = resolveAgentControllerRefsForReportRead(
    input.agentControllerRefsToEvaluate
  );
  if (!reportReadPlan.readReports) {
    const readiness = resolvePrepareReadinessFromAgentControllerReports({
      agentControllerRefsToEvaluate: input.agentControllerRefsToEvaluate,
      currentReports: [],
      nowMs: input.nowMs,
    });
    return {
      ...readiness,
      agentControllerReportsRead: false,
      reason: "runtime_not_ready",
      openMeldServiceRuntimeId: lookupResult.openMeldServiceRuntimeId,
      status: "not_ready",
    };
  }

  const currentReports =
    await input.reportReadStore.readCurrentRuntimeAgentControllerReports({
      agentControllerRefs: reportReadPlan.agentControllerRefs,
      openMeldServiceRuntimeId: lookupResult.openMeldServiceRuntimeId,
    });
  const readiness = resolvePrepareReadinessFromAgentControllerReports({
    agentControllerRefsToEvaluate: input.agentControllerRefsToEvaluate,
    currentReports: currentReports.map(mapReportToPrepareReadinessFact),
    nowMs: input.nowMs,
  });
  const ready = readiness.summary.ready;

  if (ready) {
    return {
      ...readiness,
      agentControllerReportsRead: true,
      openMeldServiceRuntimeId: lookupResult.openMeldServiceRuntimeId,
      status: "ready",
    };
  }

  return {
    ...readiness,
    agentControllerReportsRead: true,
    reason: "runtime_not_ready",
    openMeldServiceRuntimeId: lookupResult.openMeldServiceRuntimeId,
    status: "not_ready",
  };
}

function resolveAgentControllerRefsForReportRead(
  agentControllerRefsToEvaluate: readonly string[] | undefined
):
  | {
      agentControllerRefs?: readonly string[];
      readReports: true;
    }
  | {
      readReports: false;
    } {
  if (
    !agentControllerRefsToEvaluate ||
    agentControllerRefsToEvaluate.length === 0
  ) {
    return {
      readReports: true,
    };
  }

  const validRefs = new Set<string>();
  for (const agentControllerRef of agentControllerRefsToEvaluate) {
    const parsed = parseAgentControllerRef(agentControllerRef);
    if (parsed) {
      validRefs.add(parsed.ref);
    }
  }

  if (validRefs.size === 0) {
    return {
      readReports: false,
    };
  }

  return {
    agentControllerRefs: Array.from(validRefs).sort(),
    readReports: true,
  };
}

function resolveSuppliedRuntimeId(input: {
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId | undefined;
  runtimeLookupInput: RuntimeLookupInput;
}):
  | {
      ok: true;
      value?: AuthorityOpenMeldServiceRuntimeId;
    }
  | {
      ok: false;
    } {
  if (!input.openMeldServiceRuntimeId) {
    return {
      ok: true,
    };
  }
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

function createNotReadyResult(input: {
  displayState: PrepareReadinessDisplayState;
  reason: RuntimePrepareReadinessReason;
  reasonCodes: readonly string[];
}): RuntimePrepareReadinessResult {
  const projection: PrepareReadinessProjection = {
    allRunnableCapabilitiesPrepared: {
      status: "unknown",
    },
    projectionStatus: input.displayState,
    reasonCodes: input.reasonCodes,
  };

  return {
    agentControllerReportsRead: false,
    nonRunnableCapabilities: [],
    projection,
    reason: input.reason,
    runnableCapabilities: [],
    status: "not_ready",
    summary: resolvePrepareReadinessSummary(projection),
  };
}

function mapReportToPrepareReadinessFact(
  report: AcceptedRuntimeAgentControllerReport
): PrepareReadinessAgentControllerReportFact {
  return {
    agentControllerRef: report.agentControllerRef,
    expiresAtMs: report.expiresAtMs,
    observedAtMs: report.observedAtMs,
    reasonCodes: report.reasonCodes,
    status: report.status,
  };
}
