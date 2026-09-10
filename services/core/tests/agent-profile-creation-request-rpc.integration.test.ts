import { createExecutionContext, env } from "cloudflare:test";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type { RuntimeTransportLookupOwnerServiceResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";

import { handleAgentProfileCreationMessage } from "../src/agent-profile-creation-request/agent-profile-creation-execution";
import { recoverAgentProfileCreationRequests } from "../src/agent-profile-creation-request/agent-profile-creation-request-recovery";
import {
  executeAgentProfileCreationRequest,
  rpcRetryAgentProfileCreationRequest as retryRequest,
  rpcListAgentProfileCreationRequests,
  rpcCenterAgentCreateAgentProfileCreationRequest as submitCenterAgentRequest,
  rpcCreateAgentProfileCreationRequest as submitRequest,
} from "../src/agent-profile-creation-request/agent-profile-creation-request-rpc";
import type { CoreBindings } from "../src/lib/bindings";
// biome-ignore lint/performance/noNamespaceImport: Vitest needs the module object to replace this dependency at the RPC boundary.
import * as rpcMethods from "../src/rpc/methods";
import { handleCoreQueueBatch } from "../src/shared/queue/core-queue-router";
// biome-ignore lint/performance/noNamespaceImport: Vitest needs the module object to replace this dependency at the RPC boundary.
import * as currentDeviceTargetService from "../src/start/application/current-device-target-service";

// These integration scenarios cover the complete admission + execution path.
// Production delivery invokes the same executor from the Core queue consumer.
async function rpcCreateAgentProfileCreationRequest(
  ...args: Parameters<typeof submitRequest>
) {
  const result = await submitRequest(...args);
  return {
    ...result,
    request: await executeAgentProfileCreationRequest(args[0], result.request),
  };
}
async function rpcRetryAgentProfileCreationRequest(
  ...args: Parameters<typeof retryRequest>
) {
  const result = await retryRequest(...args);
  return {
    ...result,
    request: await executeAgentProfileCreationRequest(args[0], result.request),
  };
}

describe("Agent Profile creation request RPC", () => {
  it("recovers a durable accepted request after notification loss and executes duplicate deliveries only once", async () => {
    const fixture = await seedFixture();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue temporarily unavailable"))
      .mockResolvedValue(undefined);
    const createAgentProfileInOrganization = vi.fn().mockResolvedValue({
      ok: true,
      profile: { openMeldProfileId: "agt_durable_creation" },
    });
    const bindings = {
      OPENMELD_DB: env.OPENMELD_DB,
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
    } as unknown as CoreBindings;
    const command = {
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      idempotencyKey: `lost-ack-${fixture.suffix}`,
      organizationId: fixture.organizationId,
      profileName: "Durable Agent",
      sessionStrategy: "new" as const,
      source: "cli" as const,
      targetOwnerUserId: fixture.requesterUserId,
    };
    const accepted = await submitRequest(bindings, command);
    expect(accepted.request.status).toBe("approved");
    expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
    const recovered = await rpcListAgentProfileCreationRequests(bindings, {
      context: command.context,
      organizationId: command.organizationId,
      idempotencyKey: command.idempotencyKey,
    });
    expect(recovered).toMatchObject({
      matchedIdempotencyKey: command.idempotencyKey,
      requests: [{ id: accepted.request.id, status: "approved" }],
    });
    await recoverAgentProfileCreationRequests({
      db: env.OPENMELD_DB,
      env: bindings,
      nowMs: Date.now(),
    });
    const body = send.mock.calls.findLast(
      ([message]) => message.requestId === accepted.request.id
    )?.[0];
    expect(body).toEqual({
      kind: "agent_profile_creation",
      v: 1,
      requestId: accepted.request.id,
      organizationId: fixture.organizationId,
    });
    const message: Message<unknown> = {
      id: "delivery-1",
      attempts: 1,
      timestamp: new Date(),
      body,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await handleCoreQueueBatch({
      env: bindings,
      ctx: createExecutionContext(),
      batch: {
        queue: "openmeld-daemon-dispatch",
        messages: [message],
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      },
    });
    expect(
      await handleAgentProfileCreationMessage({ env: bindings, message })
    ).toBe(true);
    expect(createAgentProfileInOrganization).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledTimes(2);
    expect(message.retry).not.toHaveBeenCalled();
    const replay = await submitRequest(bindings, command);
    expect(replay).toMatchObject({
      replayed: true,
      request: {
        id: accepted.request.id,
        status: "completed",
        createdAgentProfileId: "agt_durable_creation",
      },
    });
  });

  it("rechecks Organization membership after accepting a request and before creating identity", async () => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganization = vi.fn();
    const bindings = {
      OPENMELD_DB: env.OPENMELD_DB,
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send: vi.fn() },
    } as unknown as CoreBindings;
    const accepted = await submitRequest(bindings, {
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      idempotencyKey: `revoked-${fixture.suffix}`,
      organizationId: fixture.organizationId,
      profileName: "Revoked Agent",
      sessionStrategy: "new",
      source: "cli",
      targetOwnerUserId: fixture.requesterUserId,
    });
    await env.OPENMELD_DB.prepare(
      "DELETE FROM members WHERE organization_id = ? AND user_id = ?"
    )
      .bind(fixture.organizationId, fixture.requesterUserId)
      .run();
    expect(
      await executeAgentProfileCreationRequest(bindings, accepted.request)
    ).toMatchObject({ status: "failed", createdAgentProfileId: null });
    expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
  });

  it("retries setup for the committed Profile without creating another identity", async () => {
    const fixture = await seedFixture();
    const createdAgentProfileId = "agt_33333333-3333-4333-8333-333333333333";
    const createAgentProfileInOrganization = vi.fn().mockResolvedValue({
      ok: true,
      profile: { openMeldProfileId: createdAgentProfileId },
    });
    const addProfileToSpace = vi
      .spyOn(rpcMethods, "rpcAddOrganizationDirectoryProfilesToSpace")
      .mockRejectedValueOnce(new Error("The Space is temporarily unavailable."))
      .mockResolvedValueOnce({
        addedMemberIds: [createdAgentProfileId],
        alreadyMemberIds: [],
        items: [],
      });
    const bindings = {
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DB: env.OPENMELD_DB,
    } as unknown as CoreBindings;

    try {
      const first = await rpcCreateAgentProfileCreationRequest(bindings, {
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: `setup-retry-${fixture.suffix}`,
        organizationId: fixture.organizationId,
        profileName: "Release Reviewer",
        requestedSpaceId: `space-${fixture.suffix}`,
        sessionStrategy: "new",
        source: "cli",
        targetOwnerUserId: fixture.requesterUserId,
      });

      expect(first.request).toMatchObject({
        createdAgentProfileId,
        status: "failed",
        statusReason: "profile_created",
      });

      const retried = await rpcRetryAgentProfileCreationRequest(bindings, {
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        organizationId: fixture.organizationId,
        requestId: first.request.id,
      });

      expect(retried.request).toMatchObject({
        createdAgentProfileId,
        status: "completed",
        statusReason: "profile_created",
      });
      expect(createAgentProfileInOrganization).toHaveBeenCalledTimes(1);
      expect(addProfileToSpace).toHaveBeenCalledTimes(2);
    } finally {
      addProfileToSpace.mockRestore();
    }
  });

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

  it("blocks an explicitly unavailable model before every creation entry reaches Auth", async () => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganization = vi.fn().mockResolvedValue({
      ok: true,
      profile: {
        openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
      },
    });
    const listLocalRuntimes = vi
      .spyOn(currentDeviceTargetService, "listLocalRuntimesUseCase")
      .mockResolvedValue(createModelGuardLocalRuntimes());
    // Model validation requires a live, compatible target, not merely a saved
    // ready report. This transport fixture follows the shared wire contract.
    const ownerService: RuntimeTransportLookupOwnerServiceResponse = {
      online: true,
      sessions: [
        {
          daemonSessionId: "model-guard-session",
          capabilities: {},
          deviceId: "device-model-guard",
          lane: "dev-local",
          connectionGeneration: 1,
          lastHeartbeatMs: Date.now(),
          serviceVersion: "999.0.0",
          executionCompatibility: {
            status: "compatible",
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
          },
        },
      ],
    };
    const bindings = {
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DB: env.OPENMELD_DB,
      OPENMELD_RUNTIME_TRANSPORT: {
        idFromName: (name: string) => {
          expect(name).toBe(fixture.requesterUserId);
          return name;
        },
        get: () => ({
          fetch: (url: string) => {
            expect(new URL(url).pathname).toBe("/lookup-owner-service");
            return Promise.resolve(Response.json(ownerService));
          },
        }),
      },
    } as unknown as CoreBindings;

    try {
      const result = await rpcCreateAgentProfileCreationRequest(bindings, {
        configuration: {
          agentControllerCollaborationMode: null,
          agentControllerPermissionMode: null,
          agentControllerRef: "builtin:codex",
          authorizeForOrganization: true,
          defaultProjectId: null,
          modelId: "gpt-5.6-sol",
          openCodePermission: null,
          reasoningLevel: "high",
          targetComputerId: "device-model-guard",
        },
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: `model-guard-${fixture.suffix}`,
        organizationId: fixture.organizationId,
        profileName: "Model Guard Reviewer",
        sessionStrategy: "new",
        source: "web",
        targetOwnerUserId: fixture.requesterUserId,
      });

      expect(result.request).toMatchObject({
        createdAgentProfileId: null,
        failureMessage: expect.stringContaining(
          "gpt-5.6-sol isn't available for Codex on Model Guard Mac"
        ),
        status: "failed",
      });
      expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
      expect(listLocalRuntimes).toHaveBeenCalled();
    } finally {
      listLocalRuntimes.mockRestore();
    }
  });

  it("rejects teammate creation through both public and represented-member entry points", async () => {
    const fixture = await seedFixture();
    const bindings = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;
    const intent = {
      profileName: "Held Agent",
      sessionStrategy: "new" as const,
      targetOwnerUserId: fixture.targetUserId,
    };
    await expect(
      submitRequest(bindings, {
        ...intent,
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: fixture.suffix,
        organizationId: fixture.organizationId,
        source: "cli",
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "agent_profile_creation_request.forbidden",
    });
    await expect(
      submitCenterAgentRequest(bindings, {
        ...intent,
        context: {
          activeOrganizationId: fixture.organizationId,
          actorContext: {
            callerPrincipalId: fixture.centerAgentProfileId,
            openMeldProfileId: fixture.centerAgentProfileId,
            profileKind: "agent",
            profileName: "Center Agent",
            requestId: fixture.suffix,
          },
        },
        onBehalfOf: { profileId: fixture.requesterProfileId },
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "agent_profile_creation_request.forbidden",
    });
    const rows = await env.OPENMELD_DB.prepare(
      "SELECT count(*) AS count FROM agent_profile_creation_requests WHERE organization_id = ?"
    )
      .bind(fixture.organizationId)
      .first<{ count: number }>();
    expect(rows?.count).toBe(0);
    // The same Center Agent attribution may still create for its represented
    // member. The launch hold must not confuse Agent identity with ownership.
    const own = await submitCenterAgentRequest(bindings, {
      ...intent,
      targetOwnerUserId: fixture.requesterUserId,
      context: {
        activeOrganizationId: fixture.organizationId,
        actorContext: {
          callerPrincipalId: fixture.centerAgentProfileId,
          openMeldProfileId: fixture.centerAgentProfileId,
          profileKind: "agent",
          profileName: "Center Agent",
          requestId: `own-${fixture.suffix}`,
        },
      },
      onBehalfOf: { profileId: fixture.requesterProfileId },
    });
    expect(own.request).toMatchObject({
      requesterUserId: fixture.requesterUserId,
      targetOwnerUserId: fixture.requesterUserId,
      status: "approved",
    });
  });

  it("accepts a Resume request for a current matching Session", async () => {
    const fixture = await seedFixture();
    const session = await seedResumeSession(fixture);
    const bindings = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;

    const created = await submitRequest(bindings, {
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
      context: contextFor(fixture.targetUserId, fixture.targetProfileId),
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
      status: "approved",
      targetOwnerUserId: fixture.targetUserId,
    });
    await env.OPENMELD_DB.prepare(
      "DELETE FROM agent_activity_session_inventory WHERE id = ?"
    )
      .bind(`inventory-${fixture.suffix}`)
      .run();
    const replayed = await submitRequest(bindings, {
      ...created.request,
      context: contextFor(fixture.targetUserId, fixture.targetProfileId),
      idempotencyKey: `resume-${fixture.suffix}`,
    });
    expect(replayed).toMatchObject({
      replayed: true,
      request: { id: created.request.id },
    });
  });

  it("accepts a Fork request addressed to the Session's public Computer", async () => {
    const fixture = await seedFixture();
    const session = await seedResumeSession(fixture);
    const bindings = { OPENMELD_DB: env.OPENMELD_DB } as CoreBindings;

    const created = await submitRequest(bindings, {
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
      context: contextFor(fixture.targetUserId, fixture.targetProfileId),
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
      status: "approved",
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
        context: contextFor(fixture.targetUserId, fixture.targetProfileId),
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

function createModelGuardLocalRuntimes(): Awaited<
  ReturnType<typeof currentDeviceTargetService.listLocalRuntimesUseCase>
> {
  return {
    currentConnectedComputerId: null,
    currentDeviceId: "device-model-guard",
    currentRuntimeLane: "dev-local",
    legacyDeviceEvidence: [],
    localRuntimes: [
      {
        deviceDisplayName: "Model Guard Mac",
        deviceDisplayNameSource: "observed",
        deviceId: "device-model-guard",
        deviceType: "laptop",
        executionTargets: [
          {
            capabilities: [
              {
                agentControllerInterface: {
                  agentControllerRef: "builtin:codex",
                  auth: { status: "authenticated" },
                  capabilities: {
                    approvals: true,
                    cancel: true,
                    interrupt: true,
                    modelSelection: true,
                    nativeEventStream: true,
                    permissionModes: true,
                    structuredUserInput: true,
                  },
                  checkedAt: "2026-08-27T00:00:00.000Z",
                  controllerId: "codex",
                  displayName: "Codex",
                  launch: {
                    argsPrefix: [],
                    commandPath: "/Applications/Codex.app/Contents/MacOS/Codex",
                    installChoiceCount: 1,
                    status: "ready",
                  },
                  message: null,
                  models: [{ displayName: "GPT-5.6 Luna", id: "gpt-5.6-luna" }],
                  nativeInterface: "codex-app-server",
                  schemaVersion: 1,
                  skills: [],
                  status: "ready",
                  version: "999.0.0",
                },
                agentControllerRef: "builtin:codex",
                enabled: true,
                reasonCodes: [],
                status: "ready",
              },
            ],
            deviceId: "device-model-guard",
            isCurrent: true,
            lastObservedAtMs: 1_788_000_000_000,
            localAgentCatalog: {
              detectedNotSupportedYet: 0,
              detectedSupported: 0,
              entries: [],
              needsChoice: 0,
              needsRepair: 0,
              notDetected: 0,
              totalBuiltins: 0,
            },
            localAgentControl: {
              refreshCatalog: true,
              setEnabled: true,
              setProfileWorkspace: true,
            },
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime-model-guard",
            },
            reasonCodes: [],
            runtimeLane: "dev-local",
            status: "ready",
            userFacingCommand: "openmeld-dev",
          },
        ],
        firstSeenAtMs: 1_787_999_900_000,
        isCurrent: true,
        lastObservedAtMs: 1_788_000_000_000,
        osVersion: "15.6",
        platformFamily: "macOS",
      },
    ],
  };
}

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
      null,
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
