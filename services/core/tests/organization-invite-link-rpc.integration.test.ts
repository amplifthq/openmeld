import { env } from "cloudflare:test";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCenterAgentCreateOrganizationInviteLink,
  rpcCenterAgentGetOrganizationInviteLink,
} from "../src/organizations/center-agent-organization-invite-link-rpc";

const ownedFixtures: Array<{ organizationId: string; userId: string }> = [];

afterEach(async () => {
  for (const fixture of ownedFixtures.splice(0)) {
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "DELETE FROM organization_join_links WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM center_agent_designations WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openmeld_profiles WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM members WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare("DELETE FROM organizations WHERE id = ?").bind(
        fixture.organizationId
      ),
      env.OPENMELD_DB.prepare("DELETE FROM users WHERE id = ?").bind(
        fixture.userId
      ),
    ]);
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
    OPENMELD_DB: env.OPENMELD_DB,
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

  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
        VALUES (?, 'Member User', ?, 1, ?, ?)
      `
    ).bind(userId, `${userId}@example.test`, nowMs, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES (?, 'Invite Link Test Organization', ?, ?)
      `
    ).bind(organizationId, `invite-link-${suffix}`, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO members (id, organization_id, user_id, role, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
    ).bind(memberId, organizationId, userId, input.role ?? "member", nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
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
        ) VALUES (?, 'Member User', ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', ?, ?)
      `
    ).bind(
      humanProfileId,
      `invite-link-member-${suffix}`,
      userId,
      userId,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
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
        ) VALUES (?, 'Invite Link Center Agent', ?, 'agent', 0, 'active', ?, NULL, ?, 'auth_bootstrap', 'center_agent', ?, ?)
      `
    ).bind(
      centerAgentProfileId,
      `invite-link-center-agent-${suffix}`,
      organizationId,
      userId,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO center_agent_designations (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        ) VALUES (?, ?, NULL, ?, ?)
      `
    ).bind(organizationId, centerAgentProfileId, userId, nowMs),
  ]);

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
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO organization_join_links (
        id,
        organization_id,
        token,
        role,
        created_by,
        created_at,
        revoked_at
      ) VALUES (?, ?, ?, 'member', ?, ?, ?)
    `
  )
    .bind(
      `join_link_${crypto.randomUUID()}`,
      input.organizationId,
      input.token,
      ownedFixtures.at(-1)?.userId,
      Date.now(),
      input.revokedAt ?? null
    )
    .run();
}
