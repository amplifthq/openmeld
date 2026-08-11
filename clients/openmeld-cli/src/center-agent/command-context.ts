import { createCenterAgentApi } from "@openmeld/api-client";
import { centerAgentOrganizationScopeSchema } from "@openmeld/schemas";
import type { CenterAgentOrganizationScope as CenterAgentOrganizationScopeContract } from "@openmeld/schemas/types";
import {
  getAuthSessionState,
  type StoredActiveOrganization,
  type StoredAuthSession,
} from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import {
  AuthOrganizationApiError,
  getAuthOrganizationSelection,
  listAuthOrganizations,
} from "../org/auth-organization-api";
import { emitCliErrorJson } from "../runtime/cli-error-json";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import { createSilentPresenter } from "../runtime/presenter/silent";
import type { Presenter } from "../runtime/presenter/types";
import type { RuntimeContext } from "../runtime/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import {
  type CenterAgentCommandErrorInput,
  emitCenterAgentCommandError,
} from "./errors";

export type CenterAgentCommandContext = {
  activeOrganization: StoredActiveOrganization;
  cliJsonOutput: boolean;
  presenter: Presenter;
  runtime: RuntimeContext;
};

export type { CenterAgentOrganizationScope } from "@openmeld/schemas/types";

export type TargetedCenterAgentCommandContext = {
  cliJsonOutput: boolean;
  organizationScope: CenterAgentOrganizationScopeContract;
  presenter: Presenter;
  runtime: RuntimeContext;
};

type AuthenticatedCenterAgentCommandContext = {
  activeOrganization: StoredActiveOrganization | null;
  cliJsonOutput: boolean;
  presenter: Presenter;
  runtime: RuntimeContext;
  session: StoredAuthSession;
};

export async function resolveCenterAgentCommandContext(input?: {
  cliJsonOutput?: boolean;
  view?: string;
}): Promise<CenterAgentCommandContext | null> {
  const context = await resolveAuthenticatedCenterAgentCommandContext(input);
  if (!context) {
    return null;
  }
  const activeOrganization = context.activeOrganization;
  if (!activeOrganization) {
    emitOrganizationRequiredError(context);
    return null;
  }

  return {
    activeOrganization,
    cliJsonOutput: context.cliJsonOutput,
    presenter: context.presenter,
    runtime: context.runtime,
  };
}

export async function resolveTargetedCenterAgentCommandContext(input?: {
  cliJsonOutput?: boolean;
  organization?: string;
  view?: string;
}): Promise<TargetedCenterAgentCommandContext | null> {
  const context = await resolveAuthenticatedCenterAgentCommandContext(input);
  if (!context) {
    return null;
  }
  if (input?.organization === undefined) {
    let organizations: StoredActiveOrganization[];
    let selectedOrganizationIds: Awaited<
      ReturnType<typeof getAuthOrganizationSelection>
    >;
    try {
      [organizations, selectedOrganizationIds] = await Promise.all([
        listAuthOrganizations(context.session),
        getAuthOrganizationSelection(context.session),
      ]);
    } catch (error) {
      emitOrganizationLookupError({ context, error });
      return null;
    }
    const currentOrganization =
      findOrganizationById(
        organizations,
        selectedOrganizationIds.lastSelectedOrganizationId
      ) ??
      findOrganizationById(
        organizations,
        selectedOrganizationIds.activeOrganizationId
      );
    if (!currentOrganization) {
      emitOrganizationRequiredError(context);
      return null;
    }
    return {
      cliJsonOutput: context.cliJsonOutput,
      organizationScope: centerAgentOrganizationScopeSchema.parse({
        selection: "current",
        target: currentOrganization,
      }),
      presenter: context.presenter,
      runtime: context.runtime,
    };
  }

  const selector = input.organization.trim();
  if (!selector) {
    emitCenterAgentContextError({
      activeOrganization: null,
      cliJsonOutput: context.cliJsonOutput,
      code: "center_agent.organization_invalid",
      title: "Organization Needed",
      message: "The Organization slug or ID cannot be empty.",
      nextStep:
        "Run `openmeld org list`, then retry with `--organization <slug-or-id>`.",
      presenter: context.presenter,
    });
    return null;
  }

  let organizations: StoredActiveOrganization[];
  try {
    organizations = await listAuthOrganizations(context.session);
  } catch (error) {
    emitOrganizationLookupError({ context, error });
    return null;
  }
  const normalizedSlug = selector.toLowerCase();
  const targetOrganization = organizations.find(
    (organization) =>
      organization.id === selector ||
      organization.slug.toLowerCase() === normalizedSlug
  );
  if (!targetOrganization) {
    emitCenterAgentContextError({
      activeOrganization: null,
      cliJsonOutput: context.cliJsonOutput,
      code: "center_agent.organization_not_found",
      title: "Organization Not Available",
      message: `No Organization with the slug or ID "${selector}" is available to this account.`,
      nextStep:
        "Run `openmeld org list`, then retry with an Organization shown there.",
      presenter: context.presenter,
    });
    return null;
  }

  return {
    cliJsonOutput: context.cliJsonOutput,
    organizationScope: centerAgentOrganizationScopeSchema.parse({
      selection: "explicit",
      target: targetOrganization,
    }),
    presenter: context.presenter,
    runtime: context.runtime,
  };
}

function findOrganizationById(
  organizations: readonly StoredActiveOrganization[],
  organizationId: string | null
): StoredActiveOrganization | null {
  if (!organizationId) {
    return null;
  }
  return (
    organizations.find((organization) => organization.id === organizationId) ??
    null
  );
}

async function resolveAuthenticatedCenterAgentCommandContext(input?: {
  cliJsonOutput?: boolean;
  view?: string;
}): Promise<AuthenticatedCenterAgentCommandContext | null> {
  const runtime = await resolveRuntimeContext({ view: input?.view });
  const cliJsonOutput = input?.cliJsonOutput === true;
  const presenter = cliJsonOutput
    ? createSilentPresenter(runtime.resolvedView)
    : createPresenter(runtime);
  const authState = await getAuthSessionState({
    validateRemote: true,
  });
  if (authState.state !== "valid" || !authState.session) {
    emitCenterAgentContextError({
      activeOrganization: null,
      cliJsonOutput,
      code: "center_agent.auth_required",
      title: "Sign In Needed",
      message: "Sign in to OpenMeld before managing the Center Agent.",
      nextStep: "Run `openmeld login`, then retry this command.",
      payload: {
        authState: authState.state,
        reasonCode: authState.reasonCode ?? null,
      },
      presenter,
    });
    return null;
  }

  return {
    activeOrganization: authState.session.activeOrganization ?? null,
    cliJsonOutput,
    presenter,
    runtime,
    session: authState.session,
  };
}

function emitOrganizationRequiredError(
  context: AuthenticatedCenterAgentCommandContext
): void {
  emitCenterAgentContextError({
    activeOrganization: null,
    cliJsonOutput: context.cliJsonOutput,
    code: "center_agent.organization_required",
    title: "No Active Organization",
    message:
      "Choose an active OpenMeld organization before managing the Center Agent.",
    nextStep: "Run `openmeld org list`, then `openmeld org switch <slug>`.",
    presenter: context.presenter,
  });
}

function emitOrganizationLookupError(input: {
  context: AuthenticatedCenterAgentCommandContext;
  error: unknown;
}): void {
  const failure =
    input.error instanceof AuthOrganizationApiError ? input.error : null;
  emitCenterAgentContextError({
    activeOrganization: null,
    cliJsonOutput: input.context.cliJsonOutput,
    code: "center_agent.organization_lookup_failed",
    title: "Organizations Unavailable",
    message: "OpenMeld could not load the Organizations available to you.",
    nextStep: "Check your connection, run `openmeld org list`, then retry.",
    payload: {
      cause: failure?.code ?? "organization.lookup_failed",
      requestId: failure?.requestId ?? null,
      status: failure?.status ?? null,
    },
    presenter: input.context.presenter,
  });
}

function emitCenterAgentContextError(
  input: CenterAgentCommandErrorInput & { cliJsonOutput: boolean }
): void {
  if (!input.cliJsonOutput) {
    emitCenterAgentCommandError(input);
    return;
  }

  process.exitCode = 1;
  emitCliErrorJson({
    code: input.code,
    message: `${input.message} Next: ${input.nextStep}`,
  });
}

export async function createCenterAgentApiClient(input?: {
  baseUrl?: string;
  organizationId?: string;
}) {
  return createCenterAgentApi(
    createCliApiClientFoundation(
      input?.baseUrl ?? (await resolveBaseUrl()),
      input?.organizationId
        ? { organizationId: input.organizationId }
        : undefined
    )
  );
}
