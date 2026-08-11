import {
  type AgentExecutionBindingEvidence,
  type AgentExecutionClaimDiagnosticEvidence,
  type AgentExecutionRouteEvidence,
  type AgentExecutionStatusDisplayRow,
  type AgentExecutionStatusProjection,
  type AgentProfileBindingDisplayProjection,
  createAgentExecutionStatusDisplayRows,
  type EvidenceSyncHealth,
  type PrepareReadinessSummary,
  resolveAgentExecutionStatus,
  resolveEvidenceSyncHealth,
} from "@openmeld/agent-runtime";
import type { AgentProfileBindingProjection } from "@openmeld/schemas/types";
import type { PrepareReadinessApiEvidence } from "../system/prepare-readiness-api-evidence";

export type ServiceTraceAgentExecutionStatusInput = {
  agentProfileId: string;
  binding?:
    | AgentExecutionBindingEvidence
    | AgentProfileBindingDisplayProjection
    | AgentProfileBindingProjection
    | null;
  executionAuthorityDiagnostics?:
    | AgentExecutionClaimDiagnosticEvidence
    | { reasonCodes?: readonly string[]; status: "unavailable" }
    | null;
  prepareReadiness?: PrepareReadinessApiEvidence | null;
  route?: AgentExecutionRouteEvidence | null;
  runtimeCoordinatorCreationReasonCode?: string | null;
  runtimeCoordinatorExecutionId?: string | null;
};

export type ServiceTraceAgentExecutionStatusRow =
  AgentExecutionStatusDisplayRow;

export type ServiceTraceLocalExecutionDiagnosticRow = {
  label: string;
  value: string;
};

type StatusBindingEvidence = Extract<
  AgentExecutionBindingEvidence,
  { status: "not_checked" | "unavailable" }
>;

export function buildServiceTraceAgentExecutionStatus(
  input: ServiceTraceAgentExecutionStatusInput
): AgentExecutionStatusProjection {
  return resolveAgentExecutionStatus({
    agentProfileId: input.agentProfileId,
    binding: normalizeBindingProjection(input.binding),
    claimDiagnostics: normalizeExecutionAuthorityDiagnostics({
      diagnostics: input.executionAuthorityDiagnostics,
      runtimeCoordinatorCreationReasonCode:
        input.runtimeCoordinatorCreationReasonCode,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    }),
    route: input.route ?? null,
    runtimeReadiness: normalizePrepareReadiness(input.prepareReadiness),
  });
}

export function buildServiceTraceEvidenceSyncHealth(input: {
  generatedAt?: string;
  projection: AgentExecutionStatusProjection;
}): EvidenceSyncHealth {
  return resolveEvidenceSyncHealth({
    generatedAt: input.generatedAt,
    readiness: input.projection,
  });
}

export function buildServiceTraceAgentExecutionStatusRows(
  projection: AgentExecutionStatusProjection
): ServiceTraceAgentExecutionStatusRow[] {
  return createAgentExecutionStatusDisplayRows(projection);
}

export function buildServiceTraceLocalExecutionDiagnosticRows(
  projection: AgentExecutionStatusProjection
): ServiceTraceLocalExecutionDiagnosticRow[] {
  return createAgentExecutionStatusDisplayRows(projection).map(
    formatLocalExecutionDiagnosticRow
  );
}

function formatLocalExecutionDiagnosticRow(
  row: AgentExecutionStatusDisplayRow
): ServiceTraceLocalExecutionDiagnosticRow {
  switch (row.label) {
    case "Reply status":
      return {
        label: "Current Local Execution Projection",
        value: formatLocalExecutionProjectionValue(row.value),
      };
    case "Connection":
      return {
        label: "Current Binding Evidence",
        value: row.value,
      };
    case "Local readiness":
    case "Local agent capability":
      return {
        label: "Current Local Agent Capability",
        value: row.value.replace("Local readiness", "Local agent capability"),
      };
    case "Reply route":
      return {
        label: "Current Daemon Route Evidence",
        value: row.value,
      };
    case "Wake":
      return {
        label: "Current Wake Diagnostic",
        value: row.value.replace(
          "Wake is available from this computer.",
          "Local evidence says Wake can be attempted from this computer."
        ),
      };
    default:
      return row;
  }
}

function formatLocalExecutionProjectionValue(value: string): string {
  const [status = "", ...detailParts] = value.split(" · ");
  const diagnosticStatus = formatLocalExecutionDiagnosticStatus(status);
  const detail = detailParts.join(" · ");
  return detail
    ? `Local evidence: ${diagnosticStatus} · ${detail}`
    : `Local evidence: ${diagnosticStatus}`;
}

function formatLocalExecutionDiagnosticStatus(status: string): string {
  switch (status) {
    case "Ready":
    case "Available for Wake":
      return "reply-capable";
    case "Not ready":
    case "Unavailable":
      return "not reply-capable";
    case "Blocked":
      return "blocked";
    default:
      return status.toLowerCase();
  }
}

function normalizeBindingProjection(
  binding: ServiceTraceAgentExecutionStatusInput["binding"]
): AgentExecutionBindingEvidence | null {
  if (!binding) {
    return null;
  }
  if (isStatusBindingEvidence(binding)) {
    return binding;
  }
  if ("diagnosticPointer" in binding) {
    return binding;
  }

  const executionTarget = binding.executionTarget
    ? {
        agentControllerRef: binding.executionTarget.agentControllerRef,
        openMeldServiceRuntimeId:
          binding.executionTarget.openMeldServiceRuntimeId.value,
      }
    : null;
  const bindingId = binding.bindingId;
  const reasonCodes = binding.reasonCodes ?? [];

  return {
    agentProfileId: binding.agentProfileId,
    authoritySource: binding.authoritySource,
    ...(bindingId ? { bindingId } : {}),
    bindingState: binding.bindingState,
    diagnosticPointer: {
      agentProfileId: binding.agentProfileId,
      ...(bindingId ? { bindingId } : {}),
      ...(executionTarget
        ? {
            agentControllerRef: executionTarget.agentControllerRef,
            openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
          }
        : {}),
      reasonCodes,
      resolutionSource: binding.resolutionSource,
    },
    dispatchEligibility: binding.dispatchEligibility,
    dispatchReadableFacts:
      executionTarget && bindingId
        ? {
            agentProfileId: binding.agentProfileId,
            bindingId,
            bindingState: binding.bindingState,
            agentControllerRef: executionTarget.agentControllerRef,
            reasonCodes,
            resolutionSource: binding.resolutionSource,
            routable: binding.routable,
            openMeldServiceRuntimeId: executionTarget.openMeldServiceRuntimeId,
          }
        : null,
    reasonCodes,
    resolutionSource: binding.resolutionSource,
    executionTarget,
  };
}

function isStatusBindingEvidence(
  binding: NonNullable<ServiceTraceAgentExecutionStatusInput["binding"]>
): binding is StatusBindingEvidence {
  return "status" in binding;
}

function normalizeExecutionAuthorityDiagnostics(input: {
  diagnostics: ServiceTraceAgentExecutionStatusInput["executionAuthorityDiagnostics"];
  runtimeCoordinatorCreationReasonCode: string | null | undefined;
  runtimeCoordinatorExecutionId: string | null | undefined;
}): AgentExecutionClaimDiagnosticEvidence | null {
  const {
    diagnostics,
    runtimeCoordinatorCreationReasonCode,
    runtimeCoordinatorExecutionId,
  } = input;
  if (runtimeCoordinatorExecutionId) {
    return {
      reasonCodes: ["runtime_coordinator.execution_authority_present"],
      status: "accepted",
    };
  }
  if (runtimeCoordinatorCreationReasonCode) {
    return {
      reasonCodes: [
        "runtime_coordinator.execution_creation_failed",
        runtimeCoordinatorCreationReasonCode,
      ],
      status: "accepted",
    };
  }
  if (!diagnostics) {
    return null;
  }
  if (
    diagnostics.status === "accepted" ||
    diagnostics.status === "rejected" ||
    diagnostics.status === "not_checked"
  ) {
    return diagnostics;
  }
  if (diagnostics.status === "unavailable") {
    return {
      reasonCodes: diagnostics.reasonCodes ?? [
        "execution_authority.unavailable",
      ],
      status: "unavailable",
    };
  }
  if (diagnostics.status === "mismatch") {
    const reasonCodes =
      "reasonCodes" in diagnostics && diagnostics.reasonCodes?.length
        ? diagnostics.reasonCodes
        : ["execution_authority.mismatch"];
    return {
      reasonCodes,
      status: "mismatch",
    };
  }
  return diagnostics;
}

function normalizePrepareReadiness(
  prepareReadiness: PrepareReadinessApiEvidence | null | undefined
): PrepareReadinessSummary | null {
  if (!prepareReadiness) {
    return null;
  }
  return {
    displayState: resolvePrepareReadinessDisplayState(prepareReadiness.status),
    ready: prepareReadiness.status === "ready",
    reasonCodes: prepareReadiness.reasonCodes,
  };
}

function resolvePrepareReadinessDisplayState(
  status: PrepareReadinessApiEvidence["status"]
): PrepareReadinessSummary["displayState"] {
  if (status === "ready") {
    return "ready";
  }
  if (status === "unavailable") {
    return "unavailable";
  }
  return "needs_prepare";
}
