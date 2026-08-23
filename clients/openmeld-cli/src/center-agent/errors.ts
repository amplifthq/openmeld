import {
  type StructuredApiClientFailure,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { StoredActiveOrganization } from "../config/auth-session";
import type { Presenter } from "../runtime/presenter/types";
import { renderHumanErrorCard } from "../ui/human-error-card";

export type CenterAgentCommandOperation =
  | "audit"
  | "ask"
  | "context"
  | "context_receipt"
  | "designate"
  | "pause"
  | "resume"
  | "status";

export type CenterAgentCommandErrorInput = {
  activeOrganization?: StoredActiveOrganization | null;
  agentProfileId?: string;
  code: string;
  details?: Array<{ label: string; value: string }>;
  message: string;
  nextStep: string;
  payload?: Record<string, unknown>;
  presenter: Presenter;
  title: string;
};

export function emitCenterAgentApiError(input: {
  activeOrganization: StoredActiveOrganization;
  agentProfileId?: string;
  error: unknown;
  operation: CenterAgentCommandOperation;
  presenter: Presenter;
}): void {
  const failure = toStructuredApiClientFailure(input.error);
  const classified = classifyCenterAgentApiFailure({
    failure,
    operation: input.operation,
  });
  emitCenterAgentCommandError({
    activeOrganization: input.activeOrganization,
    agentProfileId: input.agentProfileId,
    code: classified.code,
    details: buildFailureDetails(failure),
    message: classified.message,
    nextStep: classified.nextStep,
    payload: {
      ...(input.agentProfileId ? { agentProfileId: input.agentProfileId } : {}),
      failure: {
        code: failure.code,
        requestId: failure.requestId,
        schemaIssueMessage: failure.schemaIssueMessage,
        status: failure.status,
        upstreamCode: failure.upstreamCode,
      },
    },
    presenter: input.presenter,
    title: classified.title,
  });
}

function classifyCenterAgentApiFailure(input: {
  failure: StructuredApiClientFailure;
  operation: CenterAgentCommandOperation;
}): {
  code: string;
  message: string;
  nextStep: string;
  title: string;
} {
  if (
    input.failure.status === 401 ||
    hasFailureCode(input.failure, "auth.unauthenticated")
  ) {
    return {
      code: "center_agent.auth_required",
      message:
        "OpenMeld could not verify your sign-in for this Center Agent command.",
      nextStep: "Run `openmeld login`, then retry this command.",
      title: "Sign In Needed",
    };
  }

  if (hasFailureCode(input.failure, "center_agent.creator_required")) {
    return {
      code: "center_agent.creator_required",
      message:
        "Only the Organization creator can pause or resume the Center Agent.",
      nextStep:
        "Ask the Organization creator to run this command for the active Organization.",
      title: "Organization Creator Needed",
    };
  }

  if (
    hasFailureCode(
      input.failure,
      "organization.context_required",
      "organization.context_unavailable",
      "organization.membership_required"
    )
  ) {
    return {
      code: "center_agent.organization_required",
      message:
        "OpenMeld could not resolve an active Organization for this Center Agent command.",
      nextStep: "Run `openmeld org list`, then `openmeld org switch <slug>`.",
      title: "No Active Organization",
    };
  }

  if (
    hasFailureCode(
      input.failure,
      "center_agent.permission_required",
      "organization.role_required"
    )
  ) {
    return {
      code: "center_agent.owner_or_admin_required",
      message:
        "Only an Organization owner or admin can change the Center Agent designation.",
      nextStep:
        "Run `openmeld org current` to confirm the active Organization, then ask an owner or admin for access.",
      title: "Owner Or Admin Needed",
    };
  }

  if (hasFailureCode(input.failure, "center_agent.profile_not_found")) {
    return {
      code: "center_agent.profile_not_found",
      message: "OpenMeld could not find that Agent Profile.",
      nextStep: "Check the Agent Profile ID, then retry this command.",
      title: "Agent Profile Not Found",
    };
  }

  if (hasFailureCode(input.failure, "center_agent.profile_invalid")) {
    return {
      code: "center_agent.profile_invalid",
      message: "Only an Agent Profile can be designated as the Center Agent.",
      nextStep: "Choose an Agent Profile ID, then retry this command.",
      title: "Agent Profile Required",
    };
  }

  if (hasFailureCode(input.failure, "center_agent.profile_org_mismatch")) {
    return {
      code: "center_agent.profile_org_mismatch",
      message: "That Agent Profile does not belong to the active Organization.",
      nextStep:
        "Run `openmeld org current` and choose an Agent Profile from that Organization.",
      title: "Agent Profile Not In Organization",
    };
  }

  if (hasFailureCode(input.failure, "center_agent.profile_binding_required")) {
    return {
      code: "center_agent.profile_binding_required",
      message:
        "Designating a self-hosted Center Agent requires your enabled primary Binding for that Agent Profile.",
      nextStep:
        "Run `openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id>`, then retry designation.",
      title: "Agent Profile Binding Needed",
    };
  }

  if (hasFailureCode(input.failure, "center_agent.profile_details_missing")) {
    return {
      code: "center_agent.profile_details_missing",
      message:
        "The Center Agent designation exists, but its Agent Profile is not visible in the Organization directory.",
      nextStep: "Retry after OpenMeld refreshes the Organization directory.",
      title: "Center Agent Profile Missing",
    };
  }

  if (
    hasFailureCode(input.failure, "center_agent.context_token_budget_too_small")
  ) {
    return {
      code: "center_agent.context_token_budget_too_small",
      message:
        "The next visible message needs more context space than this token budget allows.",
      nextStep:
        "Retry with `openmeld center-agent context --max-tokens 8000`. OpenMeld did not skip the message.",
      title: "Context Token Budget Too Small",
    };
  }

  if (
    hasFailureCode(input.failure, "center_agent.context_conversation_required")
  ) {
    return {
      code: "center_agent.context_conversation_required",
      message: "There is no Center Agent conversation to read yet.",
      nextStep:
        'Run `openmeld center-agent ask "What should we work on?"`, then retry this command.',
      title: "Start A Center Agent Conversation",
    };
  }

  if (
    hasFailureCode(input.failure, "center_agent.context_manifest_not_found")
  ) {
    return {
      code: "center_agent.context_manifest_not_found",
      message:
        "That Center Agent context snapshot is unavailable or belongs to a different member.",
      nextStep:
        "Request fresh context with `openmeld center-agent context`, then report the new manifest load.",
      title: "Fresh Center Agent Context Needed",
    };
  }

  if (
    hasFailureCode(input.failure, "center_agent.context_load_manifest_empty")
  ) {
    return {
      code: "center_agent.context_load_manifest_empty",
      message:
        "This context snapshot has no verifiable messages to record as loaded.",
      nextStep:
        "Request fresh context with `openmeld center-agent context`. Older snapshots cannot be turned into load receipts.",
      title: "Fresh Center Agent Context Needed",
    };
  }

  if (
    hasFailureCode(input.failure, "center_agent.context_load_client_mismatch")
  ) {
    return {
      code: "center_agent.context_load_client_mismatch",
      message:
        "The Local Agent reporting this load is different from the one that requested the context.",
      nextStep:
        "Report the load from the original Local Agent, or request fresh context from the current one.",
      title: "Local Agent Does Not Match",
    };
  }

  if (
    hasFailureCode(input.failure, "center_agent.context_load_already_recorded")
  ) {
    return {
      code: "center_agent.context_load_already_recorded",
      message:
        "This context snapshot already has a different load receipt, so OpenMeld will not overwrite its audit history.",
      nextStep:
        "Request fresh context before loading a different set of messages.",
      title: "Context Load Already Recorded",
    };
  }

  if (
    hasFailureCode(
      input.failure,
      "center_agent.context_load_selection_duplicate",
      "center_agent.context_load_selection_invalid"
    )
  ) {
    return {
      code: "center_agent.context_load_selection_invalid",
      message:
        "The reported messages do not exactly match the sources and content hashes in this context snapshot.",
      nextStep:
        "Use each loaded message's exact sourceRef.id and materializedContentHash once, or report `--all`.",
      title: "Context Load Does Not Match",
    };
  }

  if (input.failure.code === "gateway.invalid_response") {
    return {
      code: "center_agent.response_invalid",
      message: "OpenMeld returned an invalid Center Agent response.",
      nextStep: "Retry after OpenMeld Gateway is updated and healthy.",
      title: "Center Agent Response Invalid",
    };
  }

  if (
    hasFailureCode(
      input.failure,
      "center_agent.audit_store_unavailable",
      "center_agent.designation_store_unavailable"
    )
  ) {
    return {
      code: "center_agent.store_unavailable",
      message:
        "OpenMeld could not reach the Center Agent designation or audit store.",
      nextStep: "Retry after OpenMeld is healthy.",
      title: "Center Agent Store Unavailable",
    };
  }

  const operationLabel = formatCenterAgentOperationLabel(input.operation);
  return {
    code: `center_agent.${input.operation}_failed`,
    message: `OpenMeld could not ${operationLabel}.`,
    nextStep: "Retry after OpenMeld Gateway is reachable.",
    title: "Center Agent action couldn't finish",
  };
}

export function emitCenterAgentCommandError(
  input: CenterAgentCommandErrorInput
): void {
  process.exitCode = 1;
  const payload = {
    status: "error",
    organization: {
      active: input.activeOrganization ?? null,
    },
    error: {
      code: input.code,
      message: input.message,
      nextStep: input.nextStep,
    },
    ...(input.agentProfileId ? { agentProfileId: input.agentProfileId } : {}),
    ...(input.details ? { details: input.details } : {}),
    ...(input.payload ?? {}),
  };

  if (input.presenter.view === "human") {
    renderHumanErrorCard({
      codePrefix: "center-agent.error.card",
      message: input.message,
      nextStep: input.nextStep,
      presenter: input.presenter,
      title: input.title,
    });
    return;
  }

  input.presenter.data({
    code: input.code,
    payload,
  });
}

function buildFailureDetails(
  failure: StructuredApiClientFailure
): Array<{ label: string; value: string }> {
  return [
    ...(failure.status === null
      ? []
      : [{ label: "HTTP Status", value: String(failure.status) }]),
    ...(failure.requestId
      ? [{ label: "Request ID", value: failure.requestId }]
      : []),
    ...(failure.upstreamCode
      ? [{ label: "Upstream Code", value: failure.upstreamCode }]
      : []),
    ...(failure.schemaIssueMessage
      ? [{ label: "Schema Issue", value: failure.schemaIssueMessage }]
      : []),
  ];
}

function hasFailureCode(
  failure: StructuredApiClientFailure,
  ...codes: string[]
): boolean {
  return codes.some(
    (code) => failure.code === code || failure.upstreamCode === code
  );
}

function formatCenterAgentOperationLabel(
  operation: CenterAgentCommandOperation
): string {
  if (operation === "audit") {
    return "list Center Agent audit entries";
  }
  if (operation === "ask") {
    return "send this request to the Center Agent";
  }
  if (operation === "context") {
    return "read your Center Agent context";
  }
  if (operation === "context_receipt") {
    return "record this Center Agent Context Load Receipt";
  }
  if (operation === "designate") {
    return "designate this Center Agent";
  }
  if (operation === "pause") {
    return "pause the Center Agent";
  }
  if (operation === "resume") {
    return "resume the Center Agent";
  }
  return "read the Center Agent designation";
}
