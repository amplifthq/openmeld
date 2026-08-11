import {
  authRpcResolveOrganizationDirectoryAgentProfilesResultSchema,
  authRpcResolveOrganizationDirectoryMembersResultSchema,
} from "@openmeld/schemas";
import type {
  OrganizationDirectoryAgentProfileIdentity,
  OrganizationDirectoryMember,
} from "@openmeld/schemas/types";

import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";

export async function resolveOrganizationDirectoryMembers(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  organizationId: string;
  requestId?: string | null;
}): Promise<OrganizationDirectoryMember[]> {
  const resolveMembers = input.authWorker?.resolveOrganizationDirectoryMembers;
  if (!resolveMembers) {
    logProjectionFailure("members_unavailable", input);
    throwDirectoryUnavailable();
  }
  let result: unknown;
  try {
    result = await resolveMembers({ organizationId: input.organizationId });
  } catch (error) {
    logProjectionFailure("members_failed", input, error);
    throwDirectoryUnavailable();
  }
  const parsed =
    authRpcResolveOrganizationDirectoryMembersResultSchema.safeParse(result);
  if (
    !(parsed.success && parsed.data.ok) ||
    parsed.data.organizationId !== input.organizationId ||
    hasDuplicateValues(parsed.data.members.map((member) => member.memberId)) ||
    hasDuplicateValues(parsed.data.members.map((member) => member.userId)) ||
    parsed.data.members.some(
      (member) =>
        member.organizationId !== input.organizationId ||
        member.user.id !== member.userId
    )
  ) {
    logProjectionFailure("members_invalid", input);
    throwDirectoryUnavailable();
  }
  return parsed.data.members;
}

export async function resolveOrganizationDirectoryAgentProfiles(input: {
  additionalAgentProfileIds: readonly string[];
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  organizationId: string;
  requestId?: string | null;
}): Promise<{
  additionalAgentProfiles: OrganizationDirectoryAgentProfileIdentity[];
  organizationAgentProfiles: OrganizationDirectoryAgentProfileIdentity[];
}> {
  const resolveAgentProfiles =
    input.authWorker?.resolveOrganizationDirectoryAgentProfiles;
  if (!resolveAgentProfiles) {
    logProjectionFailure("agent_profiles_unavailable", input);
    throwDirectoryUnavailable();
  }
  const additionalAgentProfileIds = [
    ...new Set(input.additionalAgentProfileIds),
  ];
  let result: unknown;
  try {
    result = await resolveAgentProfiles({
      additionalAgentProfileIds,
      organizationId: input.organizationId,
    });
  } catch (error) {
    logProjectionFailure("agent_profiles_failed", input, error);
    throwDirectoryUnavailable();
  }
  const parsed =
    authRpcResolveOrganizationDirectoryAgentProfilesResultSchema.safeParse(
      result
    );
  const returnedProfileIds =
    parsed.success && parsed.data.ok
      ? [
          ...parsed.data.organizationAgentProfiles.map(
            (profile) => profile.profileId
          ),
          ...parsed.data.additionalAgentProfiles.map(
            (profile) => profile.profileId
          ),
        ]
      : [];
  const requestedAdditionalIds = new Set(additionalAgentProfileIds);
  if (
    !(parsed.success && parsed.data.ok) ||
    parsed.data.organizationId !== input.organizationId ||
    hasDuplicateValues(returnedProfileIds) ||
    parsed.data.organizationAgentProfiles.some(
      (profile) => profile.organizationId !== input.organizationId
    ) ||
    parsed.data.additionalAgentProfiles.some(
      (profile) =>
        profile.organizationId === input.organizationId ||
        !requestedAdditionalIds.has(profile.profileId)
    )
  ) {
    logProjectionFailure("agent_profiles_invalid", input);
    throwDirectoryUnavailable();
  }
  return {
    additionalAgentProfiles: parsed.data.additionalAgentProfiles,
    organizationAgentProfiles: parsed.data.organizationAgentProfiles,
  };
}

function hasDuplicateValues(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function logProjectionFailure(
  reason: string,
  input: { organizationId: string; requestId?: string | null },
  error?: unknown
): void {
  console.warn("[core.organization_directory.auth_projection_failed]", {
    ...(error
      ? { error: error instanceof Error ? error.message : String(error) }
      : {}),
    organizationId: input.organizationId,
    reason,
    requestId: input.requestId ?? null,
  });
}

function throwDirectoryUnavailable(): never {
  throw createCoreRpcHttpError({
    code: "organization.directory_unavailable",
    reason: "The Organization Directory is temporarily unavailable.",
    status: 503,
  });
}
