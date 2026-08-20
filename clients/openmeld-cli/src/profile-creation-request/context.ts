import {
  createOrganizationApi,
  type OrganizationApi,
} from "@openmeld/api-client";
import {
  getAuthSessionState,
  type StoredActiveOrganization,
} from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import {
  getAuthOrganizationSelection,
  listAuthOrganizations,
} from "../org/auth-organization-api";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import type { Presenter } from "../runtime/presenter/types";
import type { RuntimeContext } from "../runtime/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { normalizeOptionalText } from "./input";
import { emitCommandError, emitLocalError } from "./presentation";

export type ProfileCreationRequestCommandContext = {
  api: OrganizationApi;
  callerUserId: string | null;
  organization: StoredActiveOrganization;
  presenter: Presenter;
  runtime: RuntimeContext;
};

export type ProfileCreationRequestCommonCommandInput = {
  organization?: string;
  view?: string;
};

export async function resolveProfileCreationRequestCommandContext(
  input: ProfileCreationRequestCommonCommandInput
): Promise<ProfileCreationRequestCommandContext | null> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const authState = await getAuthSessionState({ validateRemote: true });
  if (authState.state !== "valid" || !authState.session) {
    emitLocalError({
      code: "profile.creation_request.auth_required",
      message: "Sign in to OpenMeld before managing Agent Profile requests.",
      nextStep: "Run `openmeld login`, then retry this command.",
      presenter,
      title: "Sign In Needed",
    });
    return null;
  }

  try {
    const [organizations, selection] = await Promise.all([
      listAuthOrganizations(authState.session),
      getAuthOrganizationSelection(authState.session),
    ]);
    const organization = resolveOrganization({
      organizations,
      selectedOrganizationId:
        selection.lastSelectedOrganizationId ?? selection.activeOrganizationId,
      selector: input.organization,
    });
    if (!organization) {
      emitLocalError({
        code: "profile.creation_request.organization_required",
        message: input.organization
          ? `No Organization with the slug or ID "${input.organization}" is available to this account.`
          : "OpenMeld could not resolve the current Organization for this request.",
        nextStep:
          "Run `openmeld org list`, then retry with `--organization <slug-or-id>`.",
        presenter,
        title: "Organization Needed",
      });
      return null;
    }

    return {
      api: createOrganizationApi(
        createCliApiClientFoundation(await resolveBaseUrl(), {
          organizationId: organization.id,
        })
      ),
      callerUserId: normalizeOptionalText(authState.session.user?.id) ?? null,
      organization,
      presenter,
      runtime,
    };
  } catch (error) {
    emitCommandError({
      context: {
        api: null as never,
        callerUserId: normalizeOptionalText(authState.session.user?.id) ?? null,
        organization:
          authState.session.activeOrganization ?? fallbackOrganization(),
        presenter,
        runtime,
      },
      error,
      operation: "resolve Organization",
    });
    return null;
  }
}

function resolveOrganization(input: {
  organizations: StoredActiveOrganization[];
  selectedOrganizationId: string | null;
  selector?: string;
}): StoredActiveOrganization | null {
  const selector = normalizeOptionalText(input.selector);
  if (selector) {
    const normalizedSlug = selector.toLowerCase();
    return (
      input.organizations.find(
        (organization) =>
          organization.id === selector ||
          organization.slug.toLowerCase() === normalizedSlug
      ) ?? null
    );
  }
  return (
    input.organizations.find(
      (organization) => organization.id === input.selectedOrganizationId
    ) ?? null
  );
}

function fallbackOrganization(): StoredActiveOrganization {
  return {
    id: "unresolved",
    name: "Unresolved Organization",
    slug: "unresolved",
  };
}
