import { env } from "cloudflare:test";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcCenterAgentListLocalAgentConnectionCandidates } from "../src/rpc/methods";

describe("Center Agent PeopleComputers authorization", () => {
  it("reads the requesting member's devices instead of the hosted Profile owner's devices", async () => {
    const fixture = await seedFixture();
    const result = await rpcCenterAgentListLocalAgentConnectionCandidates(
      fixture.coreEnv,
      {
        context: fixture.context,
        speakerMember: {
          memberId: fixture.member.memberId,
          userId: fixture.member.userId,
        },
      }
    );
    expect(result.candidates.map((candidate) => candidate.deviceId)).toEqual([
      fixture.member.deviceId,
    ]);
    expect(result.candidates[0]?.connectable).toBe(false);
    expect(JSON.stringify(result)).not.toContain(fixture.owner.deviceId);
  });

  it("rejects mismatched member identity and an explicitly requested nonmember", async () => {
    const fixture = await seedFixture();
    await expect(
      rpcCenterAgentListLocalAgentConnectionCandidates(fixture.coreEnv, {
        context: fixture.context,
        speakerMember: {
          memberId: fixture.member.memberId,
          userId: fixture.owner.userId,
        },
      })
    ).rejects.toThrow("verified active human");
    await expect(
      rpcCenterAgentListLocalAgentConnectionCandidates(fixture.coreEnv, {
        context: fixture.context,
        speakerMember: {
          memberId: fixture.member.memberId,
          userId: fixture.member.userId,
        },
        memberUserId: "not-an-organization-member",
      })
    ).rejects.toThrow();
  });

  it("permits explicit team-member candidate discovery without changing the requesting identity", async () => {
    const fixture = await seedFixture();
    const result = await rpcCenterAgentListLocalAgentConnectionCandidates(
      fixture.coreEnv,
      {
        context: fixture.context,
        speakerMember: {
          memberId: fixture.member.memberId,
          userId: fixture.member.userId,
        },
        memberUserId: fixture.owner.userId,
      }
    );
    expect(result.candidates.map((candidate) => candidate.deviceId)).toEqual([
      fixture.owner.deviceId,
    ]);
  });
});

async function seedFixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `org_people_computers_${suffix}`;
  const actors = ["owner", "member"].map((role) => ({
    role,
    userId: `user_${role}_${suffix}`,
    memberId: `member_${role}_${suffix}`,
    profileId: crypto.randomUUID(),
    deviceId: `device_${role}_${suffix}`,
    runtimeId: `runtime_${role}_${suffix}`,
  }));
  const owner = actors[0];
  const member = actors[1];
  if (!(owner && member)) {
    throw new Error("Missing fixture members.");
  }
  const centerAgentId = `agt_${crypto.randomUUID()}`;
  const now = Date.now();
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Computer test', ?, ?)"
  )
    .bind(organizationId, `people-computers-${suffix}`, now)
    .run();
  for (const actor of actors) {
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
      ).bind(actor.userId, actor.role, `${actor.userId}@example.com`, now, now),
      env.OPENMELD_DB.prepare(
        "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(actor.memberId, organizationId, actor.userId, actor.role, now),
      env.OPENMELD_DB.prepare(
        "INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES (?, ?, ?, 'human', 1, 'active', ?, ?, 'auth_bootstrap', ?, ?)"
      ).bind(
        actor.profileId,
        actor.role,
        `${actor.role}-${suffix}`,
        actor.userId,
        actor.userId,
        now,
        now
      ),
      env.OPENMELD_DB.prepare(
        "INSERT INTO openMeldDaemon_owned_devices (owner_user_id, device_id, observed_display_name, platform_family, device_type, first_seen_at_ms, last_observed_at_ms, updated_at_ms) VALUES (?, ?, ?, 'macOS', 'laptop', ?, ?, ?)"
      ).bind(
        actor.userId,
        actor.deviceId,
        `${actor.role} computer`,
        now,
        now,
        now
      ),
      env.OPENMELD_DB.prepare(
        "INSERT INTO openMeldDaemon_runtime_registry_records (openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane, created_at_ms, last_registered_at_ms, updated_at_ms) VALUES (?, 'owner_account', ?, ?, 'prod', ?, ?, ?)"
      ).bind(actor.runtimeId, actor.userId, actor.deviceId, now, now, now),
      env.OPENMELD_DB.prepare(
        "INSERT INTO openMeldDaemon_runtime_agent_controller_reports (openmeld_service_runtime_id, agent_controller_ref, report_status, observed_at_ms, expires_at_ms, reported_reason_codes_json, accepted_at_ms, updated_at_ms) VALUES (?, 'builtin:codex', 'ready', ?, ?, '[]', ?, ?)"
      ).bind(actor.runtimeId, now, now + 60_000, now, now),
    ]);
  }
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO openmeld_profiles (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, managed_role, created_at, updated_at) VALUES (?, 'Center Agent', ?, 'agent', 0, 'active', ?, ?, ?, 'cli_create', 'center_agent', ?, ?)"
    ).bind(
      centerAgentId,
      `center-agent-${suffix}`,
      organizationId,
      owner.userId,
      owner.userId,
      now,
      now
    ),
    env.OPENMELD_DB.prepare(
      "INSERT INTO center_agent_designations (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES (?, ?, NULL, ?, ?)"
    ).bind(organizationId, centerAgentId, owner.userId, now),
  ]);
  const context: OpenMeldRequestContext = {
    activeOrganizationId: organizationId,
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: owner.userId,
      ownerUserId: owner.userId,
      openMeldProfileId: centerAgentId,
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: suffix,
    },
  };
  // Real D1 authorization and reports; no Service transport is configured, so
  // connection remains unknown and historical reports cannot admit execution.
  return {
    context,
    owner,
    member,
    coreEnv: { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings,
  };
}
