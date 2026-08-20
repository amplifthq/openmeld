import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  rpcCreateAgentProfileCreationRequest,
  rpcDecideAgentProfileCreationRequest,
  rpcListAgentProfileCreationRequests,
} from "../src/agent-profile-creation-request/agent-profile-creation-request-rpc";
import type { CoreBindings } from "../src/lib/bindings";

describe("Agent Profile creation request RPC", () => {
  it("creates an approval item, authorizes the target decision, and creates the target-owned Profile", async () => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganization = vi.fn().mockResolvedValue({
      ok: true,
      profile: {
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      },
    });
    const bindings = {
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DB: env.OPENMELD_DB,
    } as unknown as CoreBindings;

    const created = await rpcCreateAgentProfileCreationRequest(bindings, {
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      idempotencyKey: `request-${fixture.suffix}`,
      organizationId: fixture.organizationId,
      profileName: "Release Reviewer",
      sessionStrategy: "new",
      source: "web",
      targetOwnerUserId: fixture.targetUserId,
    });

    expect(created).toMatchObject({
      replayed: false,
      request: {
        requesterUserId: fixture.requesterUserId,
        status: "pending",
        targetOwnerUserId: fixture.targetUserId,
      },
    });
    const inbox = await env.OPENMELD_DB.prepare(
      `
        SELECT resolution_status, source_target_json
        FROM inbox_items
        WHERE source_key = ?
          AND recipient_user_id = ?
      `
    )
      .bind(created.request.id, fixture.targetUserId)
      .first<{ resolution_status: string; source_target_json: string }>();
    expect(inbox?.resolution_status).toBe("open");
    expect(JSON.parse(inbox?.source_target_json ?? "{}")).toEqual({
      kind: "agent_profile_creation_request",
      requestId: created.request.id,
    });

    const decided = await rpcDecideAgentProfileCreationRequest(bindings, {
      context: contextFor(fixture.targetUserId, fixture.targetProfileId),
      decision: "approve",
      organizationId: fixture.organizationId,
      requestId: created.request.id,
    });

    expect(decided.request).toMatchObject({
      createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      status: "completed",
      statusReason: "profile_created",
    });
    expect(createAgentProfileInOrganization).toHaveBeenCalledWith({
      createdByUserId: fixture.requesterUserId,
      creationActorProfileId: fixture.requesterProfileId,
      idempotencyKey: `agent-profile-creation-request:${created.request.id}`,
      organizationId: fixture.organizationId,
      ownerUserId: fixture.targetUserId,
      profileName: "Release Reviewer",
      source: "web_create",
    });
    await expect(
      rpcListAgentProfileCreationRequests(bindings, {
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        organizationId: fixture.organizationId,
      })
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          id: created.request.id,
          status: "completed",
        }),
      ],
    });
    const resolvedInbox = await env.OPENMELD_DB.prepare(
      `
        SELECT resolution_status
        FROM inbox_items
        WHERE source_key = ?
          AND recipient_user_id = ?
      `
    )
      .bind(created.request.id, fixture.targetUserId)
      .first<{ resolution_status: string }>();
    expect(resolvedInbox?.resolution_status).toBe("resolved");
  });

  it("fails closed for resume until the native session can be verified", async () => {
    const fixture = await seedFixture();
    const bindings = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;

    await expect(
      rpcCreateAgentProfileCreationRequest(bindings, {
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: `resume-${fixture.suffix}`,
        nativeSessionId: "native-codex-session-id",
        organizationId: fixture.organizationId,
        profileName: "Release Reviewer",
        sessionStrategy: "resume",
        source: "web",
        targetOwnerUserId: fixture.targetUserId,
      })
    ).rejects.toMatchObject({
      code: "agent_profile_creation_request.session_strategy_unavailable",
      status: 409,
    });
  });
});

function contextFor(userId: string, profileId: string) {
  return {
    activeOrganizationId: "ignored-by-explicit-route-scope",
    actorContext: {
      callerPrincipalId: userId,
      openMeldProfileId: profileId,
      ownerUserId: userId,
      profileKind: "human" as const,
      profileName: userId,
      requestId: crypto.randomUUID(),
    },
  };
}

async function seedFixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `org-apcr-rpc-${suffix}`;
  const requesterUserId = `user-requester-${suffix}`;
  const targetUserId = `user-target-${suffix}`;
  const requesterProfileId = crypto.randomUUID();
  const targetProfileId = crypto.randomUUID();
  const nowMs = 1_787_220_000_000;
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
    ).bind(organizationId, "Creation Request RPC Test", organizationId, nowMs),
    ...[requesterUserId, targetUserId].map((userId) =>
      env.OPENMELD_DB.prepare(
        "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
      ).bind(userId, userId, `${userId}@openmeld.invalid`, nowMs, nowMs)
    ),
    env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)"
    ).bind(
      `member-requester-${suffix}`,
      organizationId,
      requesterUserId,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)"
    ).bind(`member-target-${suffix}`, organizationId, targetUserId, nowMs),
  ]);
  return {
    organizationId,
    requesterProfileId,
    requesterUserId,
    suffix,
    targetProfileId,
    targetUserId,
  };
}
