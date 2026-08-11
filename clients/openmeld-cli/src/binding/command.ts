import {
  createAgentProfileBindingApi,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
  AuthorizeAgentProfileBindingForOrganizationResponse,
  ListOrganizationBindingAuthorizationsResponse,
  OrganizationBindingAuthorization,
  RevokeAgentProfileBindingForOrganizationResponse,
} from "@openmeld/schemas/types";
import {
  getAuthSessionState,
  type StoredActiveOrganization,
} from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import type { Presenter } from "../runtime/presenter/types";
import type { RuntimeContext } from "../runtime/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { renderInfoCard } from "../ui/info-card";

type BindingCommandContext = {
  activeOrganization: StoredActiveOrganization;
  presenter: Presenter;
  runtime: RuntimeContext;
};

type BindingCommandOperation = "authorize" | "list" | "revoke";

type BindingCommandErrorInput = {
  activeOrganization?: StoredActiveOrganization | null;
  code: string;
  details?: Array<{ label: string; value: string }>;
  message: string;
  nextStep: string;
  payload?: Record<string, unknown>;
  presenter: Presenter;
  title: string;
};

export async function runBindingAuthorize(input: {
  agentProfileId?: string;
  view?: string;
}): Promise<void> {
  const context = await resolveBindingCommandContext(input);
  if (!context) {
    return;
  }

  const agentProfileId = normalizeAgentProfileId(input.agentProfileId);
  if (!agentProfileId) {
    emitBindingCommandError({
      presenter: context.presenter,
      code: "binding.agent_profile_required",
      title: "Agent Profile Required",
      message: "Choose the Agent Profile whose primary Binding to authorize.",
      nextStep: "Run `openmeld binding authorize <agent-profile-id>`.",
      activeOrganization: context.activeOrganization,
    });
    return;
  }

  try {
    const api = await createBindingApi();
    const response = await api.authorizePrimaryBindingForOrganization({
      agentProfileId,
    });
    emitBindingAuthorizeSuccess({
      activeOrganization: context.activeOrganization,
      presenter: context.presenter,
      response,
      runtime: context.runtime,
    });
  } catch (error) {
    emitBindingApiError({
      activeOrganization: context.activeOrganization,
      agentProfileId,
      error,
      operation: "authorize",
      presenter: context.presenter,
    });
  }
}

export async function runBindingList(input?: { view?: string }): Promise<void> {
  const context = await resolveBindingCommandContext(input);
  if (!context) {
    return;
  }

  try {
    const api = await createBindingApi();
    const response = await api.listOrganizationAuthorizations();
    emitBindingListSuccess({
      activeOrganization: context.activeOrganization,
      presenter: context.presenter,
      response,
      runtime: context.runtime,
    });
  } catch (error) {
    emitBindingApiError({
      activeOrganization: context.activeOrganization,
      error,
      operation: "list",
      presenter: context.presenter,
    });
  }
}

export async function runBindingRevoke(input: {
  agentProfileId?: string;
  view?: string;
}): Promise<void> {
  const context = await resolveBindingCommandContext(input);
  if (!context) {
    return;
  }

  const agentProfileId = normalizeAgentProfileId(input.agentProfileId);
  if (!agentProfileId) {
    emitBindingCommandError({
      presenter: context.presenter,
      code: "binding.agent_profile_required",
      title: "Agent Profile Required",
      message:
        "Choose the Agent Profile whose organization authorization to revoke.",
      nextStep: "Run `openmeld binding revoke <agent-profile-id>`.",
      activeOrganization: context.activeOrganization,
    });
    return;
  }

  try {
    const api = await createBindingApi();
    const response = await api.revokePrimaryBindingForOrganization({
      agentProfileId,
    });
    emitBindingRevokeSuccess({
      activeOrganization: context.activeOrganization,
      presenter: context.presenter,
      response,
      runtime: context.runtime,
    });
  } catch (error) {
    emitBindingApiError({
      activeOrganization: context.activeOrganization,
      agentProfileId,
      error,
      operation: "revoke",
      presenter: context.presenter,
    });
  }
}

async function resolveBindingCommandContext(input?: {
  view?: string;
}): Promise<BindingCommandContext | null> {
  const runtime = await resolveRuntimeContext({ view: input?.view });
  const presenter = createPresenter(runtime);
  const authState = await getAuthSessionState({
    validateRemote: true,
  });
  if (authState.state !== "valid" || !authState.session) {
    emitBindingCommandError({
      presenter,
      code: "binding.auth_required",
      title: "Sign In Needed",
      message: "Sign in to OpenMeld before managing Binding authorizations.",
      nextStep: "Run `openmeld login`, then retry this command.",
      activeOrganization: null,
      payload: {
        authState: authState.state,
        reasonCode: authState.reasonCode ?? null,
      },
    });
    return null;
  }

  const activeOrganization = authState.session.activeOrganization ?? null;
  if (!activeOrganization) {
    emitBindingCommandError({
      presenter,
      code: "binding.organization_required",
      title: "No Active Organization",
      message:
        "Choose an active OpenMeld organization before managing Binding authorizations.",
      nextStep: "Run `openmeld org list`, then `openmeld org switch <slug>`.",
      activeOrganization: null,
    });
    return null;
  }

  return {
    activeOrganization,
    presenter,
    runtime,
  };
}

async function createBindingApi() {
  return createAgentProfileBindingApi(
    createCliApiClientFoundation(await resolveBaseUrl())
  );
}

function emitBindingAuthorizeSuccess(input: {
  activeOrganization: StoredActiveOrganization;
  presenter: Presenter;
  response: AuthorizeAgentProfileBindingForOrganizationResponse;
  runtime: RuntimeContext;
}): void {
  const payload = buildBindingAuthorizationPayload({
    activeOrganization: input.activeOrganization,
    authorization: input.response,
  });
  if (input.runtime.resolvedView === "human") {
    renderBindingAuthorizationCard({
      activeOrganization: input.activeOrganization,
      presenter: input.presenter,
      response: input.response,
      title:
        input.response.status === "already_authorized"
          ? "Binding Already Authorized"
          : "Binding Authorized",
    });
    return;
  }

  input.presenter.data({
    code: "binding.authorize",
    payload,
  });
}

function emitBindingListSuccess(input: {
  activeOrganization: StoredActiveOrganization;
  presenter: Presenter;
  response: ListOrganizationBindingAuthorizationsResponse;
  runtime: RuntimeContext;
}): void {
  const payload = {
    status: "ok",
    organization: {
      active: input.activeOrganization,
    },
    organizationId: input.response.organizationId,
    authorizations: input.response.authorizations,
  };
  if (input.runtime.resolvedView === "human") {
    renderBindingAuthorizationListCard({
      activeOrganization: input.activeOrganization,
      authorizations: input.response.authorizations,
      organizationId: input.response.organizationId,
      presenter: input.presenter,
    });
    return;
  }

  input.presenter.data({
    code: "binding.list",
    payload,
  });
}

function emitBindingRevokeSuccess(input: {
  activeOrganization: StoredActiveOrganization;
  presenter: Presenter;
  response: RevokeAgentProfileBindingForOrganizationResponse;
  runtime: RuntimeContext;
}): void {
  const payload = {
    status: "ok",
    organization: {
      active: input.activeOrganization,
    },
    revocation: input.response,
  };
  if (input.runtime.resolvedView === "human") {
    renderBindingRevocationCard({
      activeOrganization: input.activeOrganization,
      presenter: input.presenter,
      response: input.response,
    });
    return;
  }

  input.presenter.data({
    code: "binding.revoke",
    payload,
  });
}

function emitBindingApiError(input: {
  activeOrganization: StoredActiveOrganization;
  agentProfileId?: string;
  error: unknown;
  operation: BindingCommandOperation;
  presenter: Presenter;
}): void {
  const failure = toStructuredApiClientFailure(input.error);
  const classified = classifyBindingApiFailure({
    agentProfileId: input.agentProfileId,
    failure,
    operation: input.operation,
  });
  emitBindingCommandError({
    presenter: input.presenter,
    code: classified.code,
    title: classified.title,
    message: classified.message,
    nextStep: classified.nextStep,
    activeOrganization: input.activeOrganization,
    details: [
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
    ],
    payload: {
      ...(input.agentProfileId ? { agentProfileId: input.agentProfileId } : {}),
      failure: {
        code: failure.code,
        requestId: failure.requestId,
        status: failure.status,
        upstreamCode: failure.upstreamCode,
      },
    },
  });
}

function classifyBindingApiFailure(input: {
  agentProfileId?: string;
  failure: ReturnType<typeof toStructuredApiClientFailure>;
  operation: BindingCommandOperation;
}): {
  code: string;
  message: string;
  nextStep: string;
  title: string;
} {
  if (input.failure.status === 401) {
    return {
      code: "binding.auth_required",
      title: "Sign In Needed",
      message:
        "OpenMeld could not verify your sign-in for this Binding command.",
      nextStep: "Run `openmeld login`, then retry this command.",
    };
  }

  if (input.failure.status === 403) {
    return {
      code: "binding.organization_access_denied",
      title: "Organization Access Needed",
      message:
        "The active organization does not allow this Binding authorization command.",
      nextStep:
        "Run `openmeld org current` to confirm the active organization, then ask an organization admin for access.",
    };
  }

  if (input.failure.status === 404 && input.operation !== "list") {
    return {
      code: "binding.agent_profile_not_found",
      title: "Agent Profile Not Found",
      message:
        `OpenMeld could not find Agent Profile ${input.agentProfileId ?? ""}.`.trim(),
      nextStep: "Check the Agent Profile ID, then retry this command.",
    };
  }

  if (input.failure.code === "gateway.invalid_response") {
    return {
      code: "binding.response_invalid",
      title: "Binding Response Invalid",
      message: "OpenMeld returned an invalid Binding authorization response.",
      nextStep: "Retry after OpenMeld Gateway is updated and healthy.",
    };
  }

  const operationLabel = formatBindingOperationLabel(input.operation);
  return {
    code: `binding.${input.operation}_failed`,
    title: "Binding Authorization Failed",
    message: `OpenMeld could not ${operationLabel}.`,
    nextStep: "Retry after OpenMeld Gateway is reachable.",
  };
}

function formatBindingOperationLabel(
  operation: BindingCommandOperation
): string {
  if (operation === "authorize") {
    return "authorize this Binding";
  }
  if (operation === "revoke") {
    return "revoke this Binding authorization";
  }
  return "list Binding authorizations";
}

function emitBindingCommandError(input: BindingCommandErrorInput): void {
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
    ...(input.payload ?? {}),
  };

  if (input.presenter.view === "human") {
    renderInfoCard({
      presenter: input.presenter,
      title: input.title,
      codePrefix: "binding.error.card",
      rows: [
        { label: "Reason", value: input.message },
        { label: "Next Step", value: input.nextStep },
        ...(input.details ?? []),
      ],
      sanitize: true,
      minContentWidth: 72,
    });
    return;
  }

  input.presenter.data({
    code: input.code,
    payload,
  });
}

function renderBindingAuthorizationCard(input: {
  activeOrganization: StoredActiveOrganization;
  presenter: Presenter;
  response: AuthorizeAgentProfileBindingForOrganizationResponse;
  title: string;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: input.title,
    codePrefix: "binding.authorize.card",
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.activeOrganization),
      },
      { label: "Agent Profile ID", value: input.response.agentProfileId },
      { label: "Binding ID", value: input.response.bindingId },
      { label: "Status", value: input.response.status },
      { label: "Authorized By", value: input.response.authorizedBy },
      { label: "Created At", value: input.response.createdAt },
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function renderBindingAuthorizationListCard(input: {
  activeOrganization: StoredActiveOrganization;
  authorizations: OrganizationBindingAuthorization[];
  organizationId: string;
  presenter: Presenter;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: "Binding Authorizations",
    codePrefix: "binding.list.card",
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.activeOrganization),
      },
      { label: "Organization ID", value: input.organizationId },
      {
        label: "Authorization Count",
        value: String(input.authorizations.length),
      },
      ...input.authorizations.map((authorization) => ({
        label: "Agent Profile",
        value: `${authorization.agentProfileId} -> ${authorization.bindingId}`,
      })),
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function renderBindingRevocationCard(input: {
  activeOrganization: StoredActiveOrganization;
  presenter: Presenter;
  response: RevokeAgentProfileBindingForOrganizationResponse;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title:
      input.response.status === "missing"
        ? "Binding Authorization Missing"
        : "Binding Authorization Revoked",
    codePrefix: "binding.revoke.card",
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.activeOrganization),
      },
      { label: "Agent Profile ID", value: input.response.agentProfileId },
      { label: "Status", value: input.response.status },
      { label: "Revoked", value: input.response.revoked ? "yes" : "no" },
      ...(input.response.bindingId
        ? [{ label: "Binding ID", value: input.response.bindingId }]
        : []),
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function buildBindingAuthorizationPayload(input: {
  activeOrganization: StoredActiveOrganization;
  authorization: AuthorizeAgentProfileBindingForOrganizationResponse;
}) {
  return {
    status: "ok",
    organization: {
      active: input.activeOrganization,
    },
    authorization: input.authorization,
  };
}

function formatOrganizationLabel(
  organization: StoredActiveOrganization
): string {
  const role = organization.role ? `, ${organization.role}` : "";
  return `${organization.name} (${organization.slug})${role}`;
}

function normalizeAgentProfileId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
