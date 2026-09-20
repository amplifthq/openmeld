import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
  AgentProfileCreationApprovalPolicy,
  AgentProfileCreationRequest,
} from "@openmeld/schemas/types";
import type { Presenter } from "../runtime/presenter/types";
import { renderHumanErrorCard } from "../ui/human-error-card";
import { renderInfoCard } from "../ui/info-card";
import type { ProfileCreationRequestCommandContext } from "./context";
import { ProfileCreationRequestCliError } from "./input";

export function emitRequest(input: {
  code: string;
  context: ProfileCreationRequestCommandContext;
  replayed?: boolean;
  request: AgentProfileCreationRequest;
  title: string;
}): void {
  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.data({
      code: input.code,
      payload: {
        organization: input.context.organization,
        ...(input.replayed === undefined ? {} : { replayed: input.replayed }),
        request: input.request,
      },
    });
    return;
  }
  renderInfoCard({
    codePrefix: "profile.creation-request.card",
    minContentWidth: 72,
    presenter: input.context.presenter,
    rows: buildRequestRows(input.request),
    sanitize: true,
    title: input.title,
  });
}

export function emitRequestList(input: {
  context: ProfileCreationRequestCommandContext;
  requests: AgentProfileCreationRequest[];
}): void {
  if (input.requests.length === 0) {
    renderInfoCard({
      codePrefix: "profile.creation-request.list.card",
      minContentWidth: 72,
      presenter: input.context.presenter,
      rows: [
        { label: "Organization", value: input.context.organization.name },
        { label: "Requests", value: "No Agent Profile requests yet." },
      ],
      sanitize: true,
      title: "Agent Profile Requests",
    });
    return;
  }

  for (const request of input.requests) {
    renderInfoCard({
      codePrefix: "profile.creation-request.list.card",
      compact: true,
      minContentWidth: 72,
      presenter: input.context.presenter,
      rows: buildRequestRows(request),
      sanitize: true,
      title: request.profileName,
    });
  }
}

export function emitPreference(input: {
  context: ProfileCreationRequestCommandContext;
  preference: {
    existingSessionPolicy: AgentProfileCreationApprovalPolicy;
    newSessionPolicy: AgentProfileCreationApprovalPolicy;
    organizationId: string;
    updatedAt: string | null;
    userId: string;
  };
  title: string;
}): void {
  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.data({
      code: "profile.creation_request.preferences",
      payload: { preference: input.preference },
    });
    return;
  }
  renderInfoCard({
    codePrefix: "profile.creation-request.preferences.card",
    minContentWidth: 72,
    presenter: input.context.presenter,
    rows: [
      { label: "New Sessions", value: input.preference.newSessionPolicy },
      {
        label: "Existing Sessions",
        value: input.preference.existingSessionPolicy,
      },
    ],
    sanitize: true,
    title: input.title,
  });
}

export function emitCommandError(input: {
  context: ProfileCreationRequestCommandContext;
  error: unknown;
  operation: string;
}): void {
  if (input.error instanceof ProfileCreationRequestCliError) {
    emitLocalError({
      code: input.error.code,
      message: input.error.message,
      nextStep: input.error.nextStep,
      presenter: input.context.presenter,
      title: input.error.title,
    });
    return;
  }

  const failure = toStructuredApiClientFailure(input.error);
  const sessionUnavailable = hasFailureCode(
    failure,
    "agent_profile_creation_request.session_strategy_unavailable"
  );
  emitLocalError({
    code: failure.code ?? `profile.creation_request.${input.operation}_failed`,
    details: [
      ...(failure.status === null
        ? []
        : [{ label: "HTTP Status", value: String(failure.status) }]),
      ...(failure.requestId
        ? [{ label: "Request ID", value: failure.requestId }]
        : []),
    ],
    message: sessionUnavailable
      ? "OpenMeld cannot verify Resume or Fork against the selected local Session yet."
      : `OpenMeld could not ${input.operation} this Agent Profile request.`,
    nextStep: sessionUnavailable
      ? "Use a new-session request for now. Resume and Fork will become available through Agent Activity session verification."
      : "Check the request status and Organization, then retry.",
    presenter: input.context.presenter,
    title: sessionUnavailable
      ? "Resume and Fork aren't ready"
      : "Agent Profile request couldn't be updated",
  });
}

export function emitLocalError(input: {
  code: string;
  details?: Array<{ label: string; value: string }>;
  message: string;
  nextStep: string;
  presenter: Presenter;
  title: string;
}): void {
  process.exitCode = 1;
  if (input.presenter.view === "agent") {
    input.presenter.data({
      code: input.code,
      payload: {
        status: "error",
        error: {
          code: input.code,
          details: input.details,
          message: input.message,
          nextStep: input.nextStep,
        },
      },
    });
    return;
  }
  renderHumanErrorCard({
    codePrefix: "profile.creation-request.error.card",
    message: input.message,
    nextStep: input.nextStep,
    presenter: input.presenter,
    title: input.title,
  });
}

function buildRequestRows(
  request: AgentProfileCreationRequest
): Array<{ label: string; value: string }> {
  const creatingStatus = request.createdAgentProfileId
    ? "Finishing setup"
    : "Creating Agent";
  return [
    {
      label: "Status",
      value: request.status === "approved" ? creatingStatus : request.status,
    },
    { label: "Request ID", value: request.id },
    { label: "Target Owner", value: request.targetOwnerUserId },
    { label: "Session", value: request.sessionStrategy },
    ...(request.nativeSessionId
      ? [{ label: "Native Session ID", value: request.nativeSessionId }]
      : []),
    { label: "Requested By", value: request.requesterUserId },
    { label: "Source", value: request.source },
    ...(request.status === "approved"
      ? [
          {
            label: "Next",
            value:
              "Creation continues on the server. Run openmeld profile requests list to check progress.",
          },
        ]
      : []),
    ...(request.createdAgentProfileId
      ? [
          {
            label: "Created Agent Profile",
            value: request.createdAgentProfileId,
          },
        ]
      : []),
  ];
}

function hasFailureCode(
  failure: ReturnType<typeof toStructuredApiClientFailure>,
  code: string
): boolean {
  return failure.code === code || failure.upstreamCode === code;
}
