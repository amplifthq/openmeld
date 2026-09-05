import { createSpaceMemberAgentExecutionReadiness } from "@openmeld/schemas/testing";
import { describe, expect, it, vi } from "vitest";
import { createCoreRpcHttpError } from "../../core/src/rpc/errors";
import app from "../src/index";

type CoreRpcMock = {
  disableAgentProfilePrimaryBinding: ReturnType<typeof vi.fn>;
  ensureAgentProfilePrimaryBinding: ReturnType<typeof vi.fn>;
  executeAgentProfileWorkRecovery: ReturnType<typeof vi.fn>;
  getAgentExecutionReadinessBatch: ReturnType<typeof vi.fn>;
  getAgentExecutionReadiness: ReturnType<typeof vi.fn>;
  getAgentProfileCreationDefaults: ReturnType<typeof vi.fn>;
  getAgentProfileControllerChangeEligibility: ReturnType<typeof vi.fn>;
  getAgentProfilePrimaryBinding: ReturnType<typeof vi.fn>;
  getCurrentAgentProfileSession: ReturnType<typeof vi.fn>;
  setAgentProfileCreationDefaults: ReturnType<typeof vi.fn>;
  updateAgentProfileDefaultProject: ReturnType<typeof vi.fn>;
  updateAgentProfilePrimaryBindingAgentControllerCollaborationMode: ReturnType<
    typeof vi.fn
  >;
  updateAgentProfilePrimaryBindingAgentControllerPermissionMode: ReturnType<
    typeof vi.fn
  >;
  updateAgentProfilePrimaryBindingModelSelection: ReturnType<typeof vi.fn>;
};

type AuthRpcMock = {
  resolveProfile: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
};

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
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
    disableAgentProfilePrimaryBinding: vi.fn(async () => ({
      agentProfileId: AGENT_PROFILE_ID,
      disabled: true,
      reasonCodes: ["agent_profile_binding.primary_binding_disabled"],
      status: "disabled",
    })),
    ensureAgentProfilePrimaryBinding: vi.fn(async () => ({
      binding: enabledBindingProjection(),
      grantsClaimSuccess: false,
      outcome: "created",
      reasonCodes: ["agent_profile_binding.command_eligible"],
      routable: true,
      status: "accepted",
    })),
    executeAgentProfileWorkRecovery: vi.fn(async (input) => ({
      action: input.body.action,
      status: "accepted",
    })),
    updateAgentProfilePrimaryBindingModelSelection: vi.fn(async () => ({
      binding: enabledBindingProjection({
        modelSelection: {
          modelId: "gpt-5.4-mini",
          reasoningLevel: "medium",
        },
      }),
      grantsClaimSuccess: false,
      outcome: "reused",
      reasonCodes: ["agent_profile_binding.command_eligible"],
      routable: true,
      status: "accepted",
    })),
    updateAgentProfilePrimaryBindingAgentControllerCollaborationMode: vi.fn(
      async () => ({
        binding: enabledBindingProjection({
          agentControllerCollaborationMode: "codex:plan",
        }),
        grantsClaimSuccess: false,
        outcome: "reused",
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "accepted",
      })
    ),
    updateAgentProfilePrimaryBindingAgentControllerPermissionMode: vi.fn(
      async () => ({
        binding: enabledBindingProjection({
          agentControllerPermissionMode: "codex:approveForMe",
        }),
        grantsClaimSuccess: false,
        outcome: "reused",
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "accepted",
      })
    ),
    getAgentProfilePrimaryBinding: vi.fn(async () => ({
      binding: enabledBindingProjection(),
      grantsClaimSuccess: false,
      status: "found",
    })),
    getCurrentAgentProfileSession: vi.fn(async () => ({
      currentOrganizationId: "org-1",
      profile: {
        profileId: AGENT_PROFILE_ID,
        profileName: "Codex",
        profileOrganizationId: "org-1",
      },
      sameOrganization: true,
      status: "found",
    })),
    getAgentProfileControllerChangeEligibility: vi.fn(async () => ({
      agentProfileId: AGENT_PROFILE_ID,
      reasonCode:
        "agent_profile_binding.controller_change_blocked_active_execution",
      status: "blocked",
    })),
    getAgentProfileCreationDefaults: vi.fn(async () => ({
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionMode: "codex:approveForMe",
      agentControllerRef: "builtin:codex",
      defaultProjectId: "project-1",
      modelId: "gpt-5.4-mini",
      openCodePermission: null,
      organizationId: "org-1",
      reasoningLevel: "high",
      updatedAt: "2026-08-18T12:00:00.000Z",
      userId: "owner-1",
    })),
    setAgentProfileCreationDefaults: vi.fn(async () => ({
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionMode: "codex:approveForMe",
      agentControllerRef: "builtin:codex",
      defaultProjectId: "project-1",
      modelId: "gpt-5.4-mini",
      openCodePermission: null,
      organizationId: "org-1",
      reasoningLevel: "high",
      updatedAt: "2026-08-18T12:00:00.000Z",
      userId: "owner-1",
    })),
    updateAgentProfileDefaultProject: vi.fn(async () => ({
      ok: true,
      profile: {
        avatarUrl: undefined,
        createdAt: "2026-07-14T00:00:00.000Z",
        createdByUserId: "owner-1",
        creatorProfileId: null,
        defaultProjectId: "project-1",
        isDefault: false,
        lastUsedAt: null,
        managedRole: null,
        ownerUserId: "owner-1",
        profileHandle: "research-agent",
        profileKind: "agent",
        profileName: "Research Agent",
        source: "cli_create",
        status: "active",
        updatedAt: "2026-07-14T00:00:00.000Z",
        openMeldProfileId: AGENT_PROFILE_ID,
      },
    })),
    getAgentExecutionReadiness: vi.fn(async () => ({
      agentExecutionReadiness: readyExecutionReadiness(),
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryActionPlan: {
        action: "none",
        target: null,
      },
      profileName: "Codex",
      agentWakeAvailability: readyAgentWakeAvailability(),
      agentWakeRouteRegistration: {
        status: "registered",
        reasonCode: null,
        reportedAtMs: 1_777_000_000_000,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        lane: "dev-local",
        serviceVersion: "0.7.57",
      },
      wakeRouteStatus: readyWakeRouteStatus(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    })),
    getAgentExecutionReadinessBatch: vi.fn(async () => ({
      items: [
        {
          agentExecutionReadiness: readyExecutionReadiness(),
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerRef: "builtin:codex",
          wakeRouteEvidence: {
            observedAt: "2026-05-10T00:00:00.000Z",
            reasonCode: "online",
            status: "online",
          },
          generatedAt: "2026-05-10T00:00:00.000Z",
          ownerUserId: "owner-1",
          primaryActionPlan: {
            action: "none",
            target: null,
          },
          profileName: "Codex",
          agentWakeAvailability: readyAgentWakeAvailability(),
          agentWakeRouteRegistration: {
            status: "registered",
            reasonCode: null,
            reportedAtMs: 1_777_000_000_000,
            daemonSessionId: "daemon-session-1",
            deviceId: "device-1",
            lane: "dev-local",
            serviceVersion: "0.7.57",
          },
          wakeRouteStatus: readyWakeRouteStatus(),
          routeDeviceId: "device-1",
          routeLane: "dev-local",
          runtimeDeviceDisplayName: "Felix's MacBook Pro",
        },
      ],
    })),
    ...(input?.coreOverrides ?? {}),
  };

  const authRpc: AuthRpcMock = {
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        authMethod: "session",
        authenticated: true,
        ownerIds: ["owner-1"],
        requestId: "req-agent-profile-binding-route",
      },
    })),
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        ownerUserId: "owner-1",
        profileKind: "human",
        profileName: "Mira",
      },
    })),
    ...(input?.authOverrides ?? {}),
  };

  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

function readyAgentWakeAvailability() {
  return {
    action: "none",
    badgeLabel: "Available",
    category: "available",
    isRefreshing: false,
    label: "Available for Wake",
    phase: "available",
    reasonCode: "agent_execution.ready",
    status: "available_for_wake",
    summary: "Available for Wake",
    tooltip: "Available for Wake",
  };
}

function readyWakeRouteStatus() {
  return {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    deviceId: "device-1",
    lane: "dev-local",
    lastHeartbeatMs: 1_747_000_000_000,
    leaseEpoch: 1,
    status: "ready",
  };
}

describe("agent profile binding routes", () => {
  it("forwards work recovery body and canonical Organization context to Core", async () => {
    const { coreRpc, env } = makeEnv({
      authOverrides: {
        resolveRequestAuth: vi.fn(async () => ({
          ok: true,
          claims: {
            activeOrganizationId: "org-1",
            authMethod: "session",
            authenticated: true,
            ownerIds: ["owner-1"],
            requestId: "req-agent-profile-work-recovery-route",
          },
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/work-recovery`,
        {
          body: JSON.stringify({ action: "continue_interrupted_work" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: "continue_interrupted_work",
      status: "accepted",
    });
    expect(coreRpc.executeAgentProfileWorkRecovery).toHaveBeenCalledOnce();
    expect(coreRpc.executeAgentProfileWorkRecovery).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      body: { action: "continue_interrupted_work" },
      context: expect.objectContaining({
        activeOrganizationId: "org-1",
        actorContext: expect.objectContaining({
          ownerUserId: "owner-1",
          requestId: "req-agent-profile-work-recovery-route",
        }),
      }),
    });
  });

  it("reads and saves Agent Profile creation defaults for one Local Agent", async () => {
    const { coreRpc, env } = makeEnv();
    const url =
      "http://local/v1/organizations/org-1/agent-profile-creation-defaults/builtin%3Acodex";

    const readResponse = await app.fetch(
      new Request(url),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      agentControllerRef: "builtin:codex",
      defaultProjectId: "project-1",
      modelId: "gpt-5.4-mini",
    });

    const writeResponse = await app.fetch(
      new Request(url, {
        body: JSON.stringify({
          agentControllerCollaborationMode: "codex:plan",
          agentControllerPermissionMode: "codex:approveForMe",
          defaultProjectId: "project-1",
          modelId: "gpt-5.4-mini",
          openCodePermission: null,
          reasoningLevel: "high",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(writeResponse.status).toBe(200);
    expect(coreRpc.getAgentProfileCreationDefaults).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerRef: "builtin:codex",
        organizationId: "org-1",
      })
    );
    expect(coreRpc.setAgentProfileCreationDefaults).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerPermissionMode: "codex:approveForMe",
        agentControllerRef: "builtin:codex",
        defaultProjectId: "project-1",
        modelId: "gpt-5.4-mini",
        organizationId: "org-1",
        reasoningLevel: "high",
      })
    );
  });

  it("reads primary Binding projection through the canonical Agent Profile route", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      binding: {
        agentProfileId: AGENT_PROFILE_ID,
        bindingState: "enabled_primary",
      },
      grantsClaimSuccess: false,
      status: "found",
    });
    expect(coreRpc.getAgentProfilePrimaryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
      })
    );
  });

  it("looks up the exact current Agent session without a profile-list route", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/agent-profiles/current-session?agentControllerConversationId=thread-1&agentControllerRef=builtin%3Acodex"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "found",
      sameOrganization: true,
    });
    expect(coreRpc.getCurrentAgentProfileSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerConversationId: "thread-1",
        agentControllerRef: "builtin:codex",
      })
    );
  });

  it("reads account-wide Controller change eligibility", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/controller-change-eligibility`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agentProfileId: AGENT_PROFILE_ID,
      reasonCode:
        "agent_profile_binding.controller_change_blocked_active_execution",
      status: "blocked",
    });
    expect(
      coreRpc.getAgentProfileControllerChangeEligibility
    ).toHaveBeenCalledWith(
      expect.objectContaining({ agentProfileId: AGENT_PROFILE_ID })
    );
  });

  it("rejects Binding command payloads with caller-provided owner identity", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`,
        {
          body: JSON.stringify({
            agentControllerRef: "builtin:codex",
            deviceId: "device-1",
            lane: "openmeld-dev",
            ownerAccountId: "body-owner",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.ensureAgentProfilePrimaryBinding).not.toHaveBeenCalled();
  });

  it("reads Agent Execution Readiness through the canonical Agent Profile route", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/execution-readiness`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      agentExecutionReadiness: {
        agentProfileId: AGENT_PROFILE_ID,
        displayState: "ready",
      },
      agentProfileId: AGENT_PROFILE_ID,
    });
    expect(coreRpc.getAgentExecutionReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
      })
    );
  });

  it("reads Agent Execution Readiness for multiple Agent Profiles", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/agent-profiles/execution-readiness/batch", {
        body: JSON.stringify({
          agentProfileIds: [AGENT_PROFILE_ID],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          agentExecutionReadiness: {
            agentProfileId: AGENT_PROFILE_ID,
            displayState: "ready",
          },
          agentProfileId: AGENT_PROFILE_ID,
        },
      ],
    });
    expect(coreRpc.getAgentExecutionReadinessBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileIds: [AGENT_PROFILE_ID],
      })
    );
  });

  it("forwards Binding commands to Core without inventing owner identity", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`,
        {
          body: JSON.stringify({
            agentControllerConversationId: "native-session-1",
            agentControllerRef: "builtin:codex",
            deviceId: "device-1",
            lane: "openmeld-dev",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
            sessionInventorySelection: {
              computerId: "computer-1",
              nativeSessionId: "native-session-1",
              organizationId: "org-1",
              ownerUserId: "owner-1",
              projectId: "project-1",
              provider: "codex",
            },
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
      outcome: "created",
      status: "accepted",
    });
    expect(coreRpc.ensureAgentProfilePrimaryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerConversationId: "native-session-1",
        agentControllerRef: "builtin:codex",
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
        sessionInventorySelection: {
          computerId: "computer-1",
          nativeSessionId: "native-session-1",
          organizationId: "org-1",
          ownerUserId: "owner-1",
          projectId: "project-1",
          provider: "codex",
        },
      })
    );
  });

  it("returns model validation errors directly from Binding writes", async () => {
    const validationMessage =
      'Model "gpt-99-nonexistent" is not supported for Agent Controller "builtin:codex". Supported models: gpt-5.6-sol, gpt-5.5.';
    const { env } = makeEnv({
      coreOverrides: {
        ensureAgentProfilePrimaryBinding: vi.fn(() => {
          throw createCoreRpcHttpError({
            status: 400,
            code: "agent_profile_binding.model_not_supported",
            reason: validationMessage,
          });
        }),
      },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`,
        {
          body: JSON.stringify({
            agentControllerRef: "builtin:codex",
            deviceId: "device-1",
            lane: "openmeld-dev",
            modelId: "gpt-99-nonexistent",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "agent_profile_binding.model_not_supported",
        message: validationMessage,
      },
    });
  });

  it("forwards Binding disable requests to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`,
        {
          method: "DELETE",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      agentProfileId: AGENT_PROFILE_ID,
      disabled: true,
      status: "disabled",
    });
    expect(coreRpc.disableAgentProfilePrimaryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
      })
    );
  });

  it("forwards model selection updates without runtime target fields", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/model-selection`,
        {
          body: JSON.stringify({
            modelId: "gpt-5.4-mini",
            reasoningLevel: "medium",
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      binding: {
        agentProfileId: AGENT_PROFILE_ID,
        modelSelection: {
          modelId: "gpt-5.4-mini",
          reasoningLevel: "medium",
        },
      },
      outcome: "reused",
      status: "accepted",
    });
    expect(
      coreRpc.updateAgentProfilePrimaryBindingModelSelection
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
      })
    );
    expect(coreRpc.ensureAgentProfilePrimaryBinding).not.toHaveBeenCalled();
  });

  it("forwards Default Project updates with canonical organization context", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/default-project`,
        {
          body: JSON.stringify({
            defaultProjectId: "project-1",
            expectedOrganizationId: "org-1",
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      profile: {
        defaultProjectId: "project-1",
        openMeldProfileId: AGENT_PROFILE_ID,
      },
    });
    expect(coreRpc.updateAgentProfileDefaultProject).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        defaultProjectId: "project-1",
        expectedOrganizationId: "org-1",
      })
    );
  });

  it("returns reasoning validation errors directly from model selection updates", async () => {
    const validationMessage =
      'Reasoning level "ultra" is not supported for model "gpt-5.5". Supported reasoning levels: low, medium, high, xhigh.';
    const { env } = makeEnv({
      coreOverrides: {
        updateAgentProfilePrimaryBindingModelSelection: vi.fn(() => {
          throw createCoreRpcHttpError({
            status: 400,
            code: "agent_profile_binding.reasoning_level_not_supported",
            reason: validationMessage,
          });
        }),
      },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/model-selection`,
        {
          body: JSON.stringify({
            modelId: "gpt-5.5",
            reasoningLevel: "ultra",
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "agent_profile_binding.reasoning_level_not_supported",
        message: validationMessage,
      },
    });
  });

  it("keeps modelId required for model selection updates", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/model-selection`,
        {
          body: JSON.stringify({ reasoningLevel: "high" }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_payload" },
    });
    expect(
      coreRpc.updateAgentProfilePrimaryBindingModelSelection
    ).not.toHaveBeenCalled();
  });

  it("rejects model selection updates that include runtime target fields", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/model-selection`,
        {
          body: JSON.stringify({
            deviceId: "current-device",
            modelId: "gpt-5.4-mini",
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(
      coreRpc.updateAgentProfilePrimaryBindingModelSelection
    ).not.toHaveBeenCalled();
    expect(coreRpc.ensureAgentProfilePrimaryBinding).not.toHaveBeenCalled();
  });

  it("forwards Agent Controller Permission Mode updates without runtime target fields", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/agent-controller-permission-mode`,
        {
          body: JSON.stringify({
            agentControllerPermissionMode: "codex:approveForMe",
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      binding: {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerPermissionMode: "codex:approveForMe",
      },
      outcome: "reused",
      status: "accepted",
    });
    expect(
      coreRpc.updateAgentProfilePrimaryBindingAgentControllerPermissionMode
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerPermissionMode: "codex:approveForMe",
      })
    );
    expect(coreRpc.ensureAgentProfilePrimaryBinding).not.toHaveBeenCalled();
  });

  it("forwards Codex Collaboration Mode updates without runtime target fields", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/agent-controller-collaboration-mode`,
        {
          body: JSON.stringify({
            agentControllerCollaborationMode: "codex:plan",
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      binding: {
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerCollaborationMode: "codex:plan",
      },
      outcome: "reused",
      status: "accepted",
    });
    expect(
      coreRpc.updateAgentProfilePrimaryBindingAgentControllerCollaborationMode
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerCollaborationMode: "codex:plan",
      })
    );
    expect(coreRpc.ensureAgentProfilePrimaryBinding).not.toHaveBeenCalled();
  });

  it("rejects Agent Controller Permission Mode updates that include runtime target fields", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/agent-controller-permission-mode`,
        {
          body: JSON.stringify({
            agentControllerPermissionMode: "codex:approveForMe",
            deviceId: "current-device",
          }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(
      coreRpc.updateAgentProfilePrimaryBindingAgentControllerPermissionMode
    ).not.toHaveBeenCalled();
    expect(coreRpc.ensureAgentProfilePrimaryBinding).not.toHaveBeenCalled();
  });

  it("forwards explicit reconnect Binding commands to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        `http://local/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`,
        {
          body: JSON.stringify({
            agentControllerRef: "builtin:codex",
            deviceId: "device-1",
            lane: "openmeld-dev",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
            writeMode: "reconnect",
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.ensureAgentProfilePrimaryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
        writeMode: "reconnect",
      })
    );
  });
});

function enabledBindingProjection(input?: {
  agentControllerCollaborationMode?: string;
  agentControllerPermissionMode?: string;
  modelSelection?: {
    modelId: string;
    reasoningLevel?: string;
  };
}) {
  return {
    agentProfileId: AGENT_PROFILE_ID,
    authoritySource: "binding_truth",
    bindingId: "binding_opaque_1",
    bindingState: "enabled_primary",
    dispatchEligibility: {
      reasonCodes: ["agent_profile_binding.command_eligible"],
      routable: true,
      status: "routable",
    },
    grantsClaimSuccess: false,
    ...(input?.agentControllerCollaborationMode
      ? {
          agentControllerCollaborationMode:
            input.agentControllerCollaborationMode,
        }
      : {}),
    ...(input?.agentControllerPermissionMode
      ? { agentControllerPermissionMode: input.agentControllerPermissionMode }
      : {}),
    ...(input?.modelSelection ? { modelSelection: input.modelSelection } : {}),
    reasonCodes: ["agent_profile_binding.command_eligible"],
    resolutionSource: "binding_truth",
    executionTarget: {
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    },
    routable: true,
  };
}

function readyExecutionReadiness() {
  return createSpaceMemberAgentExecutionReadiness({
    agentProfileId: AGENT_PROFILE_ID,
    displayState: "ready",
    primaryAction: "none",
    reasonCodes: ["agent_execution.ready"],
  });
}
