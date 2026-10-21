import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCenterAgentCreateOrganizationInviteLink,
  rpcCenterAgentGetOrganizationInviteLink,
} from "../src/organizations/center-agent-organization-invite-link-rpc";
import { env } from "../test-support/worker-env";

const ownedFixtures: Array<{
  organizationId: string;
  userId: string;
}> = [];
afterEach(async () => {
  for (const fixture of ownedFixtures.splice(0)) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'DELETE FROM "openmeld"."organization_join_links" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."center_agent_designations" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openmeld_profiles" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."organizations" WHERE id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."users" WHERE id = $1',
              values: [],
            },
            values: [fixture.userId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  }
});
describe("Center Agent organization invite-link RPC", () => {
  it("forwards an owner-attributed ensure request to Auth without a caller role", async () => {
    const fixture = await seedCenterAgentOrganization({ role: "owner" });
    const token = `joinlink_${"c".repeat(64)}`;
    const ensureOrganizationJoinLinkOnBehalfOf = vi.fn(async () => ({
      joinLink: {
        createdAt: new Date().toISOString(),
        createdBy: fixture.userId,
        id: `join_link_${crypto.randomUUID()}`,
        organizationId: fixture.organizationId,
        role: "member" as const,
        token,
        url: `https://openmeld.ai/join-organization?token=${token}`,
      },
      ok: true as const,
      organizationName: "Invite Link Test Organization",
    }));
    await expect(
      rpcCenterAgentCreateOrganizationInviteLink(
        coreEnv({ ensureOrganizationJoinLinkOnBehalfOf }),
        {
          context: fixture.context,
          speakerMember: fixture.speakerMember,
        }
      )
    ).resolves.toEqual({
      ok: true,
      organizationName: "Invite Link Test Organization",
      url: `https://openmeld.ai/join-organization?token=${token}`,
    });
    expect(ensureOrganizationJoinLinkOnBehalfOf).toHaveBeenCalledWith({
      actorUserId: fixture.userId,
      organizationId: fixture.organizationId,
    });
  });
  it("returns Auth's structured refusal for a verified member", async () => {
    const fixture = await seedCenterAgentOrganization({ role: "member" });
    const ensureOrganizationJoinLinkOnBehalfOf = vi.fn(async () => ({
      code: "organization.join_link.forbidden" as const,
      message: "Only an Organization owner or admin can create an invite link.",
      ok: false as const,
    }));
    await expect(
      rpcCenterAgentCreateOrganizationInviteLink(
        coreEnv({ ensureOrganizationJoinLinkOnBehalfOf }),
        {
          context: fixture.context,
          speakerMember: fixture.speakerMember,
        }
      )
    ).resolves.toEqual({
      error: {
        code: "organization.join_link.forbidden",
        message:
          "Only an Organization owner or admin can create an invite link.",
      },
      ok: false,
    });
  });
  it("rejects a caller-supplied speaker role before Auth is called", async () => {
    const fixture = await seedCenterAgentOrganization({ role: "member" });
    const ensureOrganizationJoinLinkOnBehalfOf = vi.fn();
    await expect(
      rpcCenterAgentCreateOrganizationInviteLink(
        coreEnv({ ensureOrganizationJoinLinkOnBehalfOf }),
        {
          context: fixture.context,
          speakerMember: {
            ...fixture.speakerMember,
            role: "owner",
          },
        } as never
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining("invalid_payload"),
    });
    expect(ensureOrganizationJoinLinkOnBehalfOf).not.toHaveBeenCalled();
  });
  it("returns the active member invite URL and Organization name", async () => {
    const fixture = await seedCenterAgentOrganization();
    const token = `joinlink_${"a".repeat(64)}`;
    await seedOrganizationJoinLink({
      organizationId: fixture.organizationId,
      token,
    });
    await expect(
      rpcCenterAgentGetOrganizationInviteLink(coreEnv(), {
        context: fixture.context,
      })
    ).resolves.toEqual({
      active: true,
      organizationName: "Invite Link Test Organization",
      url: `https://openmeld.ai/join-organization?token=${token}`,
    });
  });
  it("returns generation guidance when the Organization has no invite link", async () => {
    const fixture = await seedCenterAgentOrganization();
    await expect(
      rpcCenterAgentGetOrganizationInviteLink(coreEnv(), {
        context: fixture.context,
      })
    ).resolves.toEqual({
      active: false,
      generationGuidance: {
        requiredRole: "member",
        settingsLocation: "Settings → Workspace → General",
        settingsSection: "Invite link",
      },
    });
  });
  it("does not return a revoked Organization invite link", async () => {
    const fixture = await seedCenterAgentOrganization();
    await seedOrganizationJoinLink({
      organizationId: fixture.organizationId,
      revokedAt: Date.now(),
      token: `joinlink_${"b".repeat(64)}`,
    });
    await expect(
      rpcCenterAgentGetOrganizationInviteLink(coreEnv(), {
        context: fixture.context,
      })
    ).resolves.toEqual({
      active: false,
      generationGuidance: {
        requiredRole: "member",
        settingsLocation: "Settings → Workspace → General",
        settingsSection: "Invite link",
      },
    });
  });
});
function coreEnv(
  authWorker: Partial<NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>> = {}
): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: authWorker,
    OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    OPENMELD_SPACES: env.OPENMELD_SPACES,
    WEB_APP_URL: "https://openmeld.ai",
  } as CoreBindings;
}
async function seedCenterAgentOrganization(
  input: { role?: "admin" | "member" | "owner" } = {}
) {
  const suffix = crypto.randomUUID();
  const nowMs = Date.now();
  const organizationId = `org_invite_link_${suffix}`;
  const userId = `user_invite_link_${suffix}`;
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
  const humanProfileId = crypto.randomUUID();
  const memberId = `member_invite_link_${suffix}`;
  ownedFixtures.push({ organizationId, userId });
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
        VALUES ($1, 'Member User', $2, 1, $3, $4)
      `,
            values: [],
          },
          values: [userId, `${userId}@example.test`, nowMs, nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
        VALUES ($1, 'Invite Link Test Organization', $2, $3)
      `,
            values: [],
          },
          values: [organizationId, `invite-link-${suffix}`, nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
            values: [],
          },
          values: [
            memberId,
            organizationId,
            userId,
            input.role ?? "member",
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          organization_id,
          owner_user_id,
          created_by_user_id,
          source,
          created_at,
          updated_at
        ) VALUES ($1, 'Member User', $2, 'human', 1, 'active', NULL, $3, $4, 'auth_bootstrap', $5, $6)
      `,
            values: [],
          },
          values: [
            humanProfileId,
            `invite-link-member-${suffix}`,
            userId,
            userId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          organization_id,
          owner_user_id,
          created_by_user_id,
          source,
          managed_role,
          created_at,
          updated_at
        ) VALUES ($1, 'Invite Link Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'auth_bootstrap', 'center_agent', $5, $6)
      `,
            values: [],
          },
          values: [
            centerAgentProfileId,
            `invite-link-center-agent-${suffix}`,
            organizationId,
            userId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."center_agent_designations" (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        ) VALUES ($1, $2, NULL, $3, $4)
      `,
            values: [],
          },
          values: [organizationId, centerAgentProfileId, userId, nowMs],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return {
    context: {
      activeOrganizationId: organizationId,
      actorContext: {
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        callerPrincipalId: centerAgentProfileId,
        profileKind: "agent" as const,
        requestId: `request_invite_link_${suffix}`,
        openMeldProfileId: centerAgentProfileId,
      },
      agentControllerConversationId: `submission_invite_link_${suffix}`,
    },
    organizationId,
    speakerMember: { memberId, userId },
    userId,
  };
}
async function seedOrganizationJoinLink(input: {
  organizationId: string;
  revokedAt?: number | null;
  token: string;
}) {
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."organization_join_links" (
        id,
        organization_id,
        token,
        role,
        created_by,
        created_at,
        revoked_at
      ) VALUES ($1, $2, $3, 'member', $4, $5, $6)
    `,
      values: [],
    },
    values: [
      `join_link_${crypto.randomUUID()}`,
      input.organizationId,
      input.token,
      ownedFixtures.at(-1)?.userId,
      Date.now(),
      input.revokedAt ?? null,
    ],
  });
}
