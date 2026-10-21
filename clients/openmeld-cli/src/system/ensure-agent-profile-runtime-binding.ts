import {
  createAuthorityOpenMeldServiceRuntimeId,
  isAgentExecutionReadyOrConnecting,
} from "@openmeld/agent-runtime";
import { createAgentProfileBindingApi } from "@openmeld/api-client";
import type {
  AgentControllerCollaborationMode,
  AgentControllerPermissionMode,
  EnsureAgentProfilePrimaryBindingResponse,
  GetAgentExecutionReadinessResponse,
  OpenCodePermissionConfig,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { sleep } from "@openmeld/utils";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import {
  type RuntimeAgentControllerReportSubmission,
  submitProfileRuntimeAgentControllerReport,
} from "../local-service/reporting/runtime-agent-controller-reporting-submission";
import { computeRetryDelayMs } from "../runtime/retry-delay";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { assessActionParticipationCandidate } from "./action-participation-planner";
import { selectAssistantBindingSupportCode } from "./assistant-binding-support-code";
import { resolveCurrentReplyReadinessSnapshot } from "./current-reply-readiness-snapshot";
import { resolveServiceParticipationReadiness } from "./service-participation-readiness";

// computeRetryDelayMs schedule (250/500/1000/2000ms) sums to 5750ms across 5
// sleeps, matching (and not undershooting) the prior fixed 8 x 500ms = 4000ms
// budget before giving up.
const EXECUTION_READINESS_AFTER_BINDING_MAX_ATTEMPTS = 5;

export type AgentProfileRuntimeBindingEnsureResult = {
  existingBinding?: AgentProfileRuntimeBindingExistingBinding;
  source: "agent_profile_binding_api";
  status: "accepted" | "rejected" | "skipped" | "unavailable";
  outcome?: "created" | "reused" | "reconnected";
  reason?:
    | "binding_rejected"
    | "binding_write_failed"
    | "local_execution_evidence_unavailable"
    | "profile_not_agent"
    | "runtime_reporting_unavailable";
  reasonCodes: string[];
  routable: boolean;
};

export type AgentProfileRuntimeBindingExistingBinding = {
  agentControllerConversationId?: string | null;
  agentControllerRef: string;
  openMeldServiceRuntimeId: string;
  agentProfileId?: string;
  bindingId?: string;
  bindingState?: "enabled_primary" | "disabled_historical";
  createdAtMs?: number;
  createdByProfileId?: string | null;
  disabledAtMs?: number | null;
  owner?: {
    id: string;
    kind: "owner_account";
  };
  reasonCode?: string | null;
  updatedAtMs?: number;
  agentControllerPermissionMode?: string | null;
  modelId?: string | null;
  reasoningLevel?: string | null;
};

export async function ensureAgentProfileRuntimeBinding(input: {
  agentControllerCollaborationMode?: AgentControllerCollaborationMode;
  agentControllerConversationId?: string | null;
  agentControllerPermissionMode?: AgentControllerPermissionMode | null;
  confirmLocalExecutionEvidence?: boolean;
  modelId?: string | null;
  openCodePermission?: OpenCodePermissionConfig;
  profile: OpenMeldProfile;
  reasoningLevel?: string | null;
  runtimeReportSubmission: RuntimeAgentControllerReportSubmission;
  writeMode?: "ensure" | "reconnect";
}): Promise<AgentProfileRuntimeBindingEnsureResult> {
  if (input.profile.profileKind !== "agent") {
    return {
      reason: "profile_not_agent",
      reasonCodes: ["agent_profile_binding.profile_not_agent"],
      routable: false,
      source: "agent_profile_binding_api",
      status: "skipped",
    };
  }

  const bindingInput = tryResolveBindingInput(input.runtimeReportSubmission);
  if (!bindingInput) {
    return {
      reason: "runtime_reporting_unavailable",
      reasonCodes: ["agent_profile_binding.runtime_reporting_unavailable"],
      routable: false,
      source: "agent_profile_binding_api",
      status: "unavailable",
    };
  }

  try {
    const gatewayUrl = await resolveBaseUrl();
    const api = createAgentProfileBindingApi(
      createCliApiClientFoundation(gatewayUrl)
    );
    const requestContext = buildOpenMeldRequestContextFromProfile({
      openMeldProfile: input.profile,
    });
    const agentControllerConversationId = normalizeOptionalText(
      input.agentControllerConversationId
    );
    const modelId = normalizeOptionalText(input.modelId);
    const reasoningLevel = modelId
      ? normalizeOptionalText(input.reasoningLevel)
      : null;
    const response = await api.ensurePrimaryBinding({
      agentProfileId: input.profile.openMeldProfileId,
      ...(input.agentControllerCollaborationMode
        ? {
            agentControllerCollaborationMode:
              input.agentControllerCollaborationMode,
          }
        : {}),
      ...(input.agentControllerPermissionMode
        ? { agentControllerPermissionMode: input.agentControllerPermissionMode }
        : {}),
      ...(agentControllerConversationId
        ? { agentControllerConversationId }
        : {}),
      agentControllerRef: bindingInput.agentControllerRef,
      deviceId: bindingInput.deviceId,
      lane: bindingInput.lane,
      requestContext,
      openMeldServiceRuntimeId: bindingInput.openMeldServiceRuntimeId,
      ...(modelId ? { modelId } : {}),
      ...(input.openCodePermission
        ? { openCodePermission: input.openCodePermission }
        : {}),
      ...(reasoningLevel ? { reasoningLevel } : {}),
      ...(input.writeMode === undefined ? {} : { writeMode: input.writeMode }),
    });

    if (response.status === "accepted") {
      if (input.confirmLocalExecutionEvidence === false) {
        return {
          outcome: response.outcome,
          reasonCodes: uniqueReasonCodes(response.reasonCodes),
          routable: response.routable,
          source: "agent_profile_binding_api",
          status: "accepted",
        };
      }

      const localExecutionEvidence =
        await confirmLocalExecutionEvidenceAfterBinding({
          agentProfileId: input.profile.openMeldProfileId,
          api,
          requestContext,
        });
      if (localExecutionEvidence.status !== "accepted") {
        // Readiness assembles reason codes profile -> binding -> ... so a clean
        // profile and healthy Binding surface the success code
        // agent_profile_binding.command_eligible as [0] while the real blockers
        // come later. Lead with a truthful support code so every consumer that
        // reads reasonCodes[0] sees the blocker, not a success code. The full
        // list is preserved after it for diagnostics.
        return {
          reason: "local_execution_evidence_unavailable",
          reasonCodes: orderReasonCodesBySupportRelevance({
            reason: "local_execution_evidence_unavailable",
            reasonCodes: localExecutionEvidence.reasonCodes,
          }),
          routable: false,
          source: "agent_profile_binding_api",
          status: "unavailable",
        };
      }

      return {
        outcome: response.outcome,
        reasonCodes: uniqueReasonCodes([
          ...response.reasonCodes,
          ...localExecutionEvidence.reasonCodes,
        ]),
        routable: response.routable,
        source: "agent_profile_binding_api",
        status: "accepted",
      };
    }

    const existingBinding = resolveExistingBindingFromCommandResponse(response);
    return {
      ...(existingBinding ? { existingBinding } : {}),
      reason: "binding_rejected",
      reasonCodes: response.reasonCodes,
      routable: false,
      source: "agent_profile_binding_api",
      status: "rejected",
    };
  } catch (error) {
    console.warn("[openmeld.agent_profile_binding.ensure_failed]", {
      error: toErrorMessage(error),
      event: "cli.agent_profile_binding.ensure_failed",
      profileId: input.profile.openMeldProfileId,
    });
    return {
      reason: "binding_write_failed",
      reasonCodes: ["agent_profile_binding.write_failed"],
      routable: false,
      source: "agent_profile_binding_api",
      status: "unavailable",
    };
  }
}

type AgentProfileBindingApi = ReturnType<typeof createAgentProfileBindingApi>;

function resolveExistingBindingFromCommandResponse(
  response: EnsureAgentProfilePrimaryBindingResponse
): AgentProfileRuntimeBindingExistingBinding | null {
  const executionTarget = response.binding?.executionTarget ?? null;
  const agentControllerRef = normalizeOptionalText(
    executionTarget?.agentControllerRef
  );
  const openMeldServiceRuntimeId = normalizeOptionalText(
    executionTarget?.openMeldServiceRuntimeId.value
  );
  if (!(agentControllerRef && openMeldServiceRuntimeId)) {
    return null;
  }
  return {
    agentControllerRef,
    openMeldServiceRuntimeId,
    ...(response.binding?.agentProfileId
      ? { agentProfileId: response.binding.agentProfileId }
      : {}),
    ...(executionTarget?.agentControllerConversationId
      ? {
          agentControllerConversationId:
            executionTarget.agentControllerConversationId,
        }
      : {}),
  };
}

async function confirmLocalExecutionEvidenceAfterBinding(input: {
  agentProfileId: string;
  api: AgentProfileBindingApi;
  requestContext: OpenMeldRequestContext;
}): Promise<
  | {
      reasonCodes: readonly string[];
      status: "accepted";
    }
  | {
      reasonCodes: readonly string[];
      status: "unavailable";
    }
> {
  const notification = await input.api.notifyRouteCatalogChanged({
    agentProfileId: input.agentProfileId,
    reason: "agent_profile_binding_changed",
    requestContext: input.requestContext,
  });
  if (!notification.ok || notification.notifiedSessions < 1) {
    return {
      reasonCodes: ["agent_profile_binding.local_service_not_connected"],
      status: "unavailable",
    };
  }

  const readiness = await waitForExecutionReadinessAfterBinding(input);
  if (!readiness) {
    return {
      reasonCodes: ["agent_profile_binding.execution_readiness_pending"],
      status: "unavailable",
    };
  }
  if (isAgentExecutionReadyOrConnecting(readiness.agentExecutionReadiness)) {
    return {
      reasonCodes: readiness.agentExecutionReadiness.reasonCodes,
      status: "accepted",
    };
  }
  return {
    reasonCodes: readiness.agentExecutionReadiness.reasonCodes,
    status: "unavailable",
  };
}

async function waitForExecutionReadinessAfterBinding(input: {
  agentProfileId: string;
  api: AgentProfileBindingApi;
  requestContext: OpenMeldRequestContext;
}): Promise<GetAgentExecutionReadinessResponse | null> {
  let latest: GetAgentExecutionReadinessResponse | null = null;
  for (
    let attempt = 1;
    attempt <= EXECUTION_READINESS_AFTER_BINDING_MAX_ATTEMPTS;
    attempt++
  ) {
    latest = await input.api.getExecutionReadiness({
      agentProfileId: input.agentProfileId,
      requestContext: input.requestContext,
    });
    if (isAgentExecutionReadyOrConnecting(latest.agentExecutionReadiness)) {
      return latest;
    }
    await sleep(computeRetryDelayMs(attempt));
  }
  return latest;
}

export async function syncAgentProfileRuntimeBindingFromCurrentReadiness(input: {
  agentControllerConversationId?: string | null;
  profile: OpenMeldProfile;
}): Promise<{
  agentProfileBindingEnsure: AgentProfileRuntimeBindingEnsureResult;
  runtimeReportSubmission: RuntimeAgentControllerReportSubmission;
}> {
  if (input.profile.profileKind !== "agent") {
    const runtimeReportSubmission: RuntimeAgentControllerReportSubmission = {
      reason: "agent_controller_ref_unavailable",
      reasonCodes: ["runtime.reporting.profile_not_agent"],
      source: "runtime_reporting_api",
      status: "unavailable",
    };
    return {
      agentProfileBindingEnsure: await ensureAgentProfileRuntimeBinding({
        agentControllerConversationId: input.agentControllerConversationId,
        profile: input.profile,
        runtimeReportSubmission,
      }),
      runtimeReportSubmission,
    };
  }

  const snapshot = await resolveCurrentReplyReadinessSnapshot({
    checkGatewayChain: true,
    includeDaemonRouteObservation: true,
    openClawDiagnosticsMode: "repair",
    ownerUserId: input.profile.ownerUserId,
    profile: input.profile,
  });
  const serviceReadiness = resolveServiceParticipationReadiness({
    deviceReplyReadiness: snapshot.deviceReplyReadiness,
    inventory: snapshot.inventory,
    runtimeStatus: snapshot.displayRuntimeStatus ?? snapshot.runtimeStatus,
  });
  const assessment = assessActionParticipationCandidate({
    profileId: input.profile.openMeldProfileId,
    profileName: input.profile.profileName,
    profileKind: input.profile.profileKind,
    localParticipationReadiness: serviceReadiness.serviceReadiness,
    localParticipationReasonCodes: snapshot.deviceReplyReadiness.reasonCodes,
  });
  const runtimeReportSubmission =
    await submitProfileRuntimeAgentControllerReport({
      localParticipationState: assessment.localParticipationState,
      profile: input.profile,
      reasonCodes: assessment.reasonCodes,
    });
  return {
    agentProfileBindingEnsure: await ensureAgentProfileRuntimeBinding({
      agentControllerConversationId: input.agentControllerConversationId,
      profile: input.profile,
      runtimeReportSubmission,
    }),
    runtimeReportSubmission,
  };
}

function tryResolveBindingInput(
  submission: RuntimeAgentControllerReportSubmission
): {
  agentControllerRef: string;
  deviceId: string;
  lane: string;
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
} | null {
  if (
    submission.status !== "submitted" ||
    submission.agentControllerReportStatus !== "accepted" ||
    !submission.agentControllerRef ||
    !submission.deviceId ||
    !submission.lane ||
    !submission.openMeldServiceRuntimeId
  ) {
    return null;
  }

  let openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
  try {
    openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: submission.openMeldServiceRuntimeId,
      source: "runtime_registry_authority",
    });
  } catch {
    return null;
  }

  return {
    agentControllerRef: submission.agentControllerRef,
    deviceId: submission.deviceId,
    lane: submission.lane,
    openMeldServiceRuntimeId,
  };
}

// The message a command shows when Core refuses its Binding write. Codes stay
// in the message so scripts and support can still match them.
export function formatAgentProfileBindingUpdateFailure(
  reasonCodes: readonly string[]
): string {
  const codes = reasonCodes.join(", ");
  if (
    reasonCodes.includes("agent_profile_binding.member_agent_harness_locked")
  ) {
    return `This Agent Profile belongs to an Agent and cannot move to another harness. Create a Profile under that harness's Agent instead. (${codes})`;
  }
  return `Agent Profile Binding update failed: ${codes}`;
}

function uniqueReasonCodes(reasonCodes: readonly string[]): string[] {
  return [...new Set(reasonCodes)];
}

// Lead the reason-code list with a truthful support code (never a success
// code) while preserving the rest for diagnostics, so consumers that read
// reasonCodes[0] see the blocker.
function orderReasonCodesBySupportRelevance(input: {
  reason: string;
  reasonCodes: readonly string[];
}): string[] {
  const supportCode = selectAssistantBindingSupportCode({
    reason: input.reason,
    reasonCodes: input.reasonCodes,
  });
  return uniqueReasonCodes([supportCode, ...input.reasonCodes]);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "unknown error";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "unknown error";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
