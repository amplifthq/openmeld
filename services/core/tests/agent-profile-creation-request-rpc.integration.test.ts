import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  rpcCenterAgentCreateAgentProfileCreationRequest,
  rpcCreateAgentProfileCreationRequest,
  rpcDecideAgentProfileCreationRequest,
  rpcListAgentProfileCreationRequests,
} from "../src/agent-profile-creation-request/agent-profile-creation-request-rpc";
import type { CoreBindings } from "../src/lib/bindings";
// biome-ignore lint/performance/noNamespaceImport: Vitest needs the module object to replace this dependency at the RPC boundary.
import * as currentDeviceTargetService from "../src/start/application/current-device-target-service";

describe("Agent Profile creation request RPC", () => {
  it("does not create an Agent Profile when the selected local agent is no longer available", async () => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganizationMock = vi.fn().mockResolvedValue({
      ok: true,
      profile: {
        openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
      },
    });
    const listLocalRuntimes = vi
      .spyOn(currentDeviceTargetService, "listLocalRuntimesUseCase")
      .mockResolvedValue({
        currentConnectedComputerId: null,
        currentDeviceId: null,
        currentRuntimeLane: null,
        legacyDeviceEvidence: [],
        localRuntimes: [],
      });
    const bindings = {
      OPENMELD_AUTH_WORKER: {
        createAgentProfileInOrganization: createAgentProfileInOrganizationMock,
      },
      OPENMELD_DB: env.OPENMELD_DB,
    } as unknown as CoreBindings;

    try {
      const result = await rpcCreateAgentProfileCreationRequest(bindings, {
        configuration: {
          agentControllerCollaborationMode: null,
          agentControllerPermissionMode: null,
          agentControllerRef: "builtin:codex",
          authorizeForOrganization: true,
          defaultProjectId: null,
          modelId: null,
          openCodePermission: null,
          reasoningLevel: null,
          targetComputerId: "device-that-disconnected",
        },
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: `stale-local-agent-${fixture.suffix}`,
        organizationId: fixture.organizationId,
        profileName: "Release Reviewer",
        sessionStrategy: "new",
        source: "web",
        targetOwnerUserId: fixture.requesterUserId,
      });

      expect(result.request).toMatchObject({
        createdAgentProfileId: null,
        failureMessage:
          "The selected local agent is no longer available on that Computer.",
        status: "failed",
      });
      expect(createAgentProfileInOrganizationMock).not.toHaveBeenCalled();
      expect(listLocalRuntimes).toHaveBeenCalled();
    } finally {
      listLocalRuntimes.mockRestore();
    }
  });

  it("uses the represented member as requester and the Center Agent as actor", async () => {
    const fixture = await seedFixture();
    const bindings = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;

    const created = await rpcCenterAgentCreateAgentProfileCreationRequest(
      bindings,
      {
        context: {
          activeOrganizationId: fixture.organizationId,
          actorContext: {
            callerPrincipalId: fixture.requesterUserId,
            openMeldProfileId: fixture.centerAgentProfileId,
            ownerUserId: fixture.requesterUserId,
            profileKind: "agent",
            profileName: "Center Agent",
            requestId: `center-request-${fixture.suffix}`,
          },
        },
        onBehalfOf: { profileId: fixture.requesterProfileId },
        profileName: "Center Requested Reviewer",
        sessionStrategy: "new",
        targetOwnerUserId: fixture.targetUserId,
      }
    );

    expect(created.request).toMatchObject({
      actorProfileId: fixture.centerAgentProfileId,
      profileName: "Center Requested Reviewer",
      requesterUserId: fixture.requesterUserId,
      source: "center_agent",
      status: "pending",
      targetOwnerUserId: fixture.targetUserId,
    });
  });

  it("creates an approval item, authorizes the target decision, and creates the target-owned Profile", async () => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganizationMock = vi.fn().mockResolvedValue({
      ok: true,
      profile: {
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      },
    });
    const createAgentProfileInOrganization = new Proxy(
      createAgentProfileInOrganizationMock,
      {
        get(target, property, receiver) {
          if (property === "call") {
            throw new Error(
              "Cloudflare RPC method stubs must be invoked directly."
            );
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
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
    expect(createAgentProfileInOrganizationMock).toHaveBeenCalledWith({
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

  it("accepts a Resume request for a current matching Session", async () => {
    const fixture = await seedFixture();
    const session = await seedResumeSession(fixture);
    const bindings = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;

    const created = await rpcCreateAgentProfileCreationRequest(bindings, {
      configuration: {
        agentControllerCollaborationMode: null,
        agentControllerPermissionMode: null,
        agentControllerRef: "builtin:codex",
        authorizeForOrganization: true,
        defaultProjectId: session.projectId,
        modelId: null,
        openCodePermission: null,
        reasoningLevel: null,
        targetComputerId: session.computerId,
      },
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      idempotencyKey: `resume-${fixture.suffix}`,
      nativeSessionId: session.nativeSessionId,
      organizationId: fixture.organizationId,
      profileName: "Release Reviewer",
      sessionStrategy: "resume",
      source: "web",
      targetOwnerUserId: fixture.targetUserId,
    });

    expect(created.request).toMatchObject({
      configuration: {
        agentControllerRef: "builtin:codex",
        defaultProjectId: session.projectId,
        targetComputerId: session.computerId,
      },
      nativeSessionId: session.nativeSessionId,
      sessionStrategy: "resume",
      status: "pending",
      targetOwnerUserId: fixture.targetUserId,
    });
  });

  it("accepts a Fork request addressed to the Session's public Computer", async () => {
    const fixture = await seedFixture();
    const session = await seedResumeSession(fixture);
    const bindings = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;

    const created = await rpcCreateAgentProfileCreationRequest(bindings, {
      configuration: {
        agentControllerCollaborationMode: null,
        agentControllerPermissionMode: null,
        agentControllerRef: "builtin:codex",
        authorizeForOrganization: true,
        defaultProjectId: session.projectId,
        modelId: null,
        openCodePermission: null,
        reasoningLevel: null,
        targetComputerId: session.computerId,
      },
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      idempotencyKey: `fork-${fixture.suffix}`,
      nativeSessionId: session.nativeSessionId,
      organizationId: fixture.organizationId,
      profileName: "Release Fork",
      sessionStrategy: "fork",
      source: "web",
      targetOwnerUserId: fixture.targetUserId,
    });

    expect(created.request).toMatchObject({
      configuration: {
        agentControllerRef: "builtin:codex",
        targetComputerId: session.computerId,
      },
      nativeSessionId: session.nativeSessionId,
      sessionStrategy: "fork",
      status: "pending",
    });
  });

  it("rejects Resume when the selected Session is not current and matching", async () => {
    const fixture = await seedFixture();
    const bindings = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;

    await expect(
      rpcCreateAgentProfileCreationRequest(bindings, {
        configuration: {
          agentControllerCollaborationMode: null,
          agentControllerPermissionMode: null,
          agentControllerRef: "builtin:codex",
          authorizeForOrganization: true,
          defaultProjectId: `project-${fixture.suffix}`,
          modelId: null,
          openCodePermission: null,
          reasoningLevel: null,
          targetComputerId: `computer-${fixture.suffix}`,
        },
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: `resume-missing-${fixture.suffix}`,
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
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
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
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES (?, 'Requester', ?, 'human', 1, 'active', NULL, ?, ?,
          'auth_bootstrap', NULL, ?, ?)
      `
    ).bind(
      requesterProfileId,
      `requester-${suffix}`,
      requesterUserId,
      requesterUserId,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES (?, 'Center Agent', ?, 'agent', 0, 'active', ?, ?, ?,
          'auth_bootstrap', 'center_agent', ?, ?)
      `
    ).bind(
      centerAgentProfileId,
      `center-agent-${suffix}`,
      organizationId,
      requesterUserId,
      requesterUserId,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      "INSERT INTO center_agent_designations (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES (?, ?, NULL, ?, ?)"
    ).bind(organizationId, centerAgentProfileId, requesterUserId, nowMs),
  ]);
  return {
    centerAgentProfileId,
    organizationId,
    requesterProfileId,
    requesterUserId,
    suffix,
    targetProfileId,
    targetUserId,
  };
}

async function seedResumeSession(
  fixture: Awaited<ReturnType<typeof seedFixture>>
) {
  const nowMs = Date.now();
  const projectId = `project-${fixture.suffix}`;
  const deviceId = `device-${fixture.suffix}`;
  const computerId = `computer-${fixture.suffix}`;
  const nativeSessionId = `native-session-${fixture.suffix}`;
  const sourceScopeKey = `source-${fixture.suffix}`;
  const localConnectionId = `sha256:${"a".repeat(64)}`;
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `INSERT INTO projects (
        id, organization_id, name, slug, created_by_user_id,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'OpenMeld', ?, ?, ?, ?)`
    ).bind(
      projectId,
      fixture.organizationId,
      `openmeld-${fixture.suffix}`,
      fixture.targetUserId,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      `INSERT INTO openMeldDaemon_owned_devices (
        owner_user_id, device_id, connected_computer_id, user_display_name,
        first_seen_at_ms, last_observed_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'Target Mac', ?, ?, ?)`
    ).bind(fixture.targetUserId, deviceId, computerId, nowMs, nowMs, nowMs),
    env.OPENMELD_DB.prepare(
      `INSERT INTO agent_activity_session_inventory_sources (
        source_scope_key, organization_id, owner_user_id, project_id,
        device_id, connected_computer_id, local_connection_id,
        agent_controller_ref, provider, state, current_reconciliation_id,
        next_page_index, problem_code, last_attempt_at_ms,
        last_complete_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'builtin:codex', 'codex', 'current',
        ?, 1, NULL, ?, ?, ?)`
    ).bind(
      sourceScopeKey,
      fixture.organizationId,
      fixture.targetUserId,
      projectId,
      deviceId,
      computerId,
      localConnectionId,
      `reconciliation-${fixture.suffix}`,
      nowMs,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      `INSERT INTO agent_activity_session_inventory (
        id, organization_id, owner_user_id, agent_controller_ref,
        native_session_id, project_id, device_id, connected_computer_id,
        local_connection_id, source_scope_key, provider, native_session_title,
        status, last_active_at_ms, started_at_ms, origin, can_resume, can_fork,
        visible, source_reconciliation_id, observed_at_ms, published_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, 'builtin:codex', ?, ?, ?, ?, ?, ?, 'codex',
        'Existing release work', 'idle', ?, ?, 'local', 1, 1, 1, ?, ?, ?, ?)`
    ).bind(
      `inventory-${fixture.suffix}`,
      fixture.organizationId,
      fixture.targetUserId,
      nativeSessionId,
      projectId,
      deviceId,
      computerId,
      localConnectionId,
      sourceScopeKey,
      nowMs,
      nowMs - 60_000,
      `reconciliation-${fixture.suffix}`,
      nowMs,
      nowMs,
      nowMs
    ),
  ]);
  return { computerId, deviceId, nativeSessionId, projectId };
}
