import {
  createAuthDatabase,
  createDrizzleMemberAgentRepository,
} from "@openmeld/auth/server";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import { readOpenMeldRequestedOrganizationSelector } from "@openmeld/gateway-contract";
import {
  listMemberAgentsResponseSchema,
  MEMBER_AGENT_NOT_FOUND_CODE,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
  MEMBER_AGENTS_ENABLED,
  type ResolveMemberAgentProfilesResponse,
  resolveMemberAgentProfilesResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldRequestedOrganizationSelector } from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type { AppContext } from "../context";
import { toListMemberAgentsResponse } from "../member-agents/member-agent-listing";
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
    const caller = await resolveMemberAgentReadCaller(c, enabled);
    if (!caller.ok) {
      return caller.response;
    }
    const listing = await createDrizzleMemberAgentRepository(
      createAuthDatabase()
    ).listForOwnerInOrganization({
      organizationId: caller.organizationId,
      ownerUserId: caller.userId,
    });
    return c.json(
      listMemberAgentsResponseSchema.parse(
        toListMemberAgentsResponse(caller.organizationId, listing)
      )
    );
  });
  // Any current member resolves a MemberAgent link to the Profiles they can
  // see, so an owner's link opens the read-only Agent page for teammates.
  app.get(`${MEMBER_AGENT_ROUTE_BASE}/:memberAgentId/profiles`, async (c) => {
    const caller = await resolveMemberAgentReadCaller(c, enabled);
    if (!caller.ok) {
      return caller.response;
    }
    const resolved = await readVisibleMemberAgentProfiles(caller.db, {
      memberAgentId: c.req.param("memberAgentId"),
      organizationId: caller.organizationId,
    });
    if (!resolved) {
      return c.json(
        {
          ok: false,
          code: MEMBER_AGENT_NOT_FOUND_CODE,
          message: "This Agent isn't available in this organization.",
        },
        404
      );
    }
    return c.json(resolveMemberAgentProfilesResponseSchema.parse(resolved));
  });
}

type MemberAgentReadCaller =
  | { ok: true; db: PostgresDatabase; organizationId: string; userId: string }
  | { ok: false; response: Response };

// Every MemberAgent read is no-store and needs a signed-in, current member
// of the requested (or Session) Organization.
async function resolveMemberAgentReadCaller(
  c: Context<AppContext>,
  enabled: boolean
): Promise<MemberAgentReadCaller> {
  c.header("Cache-Control", "private, no-store");
  const fail = (
    status: 400 | 403 | 404,
    code: string,
    message: string
  ): MemberAgentReadCaller => ({
    ok: false,
    response: c.json({ ok: false, code, message }, status),
  });
  if (!enabled) {
    return fail(
      404,
      MEMBER_AGENTS_DISABLED_CODE,
      MEMBER_AGENTS_DISABLED_MESSAGE
    );
  }
  const authenticated = requireAuthenticatedUser(c);
  if (!authenticated.ok) {
    return { ok: false, response: authenticated.response };
  }
  const userId = String(authenticated.user.id);
  let requestedOrganization: OpenMeldRequestedOrganizationSelector | null;
  try {
    requestedOrganization = readOpenMeldRequestedOrganizationSelector(
      c.req.raw.headers
    );
  } catch {
    return fail(
      400,
      "organization.context_invalid",
      "Choose a valid organization."
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
  // The Session fallback is not membership-checked by the resolver; these
  // reads require current membership whichever way the organization came.
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
    return fail(
      403,
      "organization.membership_required",
      "You do not have access to this organization."
    );
  }
  if (!organizationContext.ok) {
    return fail(403, organizationContext.code, organizationContext.message);
  }
  const organizationId = organizationContext.activeOrganizationId;
  if (!organizationId) {
    return fail(
      400,
      "organization.context_required",
      "Choose an organization to see its Agents."
    );
  }
  return { ok: true, db, organizationId, userId };
}

// Visibility follows All Agents: active Agent Profiles of the Organization.
// A MemberAgent of another Organization reads as missing.
async function readVisibleMemberAgentProfiles(
  db: PostgresDatabase,
  input: { memberAgentId: string; organizationId: string }
): Promise<ResolveMemberAgentProfilesResponse | null> {
  const memberAgent = await db.query<{
    default_profile_id: string | null;
    harness_kind: string;
    owner_user_id: string;
  }>({
    text: `SELECT owner_user_id, harness_kind, default_profile_id
      FROM "openmeld"."member_agents"
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    values: [input.memberAgentId, input.organizationId],
  });
  const row = memberAgent.rows[0];
  if (!row) {
    return null;
  }
  const profiles = await db.query<{ profile_id: string }>({
    text: `SELECT profile_id FROM "openmeld"."openmeld_profiles"
      WHERE member_agent_id = $1 AND organization_id = $2
        AND profile_kind = 'agent' AND status = 'active'
      ORDER BY created_at ASC, profile_id ASC`,
    values: [input.memberAgentId, input.organizationId],
  });
  const profileIds = profiles.rows.map((profile) => profile.profile_id);
  return {
    ok: true,
    organizationId: input.organizationId,
    memberAgentId: input.memberAgentId,
    ownerUserId: row.owner_user_id,
    harnessKind:
      row.harness_kind as ResolveMemberAgentProfilesResponse["harnessKind"],
    defaultProfileId:
      row.default_profile_id && profileIds.includes(row.default_profile_id)
        ? row.default_profile_id
        : null,
    profileIds,
  };
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
