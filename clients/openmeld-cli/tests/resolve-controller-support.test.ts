import type {
  GetAgentProfilePrimaryBindingResponse,
  ModelCatalog,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import type { RuntimeAgentControllerState } from "../src/config/runtime-config";
import { resolveLocalDaemonRouteCandidate } from "../src/local-service/routing/resolve-controller-support";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

describe("resolveLocalDaemonRouteCandidate", () => {
  it("builds the accepted route with runtime defaults when local controller settings are missing", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => ({
          adapter: {},
          adapterId: "codex",
        }),
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>([
        [
          "codex",
          createLocalController({
            streamingMode: undefined,
            transportMode: undefined,
          }),
        ],
      ]),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding(),
      profile: createAgentProfile(),
    });

    expect(result).toEqual({
      profileId: "agt-codex",
      route: {
        agentControllerConversationId: null,
        agentControllerCollaborationMode: "codex:default",
        agentControllerPermissionMode: "codex:askForApproval",
        conversationPolicy: {
          collaborationMode: "default",
          fallbackModel: "gpt-5.5",
          model: "gpt-5.5",
        },
        contextIdMappingSpec: {
          mappingVersion: 1,
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
        },
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-codex",
        bindingId: "binding-codex",
        launchContract: {
          kind: "executable",
          commandPath: "/tmp/codex",
        },
        profileId: "agt-codex",
        streamingMode: "final",
        transportMode: "codex-app-server",
      },
      status: "accepted",
    });
  });

  it("maps Codex Plan Collaboration Mode into the conversation policy", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => ({
          adapter: {},
          adapterId: "codex",
        }),
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>([
        ["codex", createLocalController()],
      ]),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding({
        agentControllerCollaborationMode: "codex:plan",
      }),
      profile: createAgentProfile(),
    });

    expect(result).toMatchObject({
      route: {
        agentControllerCollaborationMode: "codex:plan",
        conversationPolicy: {
          collaborationMode: "plan",
        },
      },
      status: "accepted",
    });
  });

  it("preserves an existing Codex thread when its Binding has no explicit model selection", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => ({
          adapter: {},
          adapterId: "codex",
        }),
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>([
        ["codex", createLocalController()],
      ]),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding({
        executionTarget: {
          agentControllerConversationId: "codex-thread",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-codex",
          },
        },
      }),
      profile: createAgentProfile(),
    });

    expect(result).toMatchObject({
      route: {
        agentControllerConversationId: "codex-thread",
        conversationPolicy: {
          collaborationMode: "default",
        },
      },
      status: "accepted",
    });
    expect(
      result.status === "accepted" ? result.route.conversationPolicy : {}
    ).not.toHaveProperty("model");
    expect(
      result.status === "accepted" ? result.route.conversationPolicy : {}
    ).not.toHaveProperty("reasoningLevel");
  });

  it("migrates stale Codex local-cli controller state to the supported App Server route transport", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => ({
          adapter: {},
          adapterId: "codex",
        }),
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>([
        [
          "codex",
          createLocalController({
            transportMode: "local-cli",
          }),
        ],
      ]),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding(),
      profile: createAgentProfile(),
    });

    expect(result).toMatchObject({
      profileId: "agt-codex",
      route: {
        agentControllerRef: "builtin:codex",
        transportMode: "codex-app-server",
      },
      status: "accepted",
    });
  });

  it("rejects an unavailable explicit model without constructing a replacement route", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => ({
          adapter: {},
          adapterId: "codex",
        }),
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>([
        ["codex", createLocalController()],
      ]),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding({
        modelSelection: {
          modelId: "gpt-retired",
        },
      }),
      profile: createAgentProfile(),
    });

    expect(result).toEqual({
      profileId: "agt-codex",
      skipReason: "model.unavailable",
      status: "skipped",
    });
    expect(result).not.toHaveProperty("route");
  });

  it.each([
    {
      name: "sign-in-scoped",
      scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
      blocked: false,
    },
    {
      name: "provider-scoped",
      scope: { controllerRef: "builtin:codex", providerId: "openai" },
      blocked: false,
    },
    {
      name: "controller-wide",
      scope: { controllerRef: "builtin:codex" },
      blocked: true,
    },
  ])("keeps $name withdrawal within the evidence available to route construction", ({
    scope,
    blocked,
  }) => {
    const catalog = structuredClone(TEST_MODEL_CATALOG);
    const model = catalog.agentControllers.codex?.models.find(
      (entry) => entry.id === "gpt-retired"
    );
    if (!model) {
      throw new Error("Expected the original model fixture");
    }
    model.unavailable = false;
    model.retirement = {
      status: "withdrawn",
      date: null,
      scope,
      sourceUrl: "https://example.com/official-notice",
      verifiedAt: "2026-06-18T00:00:00.000Z",
    };
    const binding = createPrimaryBinding({
      modelSelection: { modelId: model.id },
    });
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => ({ adapter: {}, adapterId: "codex" }),
      } as never,
      localControllers: new Map([["codex", createLocalController()]]),
      modelCatalog: catalog,
      ownerUserId: "user-1",
      primaryBinding: binding,
      profile: createAgentProfile(),
    });
    if (blocked) {
      expect(result).toEqual({
        profileId: "agt-codex",
        skipReason: "model.retired",
        status: "skipped",
      });
    } else {
      // Account-scoped authorization belongs to Core's current Wake admission,
      // not persisted installation state. Never replace the original intent.
      expect(result).toMatchObject({
        status: "accepted",
        route: { conversationPolicy: { model: model.id } },
      });
      if (result.status !== "accepted") {
        throw new Error("Expected a route, not a scoped admission decision");
      }
      expect(result.route.conversationPolicy).not.toHaveProperty(
        "fallbackModel"
      );
    }
    expect(binding.modelSelection).toEqual({ modelId: model.id });
  });

  it("omits unsupported Agent Controller Permission Modes for OpenClaw routes", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => ({
          adapter: {},
          adapterId: "openclaw",
        }),
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>([
        ["openclaw", createLocalController({ agentId: "openclaw" })],
      ]),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding({
        agentControllerPermissionMode: "codex:fullAccess",
        executionTarget: {
          agentControllerRef: "builtin:openclaw",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-openclaw",
          },
        },
      }),
      profile: createAgentProfile({
        openMeldProfileId: "agt-openclaw",
        profileName: "OpenClaw Agent",
      }),
    });

    expect(result).toMatchObject({
      profileId: "agt-openclaw",
      route: {
        agentControllerRef: "builtin:openclaw",
      },
      status: "accepted",
    });
    expect(
      result.status === "accepted" ? result.route : null
    ).not.toHaveProperty("agentControllerPermissionMode");
  });

  it("returns the disabled profile reason for owner agent profiles", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>(),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding(),
      profile: createAgentProfile({
        status: "disabled",
      }),
    });

    expect(result).toEqual({
      profileId: "agt-codex",
      skipReason: "profile.status.inactive",
      status: "skipped",
    });
  });

  it("returns the disabled Binding reason when primary binding is not routable", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>(),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding({
        bindingState: "disabled_historical",
        routable: false,
        dispatchEligibility: {
          reasonCodes: ["agent_profile_binding.disabled_historical"],
          routable: false,
          status: "not_routable",
        },
        reasonCodes: ["agent_profile_binding.disabled_historical"],
      }),
      profile: createAgentProfile(),
    });

    expect(result).toEqual({
      profileId: "agt-codex",
      skipReason: "controller.binding.disabled",
      status: "skipped",
    });
  });

  it("returns the missing runtime projection reason when controller is not registered locally", () => {
    const result = resolveLocalDaemonRouteCandidate({
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      localControllers: new Map<string, RuntimeAgentControllerState>(),
      modelCatalog: TEST_MODEL_CATALOG,
      ownerUserId: "user-1",
      primaryBinding: createPrimaryBinding(),
      profile: createAgentProfile(),
    });

    expect(result).toEqual({
      profileId: "agt-codex",
      skipReason: "projection.missing",
      status: "skipped",
    });
  });
});

const TEST_MODEL_CATALOG: ModelCatalog = {
  schemaVersion: 1,
  updatedAt: "2026-06-18T00:00:00.000Z",
  agentControllers: {
    codex: {
      defaultModelId: "gpt-5.5",
      models: [
        {
          displayName: "GPT-5.5",
          id: "gpt-5.5",
          minCliVersion: null,
          supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
          unavailable: false,
        },
        {
          displayName: "GPT Retired",
          id: "gpt-retired",
          minCliVersion: null,
          supportedReasoningLevels: ["high"],
          unavailable: true,
        },
      ],
    },
  },
};

function createAgentProfile(
  overrides?: Partial<OpenMeldProfile>
): OpenMeldProfile {
  return createTestOpenMeldProfile({
    openMeldProfileId: "agt-codex",
    profileKind: "agent",
    profileName: "Codex Agent",
    status: "active",
    ...overrides,
  });
}

function createPrimaryBinding(
  overrides?: Partial<GetAgentProfilePrimaryBindingResponse["binding"]>
): GetAgentProfilePrimaryBindingResponse["binding"] {
  return {
    agentProfileId: "agt-codex",
    authoritySource: "binding_truth",
    bindingId: "binding-codex",
    bindingState: "enabled_primary",
    dispatchEligibility: {
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
      status: "routable",
    },
    grantsClaimSuccess: false,
    reasonCodes: ["agent_profile_binding.enabled_primary"],
    resolutionSource: "binding_truth",
    routable: true,
    executionTarget: {
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-codex",
      },
    },
    ...overrides,
  };
}

function createLocalController(
  overrides?: Partial<RuntimeAgentControllerState>
): RuntimeAgentControllerState {
  return {
    agentId: "codex",
    displayName: "Codex",
    enabled: true,
    launchContract: {
      kind: "executable",
      commandPath: "/tmp/codex",
    },
    registeredAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}
