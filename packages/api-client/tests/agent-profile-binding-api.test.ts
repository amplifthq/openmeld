import { createSpaceMemberAgentExecutionReadiness } from "@openmeld/schemas/testing";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentProfileBindingApi,
  createAgentProfileExecutionModeApi,
  createOpenMeldApiClient,
} from "../src";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("api-client agent profile binding api", () => {
  it.each([
    undefined,
    "serial",
    "parallel",
  ] as const)("uses the owner execution-mode route for %s", async (mode) => {
    const response = {
      agentProfileId: AGENT_PROFILE_ID,
      mode: mode ?? "parallel",
      migration: "draining",
      revision: 7,
    };
    const transport = vi.fn(() => Promise.resolve(jsonResponse(response)));
    const api = createAgentProfileExecutionModeApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    await expect(
      api.readOrUpdate({ agentProfileId: AGENT_PROFILE_ID, mode })
    ).resolves.toEqual(response);
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${AGENT_PROFILE_ID}/execution-mode`,
        init: expect.objectContaining({
          method: mode ? "PATCH" : "GET",
          ...(mode ? { body: JSON.stringify({ mode }) } : {}),
        }),
      })
    );
  });

  it("looks up one exact Agent session without listing profiles", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          currentOrganizationId: "org-1",
          profile: {
            profileId: AGENT_PROFILE_ID,
            profileName: "Codex",
            profileOrganizationId: "org-1",
          },
          sameOrganization: true,
          status: "found",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getCurrentSession({
        agentControllerConversationId: "thread-1",
        agentControllerRef: "builtin:codex",
      })
    ).resolves.toMatchObject({ status: "found", sameOrganization: true });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "agent_profile_binding.current_session.read",
        url: "https://gateway.openmeld.invalid/v1/agent-profiles/current-session?agentControllerConversationId=thread-1&agentControllerRef=builtin%3Acodex",
      })
    );
  });

  it("reads primary Binding projection through the canonical Agent Profile route", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          binding: enabledBinding(),
          grantsClaimSuccess: false,
          status: "found",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getPrimaryBinding({
      agentProfileId: AGENT_PROFILE_ID,
    });

    expect(result.status).toBe("found");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          method: "GET",
        }),
        operation: "agent_profile_binding.primary.read",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`,
      })
    );
  });

  it("reads account-wide Controller change eligibility", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          agentProfileId: AGENT_PROFILE_ID,
          reasonCode:
            "agent_profile_binding.controller_change_blocked_active_execution",
          status: "blocked",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getControllerChangeEligibility({
        agentProfileId: AGENT_PROFILE_ID,
      })
    ).resolves.toMatchObject({ status: "blocked" });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "agent_profile_binding.controller_change_eligibility.read",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/controller-change-eligibility`,
      })
    );
  });

  it("reads Agent Execution Readiness through the canonical Agent Profile route", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
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
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getExecutionReadiness({
      agentProfileId: AGENT_PROFILE_ID,
    });

    expect(result.agentExecutionReadiness.displayState).toBe("ready");
    expect(
      new Headers(transport.mock.calls[0]?.[0].init?.headers).get(
        "x-openmeld-agent-execution-readiness-version"
      )
    ).toBe("2");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          method: "GET",
        }),
        operation: "agent_execution_readiness.read",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/execution-readiness`,
      })
    );
  });

  it("reads Agent Execution Readiness for multiple Agent Profiles", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
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
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const controller = new AbortController();
    const result = await api.getExecutionReadinessBatch({
      agentProfileIds: [AGENT_PROFILE_ID],
      signal: controller.signal,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.agentExecutionReadiness.displayState).toBe("ready");
    expect(
      new Headers(transport.mock.calls[0]?.[0].init?.headers).get(
        "x-openmeld-agent-execution-readiness-version"
      )
    ).toBe("2");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            agentProfileIds: [AGENT_PROFILE_ID],
          }),
          method: "POST",
        }),
        operation: "agent_execution_readiness.batch_read",
        url: "https://gateway.openmeld.invalid/v1/agent-profiles/execution-readiness/batch",
      })
    );
    controller.abort();
    expect(transport.mock.calls[0]?.[0].init?.signal?.aborted).toBe(true);
  });

  it("ensures primary Binding without caller-provided owner identity", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          binding: enabledBinding(),
          grantsClaimSuccess: false,
          outcome: "created",
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.ensurePrimaryBinding({
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
    });

    expect(result.status).toBe("accepted");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            agentControllerRef: "builtin:codex",
            agentControllerConversationId: "native-session-1",
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
          method: "PUT",
        }),
        operation: "agent_profile_binding.primary.ensure",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`,
      })
    );
  });

  it("keeps request context authority out of the Binding command body", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          binding: enabledBinding(),
          grantsClaimSuccess: false,
          outcome: "created",
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        getRequestContextHeaders: async () => ({
          "x-openmeld-request-id": "req-1",
        }),
        transport,
      })
    );

    await api.ensurePrimaryBinding({
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      deviceId: "device-1",
      lane: "openmeld-dev",
      requestContext: {
        actorContext: {
          openMeldProfileId: AGENT_PROFILE_ID,
          callerPrincipalId: "caller-1",
          ownerUserId: "owner-1",
          profileKind: "agent",
          profileName: "Codex",
          requestId: "req-1",
        },
      },
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    });

    const request = transport.mock.calls.at(0)?.[0];
    if (!request) {
      throw new Error("Expected Binding command request.");
    }
    const body = JSON.parse(String(request.init?.body ?? "{}"));
    expect(body).toEqual({
      agentControllerRef: "builtin:codex",
      deviceId: "device-1",
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    });
    expect(JSON.stringify(body)).not.toContain("caller-1");
    expect(JSON.stringify(body)).not.toContain("owner-1");
    expect(JSON.stringify(body)).not.toContain(AGENT_PROFILE_ID);
  });

  it("disables the primary Binding through the canonical Agent Profile route", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          agentProfileId: AGENT_PROFILE_ID,
          disabled: true,
          reasonCodes: ["agent_profile_binding.primary_binding_disabled"],
          status: "disabled",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.disablePrimaryBinding({
      agentProfileId: AGENT_PROFILE_ID,
    });

    expect(result).toEqual({
      agentProfileId: AGENT_PROFILE_ID,
      disabled: true,
      reasonCodes: ["agent_profile_binding.primary_binding_disabled"],
      status: "disabled",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          method: "DELETE",
        }),
        operation: "agent_profile_binding.primary.disable",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding`,
      })
    );
  });

  it("updates primary Binding model selection without runtime target fields", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          binding: enabledBinding({
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
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.updatePrimaryBindingModelSelection({
      agentProfileId: AGENT_PROFILE_ID,
      modelId: "gpt-5.4-mini",
      reasoningLevel: "medium",
    });

    expect(result).toMatchObject({
      outcome: "reused",
      status: "accepted",
      binding: {
        modelSelection: {
          modelId: "gpt-5.4-mini",
          reasoningLevel: "medium",
        },
      },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            modelId: "gpt-5.4-mini",
            reasoningLevel: "medium",
          }),
          method: "PATCH",
        }),
        operation: "agent_profile_binding.primary.model_selection.update",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/model-selection`,
      })
    );
  });

  it("updates primary Binding Agent Controller Permission Mode without runtime target fields", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          binding: enabledBinding({
            agentControllerPermissionMode: "codex:approveForMe",
          }),
          grantsClaimSuccess: false,
          outcome: "reused",
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.updatePrimaryBindingAgentControllerPermissionMode({
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerPermissionMode: "codex:approveForMe",
    });

    expect(result).toMatchObject({
      outcome: "reused",
      status: "accepted",
      binding: {
        agentControllerPermissionMode: "codex:approveForMe",
      },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            agentControllerPermissionMode: "codex:approveForMe",
          }),
          method: "PATCH",
        }),
        operation:
          "agent_profile_binding.primary.agent_controller_permission_mode.update",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/agent-controller-permission-mode`,
      })
    );
  });

  it("updates primary Binding OpenCode permissions without runtime target fields", async () => {
    const openCodePermission = {
      bash: {
        "*": "deny",
        "git status *": "allow",
      },
      edit: "ask",
    } as const;
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          binding: enabledBinding({
            openCodePermission,
          }),
          grantsClaimSuccess: false,
          outcome: "reused",
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.updatePrimaryBindingOpenCodePermission({
      agentProfileId: AGENT_PROFILE_ID,
      openCodePermission,
    });

    expect(result).toMatchObject({
      outcome: "reused",
      status: "accepted",
      binding: {
        openCodePermission,
      },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            openCodePermission,
          }),
          method: "PATCH",
        }),
        operation: "agent_profile_binding.primary.opencode_permission.update",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/primary-binding/opencode-permission`,
      })
    );
  });

  it("accepts rejected Binding command responses without openMeldServiceRuntimeId echo", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          grantsClaimSuccess: false,
          reasonCodes: [
            "agent_profile_binding.agent_controller_report_invalid",
          ],
          routable: false,
          status: "rejected",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.ensurePrimaryBinding({
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      deviceId: "device-1",
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "owner_account:owner-1:device-1:openmeld-dev",
      },
    });

    expect(result).toEqual({
      grantsClaimSuccess: false,
      reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
      routable: false,
      status: "rejected",
    });
  });

  it("rejects caller-provided owner identity before sending a Binding command", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          binding: enabledBinding(),
          grantsClaimSuccess: false,
          outcome: "created",
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.ensurePrimaryBinding({
        agentProfileId: AGENT_PROFILE_ID,
        agentControllerRef: "builtin:codex",
        deviceId: "device-1",
        lane: "openmeld-dev",
        ownerAccountId: "owner-from-caller",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      } as unknown as Parameters<typeof api.ensurePrimaryBinding>[0])
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("forwards explicit reconnect Binding commands without caller-provided owner identity", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          binding: enabledBinding(),
          grantsClaimSuccess: false,
          outcome: "reconnected",
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileBindingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.ensurePrimaryBinding({
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      deviceId: "device-1",
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      writeMode: "reconnect",
    });

    expect(result).toMatchObject({
      outcome: "reconnected",
      status: "accepted",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
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
          method: "PUT",
        }),
      })
    );
  });
});

function enabledBinding(input?: {
  agentControllerPermissionMode?: string;
  modelSelection?: {
    modelId: string;
    reasoningLevel?: string;
  };
  openCodePermission?: Record<string, unknown>;
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
    ...(input?.agentControllerPermissionMode
      ? { agentControllerPermissionMode: input.agentControllerPermissionMode }
      : {}),
    ...(input?.modelSelection ? { modelSelection: input.modelSelection } : {}),
    ...(input?.openCodePermission
      ? { openCodePermission: input.openCodePermission }
      : {}),
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
