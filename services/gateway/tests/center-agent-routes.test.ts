import { describe, expect, it, vi } from "vitest";
import { createCoreRpcHttpError } from "../../core/src/rpc/errors";
import app from "../src/index";

const AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

type CoreRpcMock = {
  beginLarkPlatformRegistration: ReturnType<typeof vi.fn>;
  centerAgentCreateAgentProfile: ReturnType<typeof vi.fn>;
  connectCenterAgentSlackWorkspace: ReturnType<typeof vi.fn>;
  createCenterAgentContextLoadReceipt: ReturnType<typeof vi.fn>;
  createCenterAgentContextManifest: ReturnType<typeof vi.fn>;
  designateCenterAgent: ReturnType<typeof vi.fn>;
  disconnectLarkPlatformRegistration: ReturnType<typeof vi.fn>;
  disconnectMessageChannelIdentityLink: ReturnType<typeof vi.fn>;
  getCenterAgentModel: ReturnType<typeof vi.fn>;
  getCenterAgentDirectMessageSpaceProjection: ReturnType<typeof vi.fn>;
  listCenterAgentSessions: ReturnType<typeof vi.fn>;
  getCenterAgentOperatingState: ReturnType<typeof vi.fn>;
  listCenterAgentAuditJournal: ReturnType<typeof vi.fn>;
  listActiveLarkPlatformRegistrations: ReturnType<typeof vi.fn>;
  listMessageChannelConnections: ReturnType<typeof vi.fn>;
  openCenterAgentDirectMessageSpace: ReturnType<typeof vi.fn>;
  pollLarkPlatformRegistration: ReturnType<typeof vi.fn>;
  requestMessageChannelSetup: ReturnType<typeof vi.fn>;
  updateCenterAgentOperatingState: ReturnType<typeof vi.fn>;
  updateCenterAgentModel: ReturnType<typeof vi.fn>;
};

type AuthRpcMock = {
  ensureManagedAgentProfile: ReturnType<typeof vi.fn>;
  resolveProfile: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
  resolveRequestAuthWithProfile: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

function makeEnv(input?: {
  authOverrides?: Partial<AuthRpcMock>;
  coreOverrides?: Partial<CoreRpcMock>;
}) {
  const coreRpc: CoreRpcMock = {
    beginLarkPlatformRegistration: vi.fn(async () =>
      registrationResponse("pending_registration")
    ),
    centerAgentCreateAgentProfile: vi.fn(async () => ({
      attribution: {
        actorProfileId: AGENT_PROFILE_ID,
        onBehalfOf: null,
      },
      organizationId: "org-1",
      profile: {
        createdAt: "2026-07-06T00:00:00.000Z",
        createdByUserId: "owner-1",
        creatorProfileId: AGENT_PROFILE_ID,
        isDefault: false,
        lastUsedAt: null,
        managedRole: null,
        ownerUserId: "owner-1",
        profileHandle: "release-agent",
        profileKind: "agent",
        profileName: "Release Agent",
        source: "user_created",
        status: "active",
        updatedAt: "2026-07-06T00:00:00.000Z",
        openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
      },
      resource: {
        id: "agt_33333333-3333-4333-8333-333333333333",
        type: "agent_profile",
      },
    })),
    connectCenterAgentSlackWorkspace: vi.fn(async () => ({
      slackConnection: {
        connectedAt: "2026-07-09T00:00:00.000Z",
        slackTeamId: "T123",
        slackTeamName: "Acme Slack",
      },
    })),
    createCenterAgentContextLoadReceipt: vi.fn(async (input) =>
      centerAgentContextLoadReceiptResponse({
        client: input.source.client,
        manifestId: input.manifestId,
      })
    ),
    createCenterAgentContextManifest: vi.fn(async (input) =>
      centerAgentContextManifestResponse(input.source)
    ),
    designateCenterAgent: vi.fn(async () => ({
      designation: {
        agentProfileId: AGENT_PROFILE_ID,
        createdAt: "2026-07-06T00:00:00.000Z",
        designatedBy: "owner-1",
        duty: null,
        organizationId: "org-1",
      },
      organizationId: "org-1",
      status: "designated",
    })),
    disconnectLarkPlatformRegistration: vi.fn(async () => ({
      availableLarkPlatformProviders: ["lark", "feishu"],
      connections: [],
      organizationId: "org-1",
    })),
    disconnectMessageChannelIdentityLink: vi.fn(async () => ({
      availableLarkPlatformProviders: ["lark", "feishu"],
      connections: [],
      identityLinks: [],
      organizationId: "org-1",
    })),
    getCenterAgentModel: vi.fn(async () => centerAgentModelConfiguration()),
    listCenterAgentSessions: vi.fn(async () => ({
      generatedAt: "2026-09-06T00:00:00.000Z",
      organizationId: "org-1",
      sessions: [],
      nextCursor: null,
    })),
    getCenterAgentDirectMessageSpaceProjection: vi.fn(async () => ({
      generatedAt: "2026-09-06T00:00:00.000Z",
      organizationId: "org-1",
      projection: null,
    })),
    getCenterAgentOperatingState: vi.fn(async () => ({
      canChangeOperatingState: true,
      operatingState: "active",
      organizationId: "org-1",
      pausedAt: null,
    })),
    listCenterAgentAuditJournal: vi.fn(async () => ({
      entries: [
        {
          action: "post_slack_channel_message",
          actorProfileId: AGENT_PROFILE_ID,
          createdAt: "2026-07-14T00:00:00.000Z",
          id: "audit-1",
          onBehalfOf: null,
          organizationId: "org-1",
          resource: { id: "C123", type: "slack_channel" },
        },
      ],
      organizationId: "org-1",
    })),
    listActiveLarkPlatformRegistrations: vi.fn(async () => ({
      organizationId: "org-1",
      registrations: [
        {
          canResume: true,
          expiresAt: "2026-07-18T09:00:00.000Z",
          id: "attempt-1",
          nextPollAt: "2026-07-18T08:00:05.000Z",
          provider: "lark",
          reasonCode: null,
          status: "pending_registration",
        },
      ],
    })),
    listMessageChannelConnections: vi.fn(async () => ({
      availableLarkPlatformProviders: ["lark", "feishu"],
      connections: [
        {
          externalAccountId: "T123",
          externalAccountName: "Acme Slack",
          grantedCapabilityGroups: [],
          id: "slack:T123",
          lastVerifiedAt: null,
          permissionBundleVersion: null,
          provider: "slack",
          reasonCode: null,
          status: "connected",
          transport: "webhook",
        },
        {
          externalAccountId: "tenant_lark_1",
          externalAccountName: "Center Agent",
          grantedCapabilityGroups: ["messages", "cards"],
          id: "connection_lark_1",
          lastVerifiedAt: "2026-07-18T00:00:00.000Z",
          permissionBundleVersion: "lark-channel-v1",
          provider: "lark",
          reasonCode: null,
          status: "connected",
          transport: "webhook",
        },
      ],
      identityLinks: [],
      organizationId: "org-1",
    })),
    openCenterAgentDirectMessageSpace: vi.fn(async () => ({
      centerAgentProfileId: AGENT_PROFILE_ID,
      created: true,
      memberProfileId: HUMAN_PROFILE_ID,
      organizationId: "org-1",
      spaceId: "a".repeat(64),
    })),
    pollLarkPlatformRegistration: vi.fn(async () =>
      registrationResponse("connected")
    ),
    requestMessageChannelSetup: vi.fn(async () => ({
      organizationId: "org-1",
      provider: "slack",
      recipientCount: 2,
      requestId: "request-1",
      status: "created",
    })),
    updateCenterAgentOperatingState: vi.fn(async () => ({
      affectedTaskCount: 2,
      canChangeOperatingState: true,
      changed: true,
      operatingState: "paused",
      organizationId: "org-1",
      pausedAt: "2026-07-29T00:00:00.000Z",
    })),
    updateCenterAgentModel: vi.fn(async () => ({
      ...centerAgentModelConfiguration(),
      changed: true,
      configurationRevision: 4,
      effectiveModel: {
        availability: "available",
        displayName: "DeepSeek V4 Flash",
        modelId: "deepseek/deepseek-v4-flash",
        supportsImageInput: false,
      },
      preference: {
        kind: "selected_model",
        modelId: "deepseek/deepseek-v4-flash",
      },
    })),
    ...(input?.coreOverrides ?? {}),
  };

  const authRpc: AuthRpcMock = {
    ensureManagedAgentProfile: vi.fn(async () => ({
      ok: true,
      profile: {
        openMeldProfileId: AGENT_PROFILE_ID,
      },
    })),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      ok: true,
      claims: {
        activeOrganizationId: "org-1",
        authMethod: "session",
        authenticated: true,
        ownerIds: ["owner-1"],
        requestId: "req-center-agent-route",
      },
      profile: {
        ok: true,
        resolvedProfile: {
          openMeldProfileId: HUMAN_PROFILE_ID,
          ownerUserId: "owner-1",
          profileKind: "human",
          profileName: "Mira",
        },
      },
    })),
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        activeOrganizationId: "org-1",
        authMethod: "session",
        authenticated: true,
        ownerIds: ["owner-1"],
        requestId: "req-center-agent-route",
      },
    })),
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: HUMAN_PROFILE_ID,
        ownerUserId: "owner-1",
        profileKind: "human",
        profileName: "Mira",
      },
    })),
    ...(input?.authOverrides ?? {}),
  };

  return {
    authRpc,
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

function centerAgentModelConfiguration() {
  return {
    canManage: true,
    choices: [
      {
        displayName: "OpenMeld default",
        effectiveModelDisplayName: "Grok 4.5",
        preference: { kind: "system_default" as const },
        supportsImageInput: true,
      },
      {
        displayName: "DeepSeek V4 Flash",
        effectiveModelDisplayName: "DeepSeek V4 Flash",
        preference: {
          kind: "selected_model" as const,
          modelId: "deepseek/deepseek-v4-flash",
        },
        supportsImageInput: false,
      },
    ],
    configurationRevision: 3,
    effectiveModel: {
      availability: "available" as const,
      displayName: "Grok 4.5",
      modelId: "x-ai/grok-4.5",
      supportsImageInput: true,
    },
    organizationId: "org-1",
    preference: { kind: "system_default" as const },
  };
}

describe("Center Agent routes", () => {
  it("returns the canonical multi-provider Channels projection", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/organizations/current/message-channels"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connections: [
        { provider: "slack", status: "connected" },
        { provider: "lark", status: "connected" },
      ],
      identityLinks: [],
      organizationId: "org-1",
    });
    expect(coreRpc.listMessageChannelConnections).toHaveBeenCalledWith({
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "owner-1",
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
    });
  });

  it("disconnects one Message Channel account identity", async () => {
    const { coreRpc, env } = makeEnv();
    const identityLinkId = `channel_identity_${"a".repeat(64)}`;

    const response = await app.fetch(
      new Request(
        `http://local/v1/organizations/current/message-channels/identity-links/${identityLinkId}`,
        { method: "DELETE" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.disconnectMessageChannelIdentityLink).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      identityLinkId,
    });
  });

  it("forwards a member's Message Channel setup request", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/setup-requests",
        {
          body: JSON.stringify({ provider: "slack" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organizationId: "org-1",
      provider: "slack",
      status: "created",
    });
    expect(coreRpc.requestMessageChannelSetup).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      provider: "slack",
    });
  });

  it("returns active Lark setup without exposing registration secrets", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/registrations"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organizationId: "org-1",
      registrations: [
        {
          canResume: true,
          expiresAt: "2026-07-18T09:00:00.000Z",
          id: "attempt-1",
          nextPollAt: "2026-07-18T08:00:05.000Z",
          provider: "lark",
          reasonCode: null,
          status: "pending_registration",
        },
      ],
    });
    expect(coreRpc.listActiveLarkPlatformRegistrations).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
    });
  });

  it("forwards split Lark registration and disconnect operations", async () => {
    const { coreRpc, env } = makeEnv();

    const beginResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/lark/registration-attempts",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(beginResponse.status).toBe(200);
    await expect(beginResponse.json()).resolves.toMatchObject({
      attempt: { id: "attempt-1", provider: "lark" },
    });
    expect(coreRpc.beginLarkPlatformRegistration).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      mode: "resume",
      provider: "lark",
    });

    const restartResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/lark/registration-attempts?mode=restart",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(restartResponse.status).toBe(200);
    expect(coreRpc.beginLarkPlatformRegistration).toHaveBeenLastCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      mode: "restart",
      provider: "lark",
    });

    const repairResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/lark/registration-attempts?mode=repair",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(repairResponse.status).toBe(200);
    expect(coreRpc.beginLarkPlatformRegistration).toHaveBeenLastCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      mode: "repair",
      provider: "lark",
    });

    const pollResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/lark/registration-attempts/attempt-1/poll",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(pollResponse.status).toBe(200);
    expect(coreRpc.pollLarkPlatformRegistration).toHaveBeenCalledWith({
      attemptId: "attempt-1",
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      provider: "lark",
    });

    const disconnectResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/lark",
        { method: "DELETE" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(disconnectResponse.status).toBe(200);
    expect(coreRpc.disconnectLarkPlatformRegistration).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      provider: "lark",
    });
  });

  it("rejects unsupported Message Channel providers before Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/teams/registration-attempts",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.beginLarkPlatformRegistration).not.toHaveBeenCalled();
  });

  it("rejects unsupported Lark registration modes before Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/message-channels/lark/registration-attempts?mode=replace",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.beginLarkPlatformRegistration).not.toHaveBeenCalled();
  });

  it("forwards the opt-in Center Agent audit action set", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/audit-journal?limit=25&actionSet=v3"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entries: [{ action: "post_slack_channel_message" }],
    });
    expect(coreRpc.listCenterAgentAuditJournal).toHaveBeenCalledWith({
      actionSet: "v3",
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      limit: 25,
    });
  });

  it("validates and forwards a Center Agent Context Manifest request", async () => {
    const { coreRpc, env } = makeEnv();
    const source = {
      client: "codex",
      kind: "local_agent" as const,
      sessionId: "thread-private",
    };
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/context-manifests",
        {
          body: JSON.stringify({
            limit: 10,
            maxContextTokens: 2048,
            source,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      budget: { requestedTokens: 2048 },
      request: { source },
      view: "messages",
    });
    expect(coreRpc.createCenterAgentContextManifest).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      limit: 10,
      maxContextTokens: 2048,
      source,
      view: "messages",
    });
  });

  it("validates and forwards an exact Center Agent Context Load Receipt", async () => {
    const { coreRpc, env } = makeEnv();
    const manifestId =
      "center_agent_context_manifest_11111111-1111-4111-8111-111111111111";
    const source = {
      client: "codex",
      kind: "local_agent" as const,
      sessionId: "thread-private",
    };
    const response = await app.fetch(
      new Request(
        `http://local/v1/organizations/current/center-agent/context-manifests/${manifestId}/load-receipt`,
        {
          body: JSON.stringify({
            selection: { kind: "all_manifest_entries" },
            source,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipt: { client: "codex", manifestId, status: "loaded" },
    });
    expect(coreRpc.createCenterAgentContextLoadReceipt).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      manifestId,
      selection: { kind: "all_manifest_entries" },
      source,
    });
  });

  it("passes the requested designation runtime through to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/designation",
        {
          body: JSON.stringify({
            agentProfileId: AGENT_PROFILE_ID,
            runtime: "remote_agent",
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      designation: { agentProfileId: AGENT_PROFILE_ID },
      organizationId: "org-1",
      status: "designated",
    });
    expect(coreRpc.designateCenterAgent).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      runtime: "remote_agent",
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "owner-1",
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
    });
  });

  it("reads and updates the creator-only Center Agent operating state", async () => {
    const { coreRpc, env } = makeEnv();
    const readResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/operating-state"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      canChangeOperatingState: true,
      operatingState: "active",
    });

    const updateResponse = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/operating-state",
        {
          body: JSON.stringify({ operatingState: "paused" }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      affectedTaskCount: 2,
      changed: true,
      operatingState: "paused",
    });
    expect(coreRpc.getCenterAgentOperatingState).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
    });
    expect(coreRpc.updateCenterAgentOperatingState).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      operatingState: "paused",
    });
  });

  it("reads and updates the Center Agent model through strict contracts", async () => {
    const { coreRpc, env } = makeEnv();
    const readResponse = await app.fetch(
      new Request("http://local/v1/organizations/current/center-agent/model"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      canManage: true,
      effectiveModel: { displayName: "Grok 4.5" },
      preference: { kind: "system_default" },
    });

    const updateResponse = await app.fetch(
      new Request("http://local/v1/organizations/current/center-agent/model", {
        body: JSON.stringify({
          expectedConfigurationRevision: 3,
          preference: {
            kind: "selected_model",
            modelId: "deepseek/deepseek-v4-flash",
          },
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      changed: true,
      effectiveModel: { displayName: "DeepSeek V4 Flash" },
    });
    expect(coreRpc.updateCenterAgentModel).toHaveBeenCalledWith({
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      expectedConfigurationRevision: 3,
      preference: {
        kind: "selected_model",
        modelId: "deepseek/deepseek-v4-flash",
      },
    });
  });

  it("ensures the managed Center Agent profile when Web omits an agentProfileId", async () => {
    const { authRpc, coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/designation",
        {
          body: JSON.stringify({ runtime: "remote_agent" }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(authRpc.ensureManagedAgentProfile).toHaveBeenCalledWith({
      creatorProfileId: HUMAN_PROFILE_ID,
      headers: expect.any(Object),
      managedRole: "center_agent",
      profileName: "Center Agent",
    });
    expect(coreRpc.designateCenterAgent).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      runtime: "remote_agent",
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "owner-1",
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
    });
  });

  it("forwards session pagination with authenticated organization context and rejects unbounded limits", async () => {
    const { coreRpc, env } = makeEnv();
    const url = "http://local/v1/organizations/current/center-agent/sessions";
    const response = await app.fetch(
      new Request(`${url}?limit=2&cursor=page-token`),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(coreRpc.listCenterAgentSessions).toHaveBeenCalledWith({
      limit: 2,
      cursor: "page-token",
      context: expect.objectContaining({ activeOrganizationId: "org-1" }),
    });
    const invalid = await app.fetch(
      new Request(`${url}?limit=101`),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(invalid.status).toBe(400);
    expect(coreRpc.listCenterAgentSessions).toHaveBeenCalledTimes(1);
  });

  it("creates sessions with the supplied idempotency key and authenticated actor", async () => {
    const { coreRpc, env } = makeEnv();
    const creationId = "2e2c7084-bcaf-4321-8fad-cb4bf416e286";
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/sessions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ creationId }),
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(coreRpc.openCenterAgentDirectMessageSpace).toHaveBeenCalledWith({
      sessionCreationId: creationId,
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
    });
  });

  it("rejects session bodies that try to supply another actor", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/sessions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            creationId: "2e2c7084-bcaf-4321-8fad-cb4bf416e286",
            memberProfileId: "someone-else",
          }),
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(400);
    expect(coreRpc.openCenterAgentDirectMessageSpace).not.toHaveBeenCalled();
  });

  it("passes an exact session selector to Core without falling back to a default chat", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/sessions/exact-session"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ projection: null });
    expect(
      coreRpc.getCenterAgentDirectMessageSpaceProjection
    ).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "exact-session" })
    );
    expect(coreRpc.openCenterAgentDirectMessageSpace).not.toHaveBeenCalled();
  });

  it("opens the Center Agent DM without a Gateway-side designation fallback", async () => {
    const openCenterAgentDirectMessageSpace = vi.fn(() =>
      Promise.reject(
        createCoreRpcHttpError({
          code: "center_agent.designation_required",
          reason: "This Organization has no designated Center Agent.",
          status: 404,
        })
      )
    );
    const { authRpc, coreRpc, env } = makeEnv({
      coreOverrides: {
        openCenterAgentDirectMessageSpace,
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/dm-space",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "center_agent.dm_open_failed",
        upstreamCode: "center_agent.designation_required",
      },
    });
    expect(coreRpc.openCenterAgentDirectMessageSpace).toHaveBeenCalledWith({
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "owner-1",
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
    });
    expect(coreRpc.openCenterAgentDirectMessageSpace).toHaveBeenCalledTimes(1);
    expect(authRpc.ensureManagedAgentProfile).not.toHaveBeenCalled();
    expect(coreRpc.designateCenterAgent).not.toHaveBeenCalled();
  });

  it("creates Agent Profiles through Core so attribution and authorization stay centralized", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/agent-profiles",
        {
          body: JSON.stringify({ profileName: "Release Agent" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organizationId: "org-1",
      profile: { profileName: "Release Agent", profileKind: "agent" },
    });
    expect(coreRpc.centerAgentCreateAgentProfile).toHaveBeenCalledWith({
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "owner-1",
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
      profileName: "Release Agent",
    });
  });

  it("connects Slack workspaces through Core and preserves the workspace claim guard", async () => {
    const connectCenterAgentSlackWorkspace = vi.fn(() =>
      Promise.reject(
        createCoreRpcHttpError({
          code: "slack.workspace_already_bound",
          reason:
            "This Slack workspace is already connected to another Organization.",
          status: 409,
        })
      )
    );
    const { coreRpc, env } = makeEnv({
      coreOverrides: {
        connectCenterAgentSlackWorkspace,
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/slack-connection",
        {
          body: JSON.stringify({
            slackTeamId: "T123",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "slack.workspace_already_bound",
        message:
          "This Slack workspace is already connected to another Organization.",
      },
    });
    expect(coreRpc.connectCenterAgentSlackWorkspace).toHaveBeenCalledWith({
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "owner-1",
          openMeldProfileId: HUMAN_PROFILE_ID,
        }),
      }),
      slackTeamId: "T123",
    });
  });

  it("wraps DM open failures with a route classification and upstream code", async () => {
    const { coreRpc, env } = makeEnv({
      coreOverrides: {
        openCenterAgentDirectMessageSpace: vi.fn(() =>
          Promise.reject(
            createCoreRpcHttpError({
              code: "invalid_payload",
              reason:
                "invalid space id: OpenMeld couldn't resolve the durable object",
              status: 400,
            })
          )
        ),
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/center-agent/dm-space",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
        requestId?: string;
        upstreamCode?: string;
      };
      ok?: boolean;
    };
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: "center_agent.dm_open_failed",
        requestId: "req-center-agent-route",
        upstreamCode: "invalid_payload",
      },
    });
    expect(body.error?.message).toContain(
      "invalid space id: OpenMeld couldn't resolve the durable object"
    );
    expect(coreRpc.openCenterAgentDirectMessageSpace).toHaveBeenCalledWith({
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "owner-1",
          openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    });
  });
});

function registrationResponse(status: "connected" | "pending_registration") {
  const connected = status === "connected";
  return {
    attempt: {
      expiresAt: "2026-07-18T01:00:00.000Z",
      id: "attempt-1",
      nextPollAt: "2026-07-18T00:00:05.000Z",
      provider: "lark" as const,
      reasonCode: null,
      registrationUrl: connected
        ? null
        : "https://open.feishu.cn/page/launcher?user_code=REDACTED",
      status,
    },
    connection: connected
      ? {
          externalAccountId: "tenant_lark_1",
          externalAccountName: "OpenMeld Center Agent",
          grantedCapabilityGroups: ["conversation.text"],
          id: "connection_lark_1",
          lastVerifiedAt: "2026-07-18T00:00:00.000Z",
          permissionBundleVersion: "channel-only-2026-07-18",
          provider: "lark" as const,
          reasonCode: null,
          status: "connected" as const,
          transport: "webhook" as const,
        }
      : null,
    organizationId: "org-1",
  };
}

function centerAgentContextManifestResponse(source: {
  client: string;
  kind: "local_agent";
  sessionId?: string;
}) {
  const hash = `sha256:${"a".repeat(64)}`;
  return {
    authorization: {
      principal: "authenticated_member" as const,
      scope: "requester_private" as const,
    },
    availableViews: ["messages"] as const,
    budget: {
      estimateAlgorithm: "utf8_bytes_divided_by_3.v1" as const,
      estimatedTokens: 100,
      includedMessages: 1,
      requestedTokens: 2048,
      truncated: false,
      truncationReasons: [],
    },
    continuation: { cursor: null, hasMore: false },
    entries: [
      {
        author: {
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human" as const,
          profileName: "Felix",
        },
        content: {
          originalCharacterCount: 7,
          text: "Context",
          truncated: false,
          type: "text" as const,
        },
        materializedContentHash: hash,
        occurredAt: "2026-08-10T00:00:00.000Z",
        redactions: [],
        sourceRef: {
          id: "signal-1",
          type: "space_signal" as const,
          uri: "openmeld://spaces/space-1/signals/signal-1",
          version: hash,
        },
      },
    ],
    generatedAt: "2026-08-10T00:00:00.000Z",
    manifestId:
      "center_agent_context_manifest_11111111-1111-4111-8111-111111111111",
    provenance: {
      auditEntryId: "audit-1",
      contentProjection: "user_visible_space_signals" as const,
    },
    request: { source },
    schemaVersion: "center_agent_context_manifest.v1" as const,
    subject: {
      centerAgentProfileId: AGENT_PROFILE_ID,
      conversationId: "space-1",
      kind: "center_agent_conversation" as const,
      memberProfileId: HUMAN_PROFILE_ID,
      organizationId: "org-1",
    },
    view: "messages" as const,
  };
}

function centerAgentContextLoadReceiptResponse(input: {
  client: string;
  manifestId: string;
}) {
  return {
    authorization: {
      principal: "authenticated_member" as const,
      scope: "requester_private" as const,
    },
    provenance: { auditEntryId: "audit-load-1" },
    receipt: {
      client: input.client,
      estimatedTokens: 100,
      id: "center_agent_context_load_receipt_11111111-1111-4111-8111-111111111111",
      includedMessages: 1,
      manifestId: input.manifestId,
      selectedEntries: [
        {
          materializedContentHash: `sha256:${"a".repeat(64)}`,
          sourceRefId: "signal-1",
        },
      ],
      status: "loaded" as const,
    },
    recordedAt: "2026-08-10T00:00:01.000Z",
    schemaVersion: "center_agent_context_load_receipt.v1" as const,
  };
}
