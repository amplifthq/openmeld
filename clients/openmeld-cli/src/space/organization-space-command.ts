import {
  createOrganizationApi,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { OrganizationSpaceDirectoryWithMemberCountsResponse } from "@openmeld/schemas/types";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { emitCliErrorJson } from "../runtime/cli-error-json";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { renderHumanErrorCard } from "../ui/human-error-card";
import { renderInfoCard } from "../ui/info-card";
import { createCliApiClientFoundation } from "./api-client-foundation";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";

export async function runSpaceOrganizationList(input: {
  profile?: string;
  baseUrl?: string;
  limit: number;
  json?: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "listing Organization Spaces"
    ),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }

  const { runtime, presenter, interactive, baseUrl } = context;
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const directory = await createOrganizationApi(
    createCliApiClientFoundation(baseUrl)
  )
    .listCurrentSpacesWithMemberCounts({ requestContext })
    .catch((error: unknown) => {
      emitOrganizationSpaceError({
        error,
        jsonOutput: input.json === true,
        operation: "space.list.organization",
        presenter,
      });
      return null;
    });
  if (!directory) {
    return;
  }
  const payload = buildOrganizationSpaceListPayload({
    directory,
    limit: input.limit,
  });

  if (input.json === true) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "space.list.organization",
      ...payload,
    });
    return;
  }
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "space.list.organization",
      payload,
    });
    return;
  }
  renderOrganizationSpaceListHumanOutput({
    presenter,
    spaces: payload.spaces,
  });
}

export async function runSpaceSelfServeJoin(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "joining a public Organization Space"
    ),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }

  const { runtime, presenter, interactive, baseUrl } = context;
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  if (openMeldProfile.profileKind !== "human") {
    emitOrganizationSpaceError({
      error: Object.assign(
        new Error(
          "Self-service Organization Space membership requires a Human Profile."
        ),
        { code: "space.join.human_profile_required" }
      ),
      operation: "space.join.self_serve",
      presenter,
    });
    return;
  }

  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const response = await createCliSpaceApi(baseUrl)
    .joinSpace({
      requestContext,
      spaceId: input.space,
      ...(input.password === undefined
        ? {}
        : { spacePassword: input.password }),
    })
    .catch((error: unknown) => {
      emitOrganizationSpaceError({
        error,
        operation: "space.join.self_serve",
        presenter,
      });
      return null;
    });
  if (!response) {
    return;
  }

  const payload = {
    mode: "self_serve_membership" as const,
    spaceId: input.space,
    membershipProfileId: openMeldProfile.openMeldProfileId,
    membershipChanged: response.addedMemberIds.includes(
      openMeldProfile.openMeldProfileId
    ),
    alreadyJoined: response.alreadyMemberIds.includes(
      openMeldProfile.openMeldProfileId
    ),
    response,
  };
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "space.join.self_serve",
      payload,
    });
    return;
  }
  renderInfoCard({
    presenter,
    title: "Organization Space Membership",
    codePrefix: "space.join.self_serve.card",
    rows: [
      { label: "Space ID", value: input.space },
      {
        label: "Status",
        value: payload.membershipChanged
          ? "Joined this public Organization Space."
          : "This Human Profile was already a member.",
      },
      {
        label: "Next Step",
        value: `Run \`openmeld space join ${input.space}\` to open the interactive Space session.`,
      },
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function buildOrganizationSpaceListPayload(input: {
  directory: OrganizationSpaceDirectoryWithMemberCountsResponse;
  limit: number;
}) {
  const limit = Number.isFinite(input.limit)
    ? Math.max(1, Math.floor(input.limit))
    : 20;
  return {
    scope: "organization" as const,
    organizationId: input.directory.organizationId,
    generatedAt: input.directory.generatedAt,
    total: input.directory.spaces.length,
    returned: Math.min(input.directory.spaces.length, limit),
    spaces: input.directory.spaces.slice(0, limit),
  };
}

function renderOrganizationSpaceListHumanOutput(input: {
  presenter: Parameters<typeof renderInfoCard>[0]["presenter"];
  spaces: OrganizationSpaceDirectoryWithMemberCountsResponse["spaces"];
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: "Organization Spaces",
    codePrefix: "space.list.organization.card",
    rows:
      input.spaces.length > 0
        ? input.spaces.map((space) => ({
            label: space.name,
            value: `${space.spaceId} · ${space.visibility} · ${
              space.joined ? "joined" : "not joined"
            } · ${formatOrganizationSpaceMemberCount(space.activeMemberCount)}`,
          }))
        : [
            {
              label: "Status",
              value: "No Organization Spaces are available.",
            },
          ],
    sanitize: true,
    minContentWidth: 72,
  });
  input.presenter.line({
    code: "space.list.organization.join_hint",
    text: "Use `openmeld space join --self-serve <space-id>` to join a public Organization Space. This only adds membership; omit `--self-serve` to open the interactive Space session.",
  });
}

function formatOrganizationSpaceMemberCount(count: number | null): string {
  if (count === null) {
    return "member count unavailable";
  }
  return `${count} active ${count === 1 ? "member" : "members"}`;
}

function emitOrganizationSpaceError(input: {
  error: unknown;
  jsonOutput?: boolean;
  operation: "space.join.self_serve" | "space.list.organization";
  presenter: Parameters<typeof renderInfoCard>[0]["presenter"];
}): void {
  const failure = toStructuredApiClientFailure(input.error);
  const code =
    failure.code ??
    readLocalSpaceCommandErrorCode(input.error) ??
    `${input.operation}_failed`;
  process.exitCode = 1;
  if (input.jsonOutput === true) {
    emitCliErrorJson({
      code,
      message: failure.message,
      requestId: failure.requestId,
    });
    return;
  }
  if (input.presenter.view === "agent") {
    input.presenter.data({
      code,
      payload: {
        status: "error",
        operation: input.operation,
        error: {
          code,
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
    return;
  }
  renderHumanErrorCard({
    message: failure.message,
    nextStep: "Try again in a moment.",
    presenter: input.presenter,
    title: "Organization Spaces couldn't be loaded",
    codePrefix: `${input.operation}.error.card`,
  });
}

function readLocalSpaceCommandErrorCode(error: unknown): string | null {
  if (!(error && typeof error === "object" && "code" in error)) {
    return null;
  }
  const code = String((error as { code?: unknown }).code ?? "").trim();
  return code.startsWith("space.") ? code : null;
}
