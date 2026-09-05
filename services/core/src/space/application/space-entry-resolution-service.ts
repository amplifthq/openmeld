import type {
  GetSpaceEntryResolutionResponse,
  GetSpaceStatusResponse,
  SpaceEntrySafeContext,
  SpaceEntryTarget,
} from "@openmeld/schemas/types";

export type SpaceEntryAccessResult =
  | {
      kind: "allowed";
      activeMember: boolean;
      status: GetSpaceStatusResponse;
    }
  | {
      kind: "denied";
      code:
        | "space.membership_required"
        | "space.password_invalid"
        | "space.password_required";
    };

export type SpaceEntryIndexedContext = {
  organizationId: string;
  organizationSlug?: string;
  owner?: SpaceEntrySafeContext["owner"];
  spaceName?: string;
  visibility: "private" | "public";
};

export function buildSpaceEntryResolution(input: {
  access: SpaceEntryAccessResult;
  authenticated: boolean;
  indexed: SpaceEntryIndexedContext;
  organizationMember: boolean;
  target: SpaceEntryTarget;
}): GetSpaceEntryResolutionResponse {
  if (input.access.kind === "allowed") {
    const memberExperience =
      input.access.activeMember ||
      input.access.status.accessMode === "members_only";
    return {
      target: input.target,
      view: {
        state: "allowed",
        experience: memberExperience ? "member" : "public",
      },
      participation: resolveAllowedParticipation(input.access),
      safeContext: buildSafeContext({
        indexed: input.indexed,
        organizationMember: input.organizationMember,
        publicSpaceName: input.access.status.name,
      }),
      recovery: null,
    };
  }

  if (
    input.access.code === "space.password_required" ||
    input.access.code === "space.password_invalid"
  ) {
    return {
      target: input.target,
      view: { state: "password_required" },
      participation: { state: "password_required" },
      safeContext: buildSafeContext({
        indexed: input.indexed,
        organizationMember: input.organizationMember,
      }),
      recovery: { kind: "provide_password" },
    };
  }

  if (input.organizationMember) {
    return {
      target: input.target,
      view: { state: "membership_required" },
      participation: { state: "owner_add_required" },
      safeContext: buildSafeContext({
        indexed: input.indexed,
        organizationMember: true,
      }),
      recovery: { kind: "contact_space_owner" },
    };
  }

  if (!input.authenticated && input.indexed.visibility === "public") {
    return {
      target: input.target,
      view: { state: "sign_in_required" },
      participation: { state: "owner_add_required" },
      safeContext: {},
      recovery: { kind: "sign_in" },
    };
  }

  return buildUnavailableSpaceEntryResolution(input.target);
}

export function buildUnavailableSpaceEntryResolution(
  target: SpaceEntryTarget
): GetSpaceEntryResolutionResponse {
  return {
    target,
    view: { state: "unavailable" },
    participation: { state: "unavailable" },
    safeContext: {},
    recovery: null,
  };
}

function resolveAllowedParticipation(
  access: Extract<SpaceEntryAccessResult, { kind: "allowed" }>
): GetSpaceEntryResolutionResponse["participation"] {
  if (access.activeMember) {
    return { state: "active_member" };
  }
  if (access.status.accessMode === "public_view_join_password") {
    return { state: "password_required" };
  }
  if (access.status.accessMode === "members_only") {
    return { state: "owner_add_required" };
  }
  return { state: "self_join_available" };
}

function buildSafeContext(input: {
  indexed: SpaceEntryIndexedContext;
  organizationMember: boolean;
  publicSpaceName?: string;
}): SpaceEntrySafeContext {
  if (!input.organizationMember) {
    return input.publicSpaceName ? { spaceName: input.publicSpaceName } : {};
  }
  return {
    organizationId: input.indexed.organizationId,
    ...(input.indexed.organizationSlug
      ? { organizationSlug: input.indexed.organizationSlug }
      : {}),
    ...(input.indexed.spaceName ? { spaceName: input.indexed.spaceName } : {}),
    ...(input.indexed.owner ? { owner: input.indexed.owner } : {}),
  };
}
