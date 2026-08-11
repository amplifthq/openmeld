import { openCodePermissionConfigSchema } from "@openmeld/schemas";
import type {
  AgentControllerCollaborationMode,
  AgentControllerPermissionMode,
  OpenCodePermissionConfig,
} from "@openmeld/schemas/types";
import { resolveNativeAgentControllerCollaborationModeForController } from "./agent-controller-collaboration-mode";
import {
  resolveAgentControllerPermissionMode,
  resolveNativeAgentControllerPermissionModeForController,
} from "./agent-controller-permission-mode";
import { parseAgentControllerRef } from "./agent-controller-ref";
import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  type RuntimeLookupInput,
} from "./runtime-id-contract";
import type { RuntimeOwnerReference } from "./runtime-identity";
import type { RuntimeAgentControllerReport } from "./runtime-registry-contract";

export type AgentProfileBindingState =
  | "missing"
  | "enabled_primary"
  | "disabled_historical"
  | "conflict"
  | "owner_mismatch";

export type AgentProfileBindingResolutionSource =
  | "binding_truth"
  | "missing_projection"
  | "conflict_evidence";

export type AgentProfileBindingAuthoritySource =
  | "binding_truth"
  | "none"
  | "blocked";

export type AgentProfileBindingDispatchEligibilityStatus =
  | "routable"
  | "not_routable";

export type AgentProfileBindingExecutionTarget = {
  openMeldServiceRuntimeId: string;
  agentControllerRef: string;
  agentControllerConversationId?: string;
};

export type AgentProfileBindingModelSelection = {
  modelId: string;
  reasoningLevel?: string;
};

export type AgentProfileBindingAgentControllerPermissionMode =
  AgentControllerPermissionMode;
export type AgentProfileBindingAgentControllerCollaborationMode =
  AgentControllerCollaborationMode;
export type AgentProfileBindingOpenCodePermission = OpenCodePermissionConfig;

export type AgentProfileBindingExecutionTargetInput = {
  openMeldServiceRuntimeId: string;
  agentControllerRef: string;
  agentControllerConversationId?: string | null;
};

export type AgentProfileBindingModelSelectionInput = {
  modelId?: string | null;
  reasoningLevel?: string | null;
};

export type AgentProfileBindingAgentControllerPermissionModeInput =
  | AgentControllerPermissionMode
  | string
  | null
  | undefined;
export type AgentProfileBindingAgentControllerCollaborationModeInput =
  | AgentControllerCollaborationMode
  | string
  | null
  | undefined;
export type AgentProfileBindingOpenCodePermissionInput =
  | OpenCodePermissionConfig
  | null
  | undefined;

export type AgentProfileBindingDiagnosticPointer = {
  agentProfileId: string;
  bindingId?: string;
  openMeldServiceRuntimeId?: string;
  agentControllerRef?: string;
  agentControllerConversationId?: string;
  resolutionSource: AgentProfileBindingResolutionSource;
  reasonCodes: readonly string[];
  correlationId?: string;
  sourceSignalId?: string;
  clientMessageId?: string;
  dispatchId?: string;
};

export type AgentProfileBindingDiagnosticContextInput = Pick<
  AgentProfileBindingDiagnosticPointer,
  "correlationId" | "sourceSignalId" | "clientMessageId" | "dispatchId"
>;

export type AgentProfileBindingDispatchReadableFacts = {
  agentProfileId: string;
  bindingId?: string;
  openMeldServiceRuntimeId: string;
  agentControllerRef: string;
  agentControllerConversationId?: string;
  agentControllerPermissionMode?: AgentProfileBindingAgentControllerPermissionMode;
  agentControllerCollaborationMode?: AgentProfileBindingAgentControllerCollaborationMode;
  modelSelection?: AgentProfileBindingModelSelection;
  openCodePermission?: AgentProfileBindingOpenCodePermission;
  bindingState: AgentProfileBindingState;
  resolutionSource: AgentProfileBindingResolutionSource;
  reasonCodes: readonly string[];
  routable: boolean;
};

export type AgentProfileBindingDispatchEligibility = {
  routable: boolean;
  status: AgentProfileBindingDispatchEligibilityStatus;
  reasonCodes: readonly string[];
};

export type AgentProfileBindingDisplayProjection = {
  agentProfileId: string;
  bindingId?: string;
  bindingState: AgentProfileBindingState;
  resolutionSource: AgentProfileBindingResolutionSource;
  authoritySource: AgentProfileBindingAuthoritySource;
  executionTarget: AgentProfileBindingExecutionTarget | null;
  agentControllerPermissionMode?: AgentProfileBindingAgentControllerPermissionMode;
  agentControllerCollaborationMode?: AgentProfileBindingAgentControllerCollaborationMode;
  modelSelection?: AgentProfileBindingModelSelection;
  openCodePermission?: AgentProfileBindingOpenCodePermission;
  dispatchEligibility: AgentProfileBindingDispatchEligibility;
  dispatchReadableFacts: AgentProfileBindingDispatchReadableFacts | null;
  reasonCodes: readonly string[];
  diagnosticPointer: AgentProfileBindingDiagnosticPointer;
};

export type AgentProfileBindingTruthWriter =
  | "binding_command"
  | "profile_rpc"
  | "gateway"
  | "web"
  | "cli"
  | "runtime_connector";

export type AgentProfileBindingTruthWriteBoundary = {
  allowed: boolean;
  reasonCodes: readonly string[];
};

export type AgentProfileBindingOwnerAuthorizationResult =
  | {
      status: "allowed";
      reasonCode?: string;
    }
  | {
      status: "denied" | "unavailable" | "unknown";
      reasonCode: string;
    };

export type AgentProfileBindingProfileOwnerValidationResult =
  | {
      status: "valid";
      reasonCode?: string;
    }
  | {
      status: "invalid" | "unavailable" | "unknown";
      reasonCode: string;
    };

export type AgentProfileBindingCommandEligibilityAgentControllerReportInput = {
  openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId | string;
  runtimeLookupInput?: RuntimeLookupInput;
  agentControllerRef?: string;
  agentControllerConversationId?: string | null;
};

export type AgentProfileBindingCommandEligibilityInput = {
  agentProfileId: string;
  ownerAuthorization: AgentProfileBindingOwnerAuthorizationResult;
  profileOwnerValidation: AgentProfileBindingProfileOwnerValidationResult;
  executionTarget?: AgentProfileBindingCommandEligibilityAgentControllerReportInput;
  runtimeAgentControllerReport?: RuntimeAgentControllerReport;
  runtimeOwnerMatches?: boolean;
  now?: Date | string;
};

export type AgentProfileBindingCommandEligibility = {
  bindable: boolean;
  routable: boolean;
  grantsClaimSuccess: false;
  executionTarget: AgentProfileBindingExecutionTarget | null;
  reasonCodes: readonly string[];
};

type CommonProjectionInput = {
  agentProfileId: string;
  reasonCodes?: readonly string[];
  diagnosticPointer?: AgentProfileBindingDiagnosticContextInput;
};

type ExecutionTargetProjectionInput = {
  bindingId: string;
  executionTarget: AgentProfileBindingExecutionTargetInput;
  agentControllerPermissionMode?: AgentProfileBindingAgentControllerPermissionModeInput;
  agentControllerCollaborationMode?: AgentProfileBindingAgentControllerCollaborationModeInput;
  modelSelection?: AgentProfileBindingModelSelectionInput | null;
  openCodePermission?: AgentProfileBindingOpenCodePermissionInput;
  owner?: RuntimeOwnerReference;
};

export type AgentProfileBindingDisplayProjectionInput =
  | (CommonProjectionInput & {
      bindingState: "missing";
    })
  | (CommonProjectionInput &
      ExecutionTargetProjectionInput & {
        bindingState: "enabled_primary" | "disabled_historical";
      })
  | (CommonProjectionInput & {
      bindingState: "conflict";
      bindingId?: string;
    })
  | (CommonProjectionInput &
      ExecutionTargetProjectionInput & {
        bindingState: "owner_mismatch";
        agentProfileOwner?: RuntimeOwnerReference;
        runtimeOwner?: RuntimeOwnerReference;
      });

const FALLBACK_REASON_CODE_BY_STATE: Record<AgentProfileBindingState, string> =
  {
    missing: "agent_profile_binding.missing",
    enabled_primary: "agent_profile_binding.enabled_primary",
    disabled_historical: "agent_profile_binding.disabled_historical",
    conflict: "agent_profile_binding.conflict",
    owner_mismatch: "agent_profile_binding.owner_mismatch",
  };

const normalizeRequiredString = (input: {
  fieldName: string;
  value: string | null | undefined;
  errorCode: string;
}): string => {
  const value = String(input.value ?? "").trim();
  if (!value) {
    throw new Error(`${input.errorCode}: ${input.fieldName} is required`);
  }
  return value;
};

const normalizeOptionalString = (
  value: string | null | undefined
): string | undefined => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
};

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

const resolveReasonCodes = (input: {
  bindingState: AgentProfileBindingState;
  reasonCodes?: readonly string[];
}): string[] => {
  return uniqueReasonCodes(
    input.reasonCodes && input.reasonCodes.length > 0
      ? input.reasonCodes
      : [FALLBACK_REASON_CODE_BY_STATE[input.bindingState]]
  );
};

export const createAgentProfileBindingExecutionTarget = (
  input: AgentProfileBindingExecutionTargetInput
): AgentProfileBindingExecutionTarget => {
  const openMeldServiceRuntimeId = normalizeRequiredString({
    fieldName: "openMeldServiceRuntimeId",
    value: input.openMeldServiceRuntimeId,
    errorCode: "agent_profile_binding.agent_controller_report_invalid",
  });
  const agentControllerRef = normalizeRequiredString({
    fieldName: "agentControllerRef",
    value: input.agentControllerRef,
    errorCode: "agent_profile_binding.agent_controller_report_invalid",
  });
  if (!parseAgentControllerRef(agentControllerRef)) {
    throw new Error(
      "agent_profile_binding.agent_controller_report_invalid: agentControllerRef is invalid"
    );
  }
  const agentControllerConversationId = normalizeOptionalString(
    input.agentControllerConversationId
  );
  return {
    openMeldServiceRuntimeId,
    agentControllerRef,
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
  };
};

export const createAgentProfileBindingModelSelection = (
  input: AgentProfileBindingModelSelectionInput | null | undefined
): AgentProfileBindingModelSelection | undefined => {
  const modelId = normalizeOptionalString(input?.modelId);
  if (!modelId) {
    return undefined;
  }
  const reasoningLevel = normalizeOptionalString(input?.reasoningLevel);
  return {
    modelId,
    ...(reasoningLevel ? { reasoningLevel } : {}),
  };
};

export const createAgentProfileBindingAgentControllerPermissionMode = (
  input: AgentProfileBindingAgentControllerPermissionModeInput
): AgentProfileBindingAgentControllerPermissionMode =>
  resolveAgentControllerPermissionMode(input);

const resolveResolutionSource = (
  bindingState: AgentProfileBindingState
): AgentProfileBindingResolutionSource => {
  switch (bindingState) {
    case "missing":
      return "missing_projection";
    case "conflict":
      return "conflict_evidence";
    case "enabled_primary":
    case "disabled_historical":
    case "owner_mismatch":
      return "binding_truth";
    default:
      return assertUnreachable(bindingState);
  }
};

const resolveAuthoritySource = (
  bindingState: AgentProfileBindingState
): AgentProfileBindingAuthoritySource => {
  switch (bindingState) {
    case "enabled_primary":
    case "disabled_historical":
      return "binding_truth";
    case "missing":
      return "none";
    case "conflict":
    case "owner_mismatch":
      return "blocked";
    default:
      return assertUnreachable(bindingState);
  }
};

const resolveExecutionTargetForProjection = (
  input: AgentProfileBindingDisplayProjectionInput
): AgentProfileBindingExecutionTarget | null => {
  switch (input.bindingState) {
    case "enabled_primary":
    case "disabled_historical":
    case "owner_mismatch":
      return createAgentProfileBindingExecutionTarget(input.executionTarget);
    case "missing":
    case "conflict":
      return null;
    default:
      return assertUnreachable(input);
  }
};

const resolveModelSelectionForProjection = (
  input: AgentProfileBindingDisplayProjectionInput
): AgentProfileBindingModelSelection | undefined => {
  switch (input.bindingState) {
    case "enabled_primary":
    case "disabled_historical":
    case "owner_mismatch":
      return createAgentProfileBindingModelSelection(input.modelSelection);
    case "missing":
    case "conflict":
      return undefined;
    default:
      return assertUnreachable(input);
  }
};

const resolveAgentControllerPermissionModeForProjection = (
  input: AgentProfileBindingDisplayProjectionInput
): AgentProfileBindingAgentControllerPermissionMode | undefined => {
  switch (input.bindingState) {
    case "enabled_primary":
    case "disabled_historical":
    case "owner_mismatch":
      return resolveNativeAgentControllerPermissionModeForController(
        input.agentControllerPermissionMode,
        { agentControllerRef: input.executionTarget.agentControllerRef }
      );
    case "missing":
    case "conflict":
      return undefined;
    default:
      return assertUnreachable(input);
  }
};

const resolveAgentControllerCollaborationModeForProjection = (
  input: AgentProfileBindingDisplayProjectionInput
): AgentProfileBindingAgentControllerCollaborationMode | undefined => {
  switch (input.bindingState) {
    case "enabled_primary":
    case "disabled_historical":
    case "owner_mismatch":
      if (
        input.agentControllerCollaborationMode === undefined ||
        input.agentControllerCollaborationMode === null
      ) {
        return undefined;
      }
      return resolveNativeAgentControllerCollaborationModeForController(
        input.agentControllerCollaborationMode,
        { agentControllerRef: input.executionTarget.agentControllerRef }
      );
    case "missing":
    case "conflict":
      return undefined;
    default:
      return assertUnreachable(input);
  }
};

const resolveOpenCodePermissionForProjection = (
  input: AgentProfileBindingDisplayProjectionInput
): AgentProfileBindingOpenCodePermission | undefined => {
  switch (input.bindingState) {
    case "enabled_primary":
    case "disabled_historical":
    case "owner_mismatch": {
      if (
        !isOpenCodeAgentControllerRef(input.executionTarget.agentControllerRef)
      ) {
        return undefined;
      }
      if (
        input.openCodePermission === undefined ||
        input.openCodePermission === null
      ) {
        return undefined;
      }
      const parsed = openCodePermissionConfigSchema.safeParse(
        input.openCodePermission
      );
      if (!parsed.success) {
        throw new Error(
          "agent_profile_binding.projection_invalid: openCodePermission is invalid"
        );
      }
      return parsed.data;
    }
    case "missing":
    case "conflict":
      return undefined;
    default:
      return assertUnreachable(input);
  }
};

const resolveBindingId = (
  input: AgentProfileBindingDisplayProjectionInput
): string | undefined => {
  if (!("bindingId" in input)) {
    return undefined;
  }
  const bindingId = input.bindingId?.trim();
  return bindingId || undefined;
};

const resolveDispatchEligibility = (input: {
  bindingState: AgentProfileBindingState;
  reasonCodes: readonly string[];
}): AgentProfileBindingDispatchEligibility => {
  const routable = input.bindingState === "enabled_primary";
  return {
    routable,
    status: routable ? "routable" : "not_routable",
    reasonCodes: input.reasonCodes,
  };
};

const createDiagnosticPointer = (input: {
  agentProfileId: string;
  bindingId?: string;
  executionTarget: AgentProfileBindingExecutionTarget | null;
  resolutionSource: AgentProfileBindingResolutionSource;
  reasonCodes: readonly string[];
  diagnosticPointer?: AgentProfileBindingDiagnosticContextInput;
}): AgentProfileBindingDiagnosticPointer => ({
  agentProfileId: input.agentProfileId,
  bindingId: input.bindingId,
  openMeldServiceRuntimeId: input.executionTarget?.openMeldServiceRuntimeId,
  agentControllerRef: input.executionTarget?.agentControllerRef,
  agentControllerConversationId:
    input.executionTarget?.agentControllerConversationId,
  resolutionSource: input.resolutionSource,
  reasonCodes: input.reasonCodes,
  correlationId: input.diagnosticPointer?.correlationId,
  sourceSignalId: input.diagnosticPointer?.sourceSignalId,
  clientMessageId: input.diagnosticPointer?.clientMessageId,
  dispatchId: input.diagnosticPointer?.dispatchId,
});

const createDispatchReadableFacts = (input: {
  agentProfileId: string;
  bindingId?: string;
  bindingState: AgentProfileBindingState;
  executionTarget: AgentProfileBindingExecutionTarget | null;
  agentControllerPermissionMode?: AgentProfileBindingAgentControllerPermissionMode;
  agentControllerCollaborationMode?: AgentProfileBindingAgentControllerCollaborationMode;
  modelSelection?: AgentProfileBindingModelSelection;
  openCodePermission?: AgentProfileBindingOpenCodePermission;
  resolutionSource: AgentProfileBindingResolutionSource;
  reasonCodes: readonly string[];
  routable: boolean;
}): AgentProfileBindingDispatchReadableFacts | null => {
  if (!input.executionTarget) {
    return null;
  }
  if (input.bindingState === "missing" || input.bindingState === "conflict") {
    return null;
  }
  return {
    agentProfileId: input.agentProfileId,
    bindingId: input.bindingId,
    openMeldServiceRuntimeId: input.executionTarget.openMeldServiceRuntimeId,
    agentControllerRef: input.executionTarget.agentControllerRef,
    ...(input.executionTarget.agentControllerConversationId
      ? {
          agentControllerConversationId:
            input.executionTarget.agentControllerConversationId,
        }
      : {}),
    ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
    ...(input.openCodePermission
      ? { openCodePermission: input.openCodePermission }
      : {}),
    ...(input.agentControllerPermissionMode
      ? { agentControllerPermissionMode: input.agentControllerPermissionMode }
      : {}),
    ...(input.agentControllerCollaborationMode
      ? {
          agentControllerCollaborationMode:
            input.agentControllerCollaborationMode,
        }
      : {}),
    bindingState: input.bindingState,
    resolutionSource: input.resolutionSource,
    reasonCodes: input.reasonCodes,
    routable: input.routable,
  };
};

export const createAgentProfileBindingDisplayProjection = (
  input: AgentProfileBindingDisplayProjectionInput
): AgentProfileBindingDisplayProjection => {
  const agentProfileId = normalizeRequiredString({
    fieldName: "agentProfileId",
    value: input.agentProfileId,
    errorCode: "agent_profile_binding.projection_invalid",
  });
  const bindingId = resolveBindingId(input);
  const bindingState = input.bindingState;
  const reasonCodes = resolveReasonCodes({
    bindingState,
    reasonCodes: input.reasonCodes,
  });
  const executionTarget = resolveExecutionTargetForProjection(input);
  const agentControllerPermissionMode =
    resolveAgentControllerPermissionModeForProjection(input);
  const agentControllerCollaborationMode =
    resolveAgentControllerCollaborationModeForProjection(input);
  const modelSelection = resolveModelSelectionForProjection(input);
  const openCodePermission = resolveOpenCodePermissionForProjection(input);
  const resolutionSource = resolveResolutionSource(bindingState);
  const dispatchEligibility = resolveDispatchEligibility({
    bindingState,
    reasonCodes,
  });
  const dispatchReadableFacts = createDispatchReadableFacts({
    agentProfileId,
    bindingId,
    bindingState,
    executionTarget,
    agentControllerCollaborationMode,
    agentControllerPermissionMode,
    modelSelection,
    openCodePermission,
    resolutionSource,
    reasonCodes,
    routable: dispatchEligibility.routable,
  });

  return {
    agentProfileId,
    bindingId,
    bindingState,
    resolutionSource,
    authoritySource: resolveAuthoritySource(bindingState),
    executionTarget,
    ...(agentControllerCollaborationMode
      ? { agentControllerCollaborationMode }
      : {}),
    ...(agentControllerPermissionMode ? { agentControllerPermissionMode } : {}),
    ...(modelSelection ? { modelSelection } : {}),
    ...(openCodePermission ? { openCodePermission } : {}),
    dispatchEligibility,
    dispatchReadableFacts,
    reasonCodes,
    diagnosticPointer: createDiagnosticPointer({
      agentProfileId,
      bindingId,
      executionTarget,
      resolutionSource,
      reasonCodes,
      diagnosticPointer: input.diagnosticPointer,
    }),
  };
};

function isOpenCodeAgentControllerRef(agentControllerRef: string): boolean {
  const parsed = parseAgentControllerRef(agentControllerRef);
  return parsed?.kind === "builtin" && parsed.id === "opencode";
}

export const resolveAgentProfileBindingTruthWriteBoundary = (input: {
  writer: AgentProfileBindingTruthWriter;
}): AgentProfileBindingTruthWriteBoundary => {
  if (input.writer === "binding_command") {
    return {
      allowed: true,
      reasonCodes: ["agent_profile_binding.writer_allowed"],
    };
  }
  return {
    allowed: false,
    reasonCodes: ["agent_profile_binding.writer_forbidden"],
  };
};

export const assertAgentProfileBindingTruthWriterAllowed = (input: {
  writer: AgentProfileBindingTruthWriter;
}): void => {
  const boundary = resolveAgentProfileBindingTruthWriteBoundary(input);
  if (boundary.allowed) {
    return;
  }
  throw new Error(
    `agent_profile_binding.writer_forbidden: ${input.writer} cannot write Binding truth directly`
  );
};

const isAuthorityOpenMeldServiceRuntimeId = (
  value: unknown
): value is AuthorityOpenMeldServiceRuntimeId => {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const candidate = value as Partial<AuthorityOpenMeldServiceRuntimeId>;
  return (
    candidate.source === "runtime_registry_authority" &&
    typeof candidate.value === "string" &&
    candidate.value.trim().length > 0
  );
};

const resolveEligibilityAuthorityOpenMeldServiceRuntimeId = (
  input: AgentProfileBindingCommandEligibilityAgentControllerReportInput
):
  | {
      ok: true;
      openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
    }
  | {
      ok: false;
    } => {
  if (
    !(
      isAuthorityOpenMeldServiceRuntimeId(input.openMeldServiceRuntimeId) &&
      input.runtimeLookupInput
    )
  ) {
    return {
      ok: false,
    };
  }

  try {
    return {
      ok: true,
      openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
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
};

const resolveEligibilityAgentControllerReport = (
  input:
    | AgentProfileBindingCommandEligibilityAgentControllerReportInput
    | undefined
):
  | {
      ok: true;
      executionTarget: AgentProfileBindingExecutionTarget;
    }
  | {
      ok: false;
      reasonCode: string;
      executionTarget: null;
    } => {
  if (!input) {
    return {
      ok: false,
      reasonCode: "agent_profile_binding.agent_controller_report_missing",
      executionTarget: null,
    };
  }

  const agentControllerRef = input.agentControllerRef?.trim();
  const openMeldServiceRuntimeId =
    resolveEligibilityAuthorityOpenMeldServiceRuntimeId(input);
  if (!(openMeldServiceRuntimeId.ok && agentControllerRef)) {
    return {
      ok: false,
      reasonCode: "agent_profile_binding.agent_controller_report_invalid",
      executionTarget: null,
    };
  }

  if (!parseAgentControllerRef(agentControllerRef)) {
    return {
      ok: false,
      reasonCode: "agent_profile_binding.agent_controller_report_invalid",
      executionTarget: null,
    };
  }

  return {
    ok: true,
    executionTarget: {
      openMeldServiceRuntimeId:
        openMeldServiceRuntimeId.openMeldServiceRuntimeId.value,
      agentControllerRef,
      ...(normalizeOptionalString(input.agentControllerConversationId)
        ? {
            agentControllerConversationId: normalizeOptionalString(
              input.agentControllerConversationId
            ),
          }
        : {}),
    },
  };
};

const getCommandEligibilityTimestamp = (
  value: Date | string | undefined,
  fieldName: string
): number | null => {
  if (!value) {
    return null;
  }
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(
      `agent_profile_binding.agent_controller_report_time_invalid: ${fieldName} is invalid`
    );
  }
  return timestamp;
};

const resolveAgentControllerReportAvailabilityBlockReason = (input: {
  executionTarget: AgentProfileBindingExecutionTarget;
  runtimeAgentControllerReport?: RuntimeAgentControllerReport;
  runtimeOwnerMatches?: boolean;
  now?: Date | string;
}): string | null => {
  if (input.runtimeOwnerMatches === false) {
    return "agent_profile_binding.runtime_owner_mismatch";
  }
  const report = input.runtimeAgentControllerReport;
  if (
    !report ||
    report.agentControllerRef !== input.executionTarget.agentControllerRef
  ) {
    return "agent_profile_binding.agent_controller_report_missing";
  }

  const now = getCommandEligibilityTimestamp(input.now, "now");
  if (now === null) {
    return "agent_profile_binding.agent_controller_report_stale";
  }
  const expiresAt = getCommandEligibilityTimestamp(
    report.expiresAt,
    "expiresAt"
  );
  if (expiresAt !== null && expiresAt <= now) {
    return "agent_profile_binding.agent_controller_report_stale";
  }

  switch (report.status) {
    case "ready":
      return null;
    case "disabled":
      return "agent_profile_binding.agent_controller_report_disabled";
    case "unavailable":
    case "unknown":
      return "agent_profile_binding.agent_controller_report_unavailable";
    default:
      return assertUnreachable(report.status);
  }
};

export const resolveAgentProfileBindingCommandEligibility = (
  input: AgentProfileBindingCommandEligibilityInput
): AgentProfileBindingCommandEligibility => {
  normalizeRequiredString({
    fieldName: "agentProfileId",
    value: input.agentProfileId,
    errorCode: "agent_profile_binding.command_eligibility_invalid",
  });

  if (input.ownerAuthorization.status !== "allowed") {
    return {
      bindable: false,
      routable: false,
      grantsClaimSuccess: false,
      executionTarget: null,
      reasonCodes: [input.ownerAuthorization.reasonCode],
    };
  }

  if (input.profileOwnerValidation.status !== "valid") {
    return {
      bindable: false,
      routable: false,
      grantsClaimSuccess: false,
      executionTarget: null,
      reasonCodes: [input.profileOwnerValidation.reasonCode],
    };
  }

  const executionTarget = resolveEligibilityAgentControllerReport(
    input.executionTarget
  );
  if (!executionTarget.ok) {
    return {
      bindable: false,
      routable: false,
      grantsClaimSuccess: false,
      executionTarget: executionTarget.executionTarget,
      reasonCodes: [executionTarget.reasonCode],
    };
  }

  const executionTargetBlockReason =
    resolveAgentControllerReportAvailabilityBlockReason({
      executionTarget: executionTarget.executionTarget,
      runtimeAgentControllerReport: input.runtimeAgentControllerReport,
      runtimeOwnerMatches: input.runtimeOwnerMatches,
      now: input.now,
    });
  if (executionTargetBlockReason) {
    return {
      bindable: false,
      routable: false,
      grantsClaimSuccess: false,
      executionTarget: executionTarget.executionTarget,
      reasonCodes: [executionTargetBlockReason],
    };
  }

  return {
    bindable: true,
    routable: true,
    grantsClaimSuccess: false,
    executionTarget: executionTarget.executionTarget,
    reasonCodes: ["agent_profile_binding.command_eligible"],
  };
};

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled Agent Profile Binding value: ${String(value)}`);
}
