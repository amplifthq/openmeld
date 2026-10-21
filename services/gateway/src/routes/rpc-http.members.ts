import {
  OPENMELD_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
} from "@openmeld/gateway-contract";
import {
  leaveSpaceResponseSchema,
  postSpaceMembersResponseSchema,
  removeSpaceMembersResponseSchema,
  spaceHistoryNavigationQuerySchema,
  spaceHistoryNavigationSchema,
  spaceIdentityDirectorySchema,
  spaceMemberDirectorySchema,
  spaceMembersSnapshotSchema,
  spaceViewerMembershipResponseSchema,
} from "@openmeld/schemas";
import type { ResolvedSpaceMemberProfile } from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import { resolveProfile } from "../lib/auth-rpc-client";
import { mapAuthRpcHttpError } from "../lib/auth-rpc-error";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  formatAuditValue,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";
import {
  parseAddCenterAgentToSpaceBody,
  parseAddOrganizationDirectoryProfilesToSpaceBody,
  parsePostSpaceMembersBody,
  parseRemoveSpaceMembersBody,
  parseSpaceRouteParams,
  readJsonRequestBody,
} from "./rpc-http.parsers";

const SPACE_MEMBERS_ROUTE = "/v1/spaces/:spaceId/members";
const SPACE_MEMBER_DIRECTORY_ROUTE = "/v1/spaces/:spaceId/member-directory";
const SPACE_IDENTITY_DIRECTORY_ROUTE = "/v1/spaces/:spaceId/identity-directory";
const SPACE_VIEWER_MEMBERSHIP_ROUTE = "/v1/spaces/:spaceId/viewer-membership";
const SPACE_REMOVE_MEMBERS_ROUTE = "/v1/spaces/:spaceId/members/remove";
const SPACE_JOIN_ROUTE = "/v1/spaces/:spaceId/join";
const SPACE_LEAVE_ROUTE = "/v1/spaces/:spaceId/leave";
const SPACE_CENTER_AGENT_MEMBER_ROUTE = "/v1/spaces/:spaceId/center-agent";
const SPACE_ORGANIZATION_DIRECTORY_PROFILES_ROUTE =
  "/v1/spaces/:spaceId/organization-directory-profiles";

export function registerMembersRoutes(app: Hono<HonoBindings>): void {
  app.get(
    "/v1/spaces/:spaceId/history-navigation",
    (c): Response | Promise<Response> => {
      const parsed = parseSpaceRouteParams(c.req.param("spaceId"));
      const query = spaceHistoryNavigationQuerySchema.safeParse(c.req.query());
      if (!(parsed.ok && query.success)) {
        return c.json(
          {
            error: {
              code: "invalid_history_navigation",
              message: "Invalid history range.",
            },
          },
          400
        );
      }
      const spaceId = parsed.value.spaceId;
      return executeRpcRoute({
        c,
        route: "/v1/spaces/:spaceId/history-navigation",
        method: "GET",
        spaceId,
        execute: () =>
          c.var.coreRpc.getSpaceHistoryNavigation({
            ...query.data,
            spaceId,
            spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
          }),
        responseSchema: spaceHistoryNavigationSchema,
      });
    }
  );
  app.get(SPACE_MEMBER_DIRECTORY_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_MEMBER_DIRECTORY_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    return executeRpcRoute({
      c,
      route: SPACE_MEMBER_DIRECTORY_ROUTE,
      method: "GET",
      spaceId,
      includeLegacySpaceAddressingWireFields: true,
      execute: async () => {
        return await c.var.coreRpc.getSpaceMemberDirectory(
          {
            spaceId,
            spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
          },
          OPENMELD_SPACE_ADDRESSING_VERSION,
          OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION
        );
      },
      responseSchema: spaceMemberDirectorySchema,
    });
  });

  app.get(SPACE_IDENTITY_DIRECTORY_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_IDENTITY_DIRECTORY_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    return executeRpcRoute({
      c,
      route: SPACE_IDENTITY_DIRECTORY_ROUTE,
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceIdentityDirectory({
          spaceId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        });
      },
      responseSchema: spaceIdentityDirectorySchema,
    });
  });

  app.get(SPACE_VIEWER_MEMBERSHIP_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_VIEWER_MEMBERSHIP_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    return executeRpcRoute({
      c,
      route: SPACE_VIEWER_MEMBERSHIP_ROUTE,
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceViewerMembership({
          spaceId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        });
      },
      responseSchema: spaceViewerMembershipResponseSchema,
    });
  });

  app.get(SPACE_MEMBERS_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_MEMBERS_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;

    return executeRpcRoute({
      c,
      route: SPACE_MEMBERS_ROUTE,
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceMembers({
          spaceId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        });
      },
      responseSchema: spaceMembersSnapshotSchema,
    });
  });

  app.post(SPACE_MEMBERS_ROUTE, async (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_MEMBERS_ROUTE,
        method: "POST",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_MEMBERS_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
        reason: `invalid_space_members_add body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }

    const parsed = parsePostSpaceMembersBody(bodyResult.value);
    if (!parsed.ok) {
      return respondBadRequest({
        c,
        route: SPACE_MEMBERS_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: parsed.message,
        spaceId,
        reason: `invalid_space_members_add body=${formatAuditValue(bodyResult.value)}`,
      });
    }

    const memberProfileIds = dedupeMemberProfileIds(
      parsed.value.memberProfileIds
    );
    return executeRpcRoute({
      c,
      route: SPACE_MEMBERS_ROUTE,
      method: "POST",
      spaceId,
      execute: async () => {
        const members = await resolveRequestedMembers({
          c,
          memberProfileIds,
        });

        return await c.var.coreRpc.addSpaceMembers({
          requestCredential: await buildCoreRpcCredential(c),
          spaceId,
          members,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
      responseSchema: postSpaceMembersResponseSchema,
    });
  });

  app.post(SPACE_REMOVE_MEMBERS_ROUTE, async (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_REMOVE_MEMBERS_ROUTE,
        method: "POST",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_REMOVE_MEMBERS_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
        reason: `invalid_space_members_remove body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }

    const parsed = parseRemoveSpaceMembersBody(bodyResult.value);
    if (!parsed.ok) {
      return respondBadRequest({
        c,
        route: SPACE_REMOVE_MEMBERS_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: parsed.message,
        spaceId,
        reason: `invalid_space_members_remove body=${formatAuditValue(bodyResult.value)}`,
      });
    }

    const memberProfileIds = dedupeMemberProfileIds(
      parsed.value.memberProfileIds
    );
    return executeRpcRoute({
      c,
      route: SPACE_REMOVE_MEMBERS_ROUTE,
      method: "POST",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.removeSpaceMembers({
          spaceId,
          memberProfileIds,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
      responseSchema: removeSpaceMembersResponseSchema,
    });
  });

  app.post(SPACE_JOIN_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_JOIN_ROUTE,
        method: "POST",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const password = readSpacePasswordHeader(c.req.raw.headers);
    return executeRpcRoute({
      c,
      route: SPACE_JOIN_ROUTE,
      method: "POST",
      spaceId,
      execute: async () =>
        await c.var.coreRpc.joinOrganizationPublicSpace({
          spaceId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        }),
      responseSchema: postSpaceMembersResponseSchema,
    });
  });

  app.post(SPACE_CENTER_AGENT_MEMBER_ROUTE, async (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_CENTER_AGENT_MEMBER_ROUTE,
        method: "POST",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_CENTER_AGENT_MEMBER_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
        reason: `invalid_center_agent_member_add body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }
    const parsedBody = parseAddCenterAgentToSpaceBody(bodyResult.value);
    if (!parsedBody.ok) {
      return respondBadRequest({
        c,
        route: SPACE_CENTER_AGENT_MEMBER_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: parsedBody.message,
        spaceId,
        reason: `invalid_center_agent_member_add body=${formatAuditValue(bodyResult.value)}`,
      });
    }
    return executeRpcRoute({
      c,
      route: SPACE_CENTER_AGENT_MEMBER_ROUTE,
      method: "POST",
      spaceId,
      execute: async () =>
        await c.var.coreRpc.addCenterAgentToSpace({
          expectedCenterAgentProfileId:
            parsedBody.value.expectedCenterAgentProfileId,
          spaceId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        }),
      responseSchema: postSpaceMembersResponseSchema,
    });
  });

  app.post(SPACE_ORGANIZATION_DIRECTORY_PROFILES_ROUTE, async (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_ORGANIZATION_DIRECTORY_PROFILES_ROUTE,
        method: "POST",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_ORGANIZATION_DIRECTORY_PROFILES_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
        reason: `invalid_organization_directory_profiles_add body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }
    const parsedBody = parseAddOrganizationDirectoryProfilesToSpaceBody(
      bodyResult.value
    );
    if (!parsedBody.ok) {
      return respondBadRequest({
        c,
        route: SPACE_ORGANIZATION_DIRECTORY_PROFILES_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: parsedBody.message,
        spaceId,
        reason: `invalid_organization_directory_profiles_add body=${formatAuditValue(bodyResult.value)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_ORGANIZATION_DIRECTORY_PROFILES_ROUTE,
      method: "POST",
      spaceId,
      execute: async () =>
        await c.var.coreRpc.addOrganizationDirectoryProfilesToSpace({
          directoryProfileIds: parsedBody.value.directoryProfileIds,
          ...(parsedBody.value.expectedCenterAgentProfileId === undefined
            ? {}
            : {
                expectedCenterAgentProfileId:
                  parsedBody.value.expectedCenterAgentProfileId,
              }),
          spaceId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        }),
      responseSchema: postSpaceMembersResponseSchema,
    });
  });

  app.post(SPACE_LEAVE_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_LEAVE_ROUTE,
        method: "POST",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const password = readSpacePasswordHeader(c.req.raw.headers);
    return executeRpcRoute({
      c,
      route: SPACE_LEAVE_ROUTE,
      method: "POST",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.leaveSpace({
          spaceId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
      responseSchema: leaveSpaceResponseSchema,
    });
  });
}

function dedupeMemberProfileIds(memberProfileIds: string[]): string[] {
  const uniqueProfileIds: string[] = [];
  const seenProfileIds = new Set<string>();

  for (const memberProfileId of memberProfileIds) {
    if (seenProfileIds.has(memberProfileId)) {
      continue;
    }
    seenProfileIds.add(memberProfileId);
    uniqueProfileIds.push(memberProfileId);
  }

  return uniqueProfileIds;
}

async function resolveRequestedMembers(input: {
  c: Context<HonoBindings>;
  memberProfileIds: string[];
}): Promise<ResolvedSpaceMemberProfile[]> {
  if (input.memberProfileIds.length === 0) {
    return [];
  }

  return await Promise.all(
    input.memberProfileIds.map(async (memberProfileId) => {
      const result = await resolveProfile({
        authRpc: input.c.var.authRpc,
        headers: input.c.req.raw.headers,
        requestId: input.c.var.openMeldRequestContext.actorContext.requestId,
        openMeldProfileId: memberProfileId,
      });
      if (!result.ok) {
        throw toAuthRpcHttpError({
          code: result.code,
          message: result.message,
        });
      }
      return validateResolvedMember({
        memberProfileId,
        profile: result.resolvedProfile,
      });
    })
  );
}

type ResolvedAddMemberProfile = {
  openMeldProfileId: string;
  profileKind: "human" | "agent" | "system";
  profileName: string;
  ownerUserId: string;
  ownerName?: string;
};

function validateResolvedMember(input: {
  memberProfileId: string;
  profile: ResolvedAddMemberProfile | undefined;
}): ResolvedSpaceMemberProfile {
  if (!input.profile) {
    throw toBadRequestRpcHttpError({
      message: `profile not found: ${input.memberProfileId}`,
      code: "profile.not_found",
    });
  }

  if (input.profile.profileKind === "system") {
    throw toBadRequestRpcHttpError({
      message: `system profiles cannot be added as members: ${input.memberProfileId}`,
      code: "profile.invalid_input",
    });
  }

  return {
    profileId: input.profile.openMeldProfileId,
    profileName: input.profile.profileName,
    profileKind: input.profile.profileKind === "human" ? "human" : "agent",
    ownerUserId: input.profile.ownerUserId,
    ownerName: input.profile.ownerName ?? null,
    agentControllerRef: null,
  };
}

function toAuthRpcHttpError(input: { code?: string; message?: string }): {
  status: number;
  code: string;
  message: string;
} {
  const mapped = mapAuthRpcHttpError(input);
  return {
    status: mapped.status,
    code: mapped.code,
    message: mapped.message,
  };
}

function toBadRequestRpcHttpError(input: { message: string; code?: string }): {
  status: number;
  code: string;
  message: string;
} {
  return {
    status: 400,
    code: input.code ?? "bad_request",
    message: input.message,
  };
}
