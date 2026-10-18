import {
  createAuthDatabase,
  createDrizzleMemberAgentRepository,
  type OwnerMemberAgentListing,
} from "@openmeld/auth/server";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import { readOpenMeldRequestedOrganizationSelector } from "@openmeld/gateway-contract";
import {
  type ListMemberAgentsResponse,
  listMemberAgentsResponseSchema,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
  MEMBER_AGENTS_ENABLED,
} from "@openmeld/schemas";
import type { OpenMeldRequestedOrganizationSelector } from "@openmeld/schemas/types";
import type { Hono } from "hono";
import type { AppContext } from "../context";
import { resolveAuthenticatedOrganizationContext } from "../organization/authenticated-organization-context";
import { requireAuthenticatedUser } from "./authenticated-user";

export const MEMBER_AGENT_ROUTE_BASE = "/v1/member-agents";

export function registerMemberAgentRoutes(
  app: Hono<AppContext>,
  // Tests opt in explicitly; production follows the shared release decision.
  options: { enabled?: boolean } = {}
) {
  const enabled = options.enabled ?? MEMBER_AGENTS_ENABLED;
  app.get(MEMBER_AGENT_ROUTE_BASE, async (c) => {
    c.header("Cache-Control", "private, no-store");
    if (!enabled) {
      return c.json(
        {
          ok: false,
          code: MEMBER_AGENTS_DISABLED_CODE,
          message: MEMBER_AGENTS_DISABLED_MESSAGE,
        },
        404
      );
    }
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }
    const userId = String(authenticated.user.id);
    let requestedOrganization: OpenMeldRequestedOrganizationSelector | null;
    try {
      requestedOrganization = readOpenMeldRequestedOrganizationSelector(
        c.req.raw.headers
      );
    } catch {
      return c.json(
        {
          ok: false,
          code: "organization.context_invalid",
          message: "Choose a valid organization.",
        },
        400
      );
    }
    const db = getPostgresDatabase(c.env);
    const organizationContext = await resolveAuthenticatedOrganizationContext({
      db,
      requestedOrganization,
      sessionActiveOrganizationId: (
        c.var.session as { activeOrganizationId?: unknown } | null
      )?.activeOrganizationId,
      userId,
    });
    // The Session fallback is not membership-checked by the resolver; this
    // read requires current membership whichever way the organization came.
    if (
      organizationContext.ok &&
      organizationContext.source === "session" &&
      organizationContext.activeOrganizationId &&
      !(await isCurrentMember(
        db,
        userId,
        organizationContext.activeOrganizationId
      ))
    ) {
      return c.json(
        {
          ok: false,
          code: "organization.membership_required",
          message: "You do not have access to this organization.",
        },
        403
      );
    }
    if (!organizationContext.ok) {
      return c.json(
        {
          ok: false,
          code: organizationContext.code,
          message: organizationContext.message,
        },
        403
      );
    }
    const organizationId = organizationContext.activeOrganizationId;
    if (!organizationId) {
      return c.json(
        {
          ok: false,
          code: "organization.context_required",
          message: "Choose an organization to see its Agents.",
        },
        400
      );
    }
    const listing = await createDrizzleMemberAgentRepository(
      createAuthDatabase()
    ).listForOwnerInOrganization({ organizationId, ownerUserId: userId });
    return c.json(
      listMemberAgentsResponseSchema.parse(
        toListMemberAgentsResponse(organizationId, listing)
      )
    );
  });
}

async function isCurrentMember(
  db: PostgresDatabase,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const result = await db.query<{ member: number }>({
    text: `SELECT 1 AS member FROM "openmeld"."members"
      WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
    values: [userId, organizationId],
  });
  return result.rows.length > 0;
}

function toListMemberAgentsResponse(
  organizationId: string,
  listing: OwnerMemberAgentListing
): ListMemberAgentsResponse {
  return {
    ok: true,
    organizationId,
    memberAgents: listing.memberAgents.map((memberAgent) => ({
      id: memberAgent.id,
      organizationId: memberAgent.organizationId,
      ownerUserId: memberAgent.ownerUserId,
      harnessKind: memberAgent.harnessKind,
      defaultProfileId: memberAgent.defaultProfileId,
      source: memberAgent.source,
      archivedAt: memberAgent.archivedAt?.toISOString() ?? null,
      profiles: memberAgent.profiles.map((profile) => ({
        openMeldProfileId: profile.profileId,
        profileName: profile.profileName,
        isDefault: profile.isDefault,
      })),
    })),
    unassignedProfiles: listing.unassignedProfiles.map((profile) => ({
      openMeldProfileId: profile.profileId,
      profileName: profile.profileName,
    })),
  };
}
