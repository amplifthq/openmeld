import {
  createOrganizationApi,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
  GetOrganizationJoinLinkResponse,
  OrganizationDirectoryResponse,
  RevokeOrganizationJoinLinkResponse,
} from "@openmeld/schemas/types";
import {
  getAuthSessionState,
  type StoredActiveOrganization,
  type StoredAuthSession,
  updateAuthSessionActiveOrganization,
} from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { emitCliErrorJson } from "../runtime/cli-error-json";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import type { Presenter } from "../runtime/presenter/types";
import type { RuntimeContext } from "../runtime/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { renderInfoCard } from "../ui/info-card";
import {
  AuthOrganizationApiError,
  createAuthOrganizationJoinLink,
  getAuthOrganizationJoinLink,
  listAuthOrganizations,
  revokeAuthOrganizationJoinLink,
  setActiveAuthOrganization,
} from "./auth-organization-api";

type OrganizationCommandContext = {
  cliJsonOutput: boolean;
  runtime: RuntimeContext;
  presenter: Presenter;
  session: StoredAuthSession;
};

type OrganizationCommandErrorInput = {
  presenter: Presenter;
  code: string;
  title: string;
  message: string;
  nextStep: string;
  activeOrganization?: StoredActiveOrganization | null;
  details?: Array<{ label: string; value: string }>;
  payload?: Record<string, unknown>;
  cliJsonOutput?: boolean;
};

export type OrganizationInviteLinkAction = "get" | "create" | "revoke";

export async function runOrgList(input?: { view?: string }): Promise<void> {
  const context = await resolveOrganizationCommandContext(input);
  if (!context) {
    return;
  }

  const organizations = await loadOrganizationsOrEmitError(context);
  if (!organizations) {
    return;
  }

  const activeOrganization = resolveActiveOrganization({
    activeOrganization: context.session.activeOrganization ?? null,
    organizations,
  });
  if (
    context.session.activeOrganization &&
    organizations.length > 0 &&
    !activeOrganization
  ) {
    emitOrganizationCommandError({
      presenter: context.presenter,
      code: "organization.active_not_member",
      title: "Organization Mismatch",
      message:
        "The cached active organization is not in your OpenMeld organization list.",
      nextStep:
        "Run `openmeld org switch <slug>` to choose a valid organization.",
      activeOrganization: context.session.activeOrganization,
      payload: {
        organizations: buildOrganizationListPayload({
          organizations,
          activeOrganization: null,
        }).organizations,
      },
    });
    return;
  }

  const payload = buildOrganizationListPayload({
    organizations,
    activeOrganization,
  });
  if (context.runtime.resolvedView === "human") {
    renderOrganizationListCard({
      presenter: context.presenter,
      organizations,
      activeOrganization,
    });
    return;
  }

  context.presenter.data({
    code: "organization.list",
    payload,
  });
}

export async function runOrgCurrent(input?: { view?: string }): Promise<void> {
  const context = await resolveOrganizationCommandContext(input);
  if (!context) {
    return;
  }

  const activeOrganization = context.session.activeOrganization ?? null;
  if (!activeOrganization) {
    emitOrganizationCommandError({
      presenter: context.presenter,
      code: "organization.active_missing",
      title: "No Active Organization",
      message: "No active OpenMeld organization is selected.",
      nextStep: "Run `openmeld org list`, then `openmeld org switch <slug>`.",
      activeOrganization: null,
    });
    return;
  }

  const payload = buildCurrentOrganizationPayload(activeOrganization);
  if (context.runtime.resolvedView === "human") {
    renderCurrentOrganizationCard({
      presenter: context.presenter,
      title: "Current Organization",
      organization: activeOrganization,
    });
    return;
  }

  context.presenter.data({
    code: "organization.current",
    payload,
  });
}

export async function runOrgSwitch(input: {
  slug?: string;
  view?: string;
}): Promise<void> {
  const targetSlug = normalizeOrganizationSlug(input.slug);
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  if (!targetSlug) {
    emitOrganizationCommandError({
      presenter,
      code: "organization.slug_required",
      title: "Organization Slug Required",
      message: "Choose the organization slug to make active.",
      nextStep: "Run `openmeld org switch <slug>`.",
      activeOrganization: null,
    });
    return;
  }

  const context = await resolveOrganizationCommandContext(input, {
    runtime,
    presenter,
  });
  if (!context) {
    return;
  }

  const organizations = await loadOrganizationsOrEmitError(context);
  if (!organizations) {
    return;
  }

  const target = organizations.find(
    (organization) => organization.slug === targetSlug
  );
  if (!target) {
    emitOrganizationCommandError({
      presenter: context.presenter,
      code: "organization.not_found",
      title: "Organization Not Found",
      message: `You are not a member of an OpenMeld organization with slug "${targetSlug}".`,
      nextStep:
        "Run `openmeld org list` to see organizations available to this account.",
      activeOrganization: context.session.activeOrganization ?? null,
      payload: {
        requestedSlug: targetSlug,
        organizations: buildOrganizationListPayload({
          organizations,
          activeOrganization: context.session.activeOrganization ?? null,
        }).organizations,
      },
    });
    return;
  }

  try {
    await setActiveAuthOrganization({
      session: context.session,
      organizationSlug: target.slug,
    });
    await updateAuthSessionActiveOrganization(target);
  } catch (error) {
    emitOrganizationApiError({
      presenter: context.presenter,
      error,
      activeOrganization: context.session.activeOrganization ?? null,
    });
    return;
  }

  const payload = {
    status: "ok",
    organization: {
      active: target,
    },
  };
  if (context.runtime.resolvedView === "human") {
    renderCurrentOrganizationCard({
      presenter: context.presenter,
      title: "Active Organization Updated",
      organization: target,
    });
    return;
  }

  context.presenter.data({
    code: "organization.switch",
    payload,
  });
}

export async function runOrgDirectory(input: {
  json: boolean;
  view?: string;
}): Promise<void> {
  const context = await resolveOrganizationCommandContext(input);
  if (!context) {
    return;
  }
  if (!context.session.activeOrganization) {
    emitOrganizationCommandError({
      presenter: context.presenter,
      cliJsonOutput: context.cliJsonOutput,
      code: "organization.active_missing",
      title: "No Active Organization",
      message: "No active OpenMeld organization is selected.",
      nextStep: "Run `openmeld org list`, then `openmeld org switch <slug>`.",
      activeOrganization: null,
    });
    return;
  }

  let directory: OrganizationDirectoryResponse;
  try {
    directory = await createOrganizationApi(
      createCliApiClientFoundation(await resolveBaseUrl())
    ).getCurrentDirectory({ includeMemberLastActiveAt: true });
  } catch (error) {
    emitOrganizationApiError({
      presenter: context.presenter,
      error,
      activeOrganization: context.session.activeOrganization,
      cliJsonOutput: context.cliJsonOutput,
    });
    return;
  }

  if (context.cliJsonOutput) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "organization.directory",
      ...directory,
    });
    return;
  }
  if (context.runtime.resolvedView === "agent") {
    context.presenter.data({
      code: "organization.directory",
      payload: directory,
    });
    return;
  }
  renderOrganizationDirectoryCard({
    presenter: context.presenter,
    directory,
  });
}

export async function runOrgInviteLink(input: {
  action: OrganizationInviteLinkAction;
  json: boolean;
  view?: string;
}): Promise<void> {
  const context = await resolveOrganizationCommandContext(input);
  if (!context) {
    return;
  }
  const activeOrganization = context.session.activeOrganization ?? null;
  if (!activeOrganization) {
    emitOrganizationCommandError({
      presenter: context.presenter,
      cliJsonOutput: context.cliJsonOutput,
      code: "organization.active_missing",
      title: "No Active Organization",
      message: "No active OpenMeld organization is selected.",
      nextStep: "Run `openmeld org list`, then `openmeld org switch <slug>`.",
      activeOrganization: null,
    });
    return;
  }

  try {
    const response = await executeOrganizationInviteLinkAction({
      action: input.action,
      organizationId: activeOrganization.id,
      session: context.session,
    });
    emitOrganizationInviteLinkSuccess({
      action: input.action,
      context,
      response,
    });
  } catch (error) {
    emitOrganizationApiError({
      presenter: context.presenter,
      error,
      activeOrganization,
      cliJsonOutput: context.cliJsonOutput,
    });
  }
}

async function resolveOrganizationCommandContext(
  input?: { json?: boolean; view?: string },
  resolved?: {
    runtime: RuntimeContext;
    presenter: Presenter;
  }
): Promise<OrganizationCommandContext | null> {
  const runtime =
    resolved?.runtime ?? (await resolveRuntimeContext({ view: input?.view }));
  const presenter = resolved?.presenter ?? createPresenter(runtime);
  const authState = await getAuthSessionState({
    validateRemote: true,
  });
  if (authState.state !== "valid" || !authState.session) {
    emitOrganizationCommandError({
      presenter,
      cliJsonOutput: input?.json === true,
      code: "organization.auth_required",
      title: "Sign In Needed",
      message: "Sign in to OpenMeld before managing organizations.",
      nextStep: "Run `openmeld login`, then retry this command.",
      activeOrganization: null,
      payload: {
        authState: authState.state,
        reasonCode: authState.reasonCode ?? null,
      },
    });
    return null;
  }

  return {
    cliJsonOutput: input?.json === true,
    runtime,
    presenter,
    session: authState.session,
  };
}

async function loadOrganizationsOrEmitError(
  context: OrganizationCommandContext
): Promise<StoredActiveOrganization[] | null> {
  try {
    return await listAuthOrganizations(context.session);
  } catch (error) {
    emitOrganizationApiError({
      presenter: context.presenter,
      error,
      activeOrganization: context.session.activeOrganization ?? null,
    });
    return null;
  }
}

function emitOrganizationApiError(input: {
  presenter: Presenter;
  error: unknown;
  activeOrganization: StoredActiveOrganization | null;
  cliJsonOutput?: boolean;
}): void {
  if (input.error instanceof AuthOrganizationApiError) {
    const presentation = resolveOrganizationApiErrorPresentation(
      input.error.code
    );
    emitOrganizationCommandError({
      presenter: input.presenter,
      cliJsonOutput: input.cliJsonOutput,
      code: input.error.code,
      title: presentation.title,
      message: input.error.message,
      nextStep: presentation.nextStep,
      activeOrganization: input.activeOrganization,
      details: [
        ...(input.error.status === null
          ? []
          : [{ label: "HTTP Status", value: String(input.error.status) }]),
        ...(input.error.requestId
          ? [{ label: "Request ID", value: input.error.requestId }]
          : []),
        ...(input.error.detailMessage
          ? [{ label: "Details", value: input.error.detailMessage }]
          : []),
      ],
    });
    return;
  }

  const failure = toStructuredApiClientFailure(input.error);
  emitOrganizationCommandError({
    presenter: input.presenter,
    cliJsonOutput: input.cliJsonOutput,
    code: failure.code ?? "organization.unexpected_error",
    title: "Organization Error",
    message: failure.message,
    nextStep:
      "Confirm the active Organization and retry after OpenMeld Gateway is reachable.",
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
        ? [
            {
              label: "Schema Issue",
              value: failure.schemaIssuePath
                ? `${failure.schemaIssuePath}: ${failure.schemaIssueMessage}`
                : failure.schemaIssueMessage,
            },
          ]
        : []),
    ],
    payload: {
      failure: {
        code: failure.code,
        message: failure.message,
        requestId: failure.requestId,
        status: failure.status,
        upstreamCode: failure.upstreamCode,
        ...(failure.schemaIssueMessage
          ? { schemaIssueMessage: failure.schemaIssueMessage }
          : {}),
        ...(failure.schemaIssuePath
          ? { schemaIssuePath: failure.schemaIssuePath }
          : {}),
      },
    },
  });
}

function resolveOrganizationApiErrorPresentation(code: string): {
  title: string;
  nextStep: string;
} {
  if (code === "organization.auth_revoked") {
    return {
      title: "Sign In Needed",
      nextStep: "Run `openmeld login`, then retry this command.",
    };
  }
  if (code === "organization.join_link.forbidden") {
    return {
      title: "Permission Required",
      nextStep: "Ask an Organization owner or admin to manage the invite link.",
    };
  }
  return {
    title: "Organization Error",
    nextStep: "Retry the command after OpenMeld auth is reachable.",
  };
}

function emitOrganizationCommandError(
  input: OrganizationCommandErrorInput
): void {
  process.exitCode = 1;
  if (input.cliJsonOutput === true) {
    emitCliErrorJson({
      code: input.code,
      message: input.message,
      requestId:
        input.details?.find((detail) => detail.label === "Request ID")?.value ??
        null,
    });
    return;
  }
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
      codePrefix: "organization.error.card",
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

async function executeOrganizationInviteLinkAction(input: {
  action: OrganizationInviteLinkAction;
  organizationId: string;
  session: StoredAuthSession;
}): Promise<
  GetOrganizationJoinLinkResponse | RevokeOrganizationJoinLinkResponse
> {
  switch (input.action) {
    case "get":
      return await getAuthOrganizationJoinLink(input);
    case "create":
      return await createAuthOrganizationJoinLink(input);
    case "revoke":
      return await revokeAuthOrganizationJoinLink(input);
    default:
      return assertNeverOrganizationInviteLinkAction(input.action);
  }
}

function emitOrganizationInviteLinkSuccess(input: {
  action: OrganizationInviteLinkAction;
  context: OrganizationCommandContext;
  response:
    | GetOrganizationJoinLinkResponse
    | RevokeOrganizationJoinLinkResponse;
}): void {
  const type = `organization.invite_link.${input.action}` as const;
  if (input.context.cliJsonOutput) {
    if (input.action === "revoke" && "revoked" in input.response) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type: "organization.invite_link.revoke",
        ...input.response,
      });
      return;
    }
    if ("joinLink" in input.response) {
      emitCliJsonEnvelope({
        schemaVersion: 1,
        type:
          input.action === "create"
            ? "organization.invite_link.create"
            : "organization.invite_link.get",
        ...input.response,
      });
      return;
    }
  }
  if (input.context.runtime.resolvedView === "agent") {
    input.context.presenter.data({
      code: type,
      payload: input.response,
    });
    return;
  }
  renderOrganizationInviteLinkCard({
    action: input.action,
    presenter: input.context.presenter,
    response: input.response,
  });
}

function renderOrganizationDirectoryCard(input: {
  presenter: Presenter;
  directory: OrganizationDirectoryResponse;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: "Organization Directory",
    codePrefix: "organization.directory.card",
    rows: [
      ...input.directory.members.map((member) => ({
        label: "Member",
        value: `${member.user.name} (${member.user.email}) · ${member.role}`,
      })),
      ...input.directory.agentProfiles.map((profile) => ({
        label: profile.isCenterAgent ? "Center Agent" : "Agent Profile",
        value: `${profile.profileName} (${profile.profileId}) · ${profile.status}`,
      })),
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function renderOrganizationInviteLinkCard(input: {
  action: OrganizationInviteLinkAction;
  presenter: Presenter;
  response:
    | GetOrganizationJoinLinkResponse
    | RevokeOrganizationJoinLinkResponse;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: resolveOrganizationInviteLinkCardTitle(input.action),
    codePrefix: `organization.invite_link.${input.action}.card`,
    rows: buildOrganizationInviteLinkCardRows(input.response),
    sanitize: true,
    minContentWidth: 72,
  });
}

function buildOrganizationInviteLinkCardRows(
  response: GetOrganizationJoinLinkResponse | RevokeOrganizationJoinLinkResponse
): Array<{ label: string; value: string }> {
  if (!("joinLink" in response)) {
    return [
      {
        label: "Status",
        value: response.revoked
          ? "Invite link revoked"
          : "No active invite link to revoke",
      },
    ];
  }
  if (!response.joinLink) {
    return [{ label: "Status", value: "No active invite link" }];
  }
  return [
    { label: "URL", value: response.joinLink.url },
    { label: "Role", value: response.joinLink.role },
    { label: "Created At", value: response.joinLink.createdAt },
  ];
}

function resolveOrganizationInviteLinkCardTitle(
  action: OrganizationInviteLinkAction
): string {
  if (action === "create") {
    return "Organization Invite Link Created";
  }
  if (action === "revoke") {
    return "Organization Invite Link Revoked";
  }
  return "Organization Invite Link";
}

function assertNeverOrganizationInviteLinkAction(value: never): never {
  throw new Error(
    `unexpected Organization invite-link action: ${String(value)}`
  );
}

function renderOrganizationListCard(input: {
  presenter: Presenter;
  organizations: StoredActiveOrganization[];
  activeOrganization: StoredActiveOrganization | null;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: "Organizations",
    codePrefix: "organization.list.card",
    rows: [
      {
        label: "Active Organization",
        value: input.activeOrganization
          ? formatOrganizationLabel(input.activeOrganization)
          : "not selected",
      },
      ...input.organizations.map((organization) => ({
        label: "Organization",
        value: `${formatOrganizationLabel(organization)}${
          isSameOrganization(organization, input.activeOrganization)
            ? " [active]"
            : ""
        }`,
      })),
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function renderCurrentOrganizationCard(input: {
  presenter: Presenter;
  title: string;
  organization: StoredActiveOrganization;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: input.title,
    codePrefix: "organization.current.card",
    rows: [
      { label: "Name", value: input.organization.name },
      { label: "Slug", value: input.organization.slug },
      { label: "Organization ID", value: input.organization.id },
      ...(input.organization.role
        ? [{ label: "Role", value: input.organization.role }]
        : []),
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function buildOrganizationListPayload(input: {
  organizations: StoredActiveOrganization[];
  activeOrganization: StoredActiveOrganization | null;
}) {
  return {
    status: "ok",
    organization: {
      active: input.activeOrganization,
    },
    organizations: input.organizations.map((organization) => ({
      ...organization,
      active: isSameOrganization(organization, input.activeOrganization),
    })),
  };
}

function buildCurrentOrganizationPayload(
  activeOrganization: StoredActiveOrganization
) {
  return {
    status: "ok",
    organization: {
      active: activeOrganization,
    },
  };
}

function resolveActiveOrganization(input: {
  activeOrganization: StoredActiveOrganization | null;
  organizations: StoredActiveOrganization[];
}): StoredActiveOrganization | null {
  if (!input.activeOrganization) {
    return null;
  }
  return (
    input.organizations.find((organization) =>
      isSameOrganization(organization, input.activeOrganization)
    ) ?? null
  );
}

function isSameOrganization(
  left: StoredActiveOrganization | null | undefined,
  right: StoredActiveOrganization | null | undefined
): boolean {
  if (!(left && right)) {
    return false;
  }
  return left.id === right.id || left.slug === right.slug;
}

function formatOrganizationLabel(
  organization: StoredActiveOrganization
): string {
  const role = organization.role ? `, ${organization.role}` : "";
  return `${organization.name} (${organization.slug})${role}`;
}

function normalizeOrganizationSlug(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
