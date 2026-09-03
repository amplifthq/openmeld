import { describe, expect, it } from "vitest";
import {
  agentControllerCollaborationModeSchema,
  agentControllerPermissionModeSchema,
  agentProfileBindingRouteParamsSchema,
  currentAgentProfileSessionLookupQuerySchema,
  currentAgentProfileSessionLookupResponseSchema,
  ensureAgentProfilePrimaryBindingBodySchema,
  ensureAgentProfilePrimaryBindingResponseSchema,
  getAgentProfileControllerChangeEligibilityResponseSchema,
  getAgentProfileCreationDefaultsResponseSchema,
  getAgentProfilePrimaryBindingResponseSchema,
  listAgentProfileCreationDefaultsResponseSchema,
  setAgentProfileCreationDefaultsBodySchema,
} from "../../src/schemas";

const REASONING_REQUIRES_MODEL_PATTERN = /reasoningLevel requires modelId/u;

describe("agent profile binding http schemas", () => {
  it("keeps current Session lookup compact and Organization-aware", () => {
    expect(
      currentAgentProfileSessionLookupQuerySchema.parse({
        agentControllerConversationId: "01a03880-57d5-7663-a55b-b239a99dbf05",
        agentControllerRef: "builtin:codex",
      })
    ).toEqual({
      agentControllerConversationId: "01a03880-57d5-7663-a55b-b239a99dbf05",
      agentControllerRef: "builtin:codex",
    });
    expect(
      currentAgentProfileSessionLookupResponseSchema.parse({
        currentOrganizationId: "org-current",
        profile: {
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileName: "Codex - OpenMeld",
          profileOrganizationId: "org-other",
        },
        sameOrganization: false,
        status: "found",
      })
    ).toMatchObject({ sameOrganization: false, status: "found" });
    expect(
      currentAgentProfileSessionLookupResponseSchema.safeParse({
        currentOrganizationId: "org-current",
        profile: {
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileName: "Codex - OpenMeld",
        },
        sameOrganization: true,
        status: "found",
      }).success
    ).toBe(false);
  });

  it("keeps Controller change eligibility explicit and fail-closed", () => {
    expect(
      getAgentProfileControllerChangeEligibilityResponseSchema.parse({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        reasonCode:
          "agent_profile_binding.controller_change_blocked_active_execution",
        status: "blocked",
      })
    ).toMatchObject({
      reasonCode:
        "agent_profile_binding.controller_change_blocked_active_execution",
      status: "blocked",
    });
    expect(
      getAgentProfileControllerChangeEligibilityResponseSchema.safeParse({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        reasonCode: "agent_profile_binding.controller_change_allowed",
        status: "blocked",
      }).success
    ).toBe(false);
  });

  it("keeps remembered creation defaults scoped to one Local Agent", () => {
    expect(
      setAgentProfileCreationDefaultsBodySchema.parse({
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:fullAccess",
        defaultProjectId: "project-1",
        modelId: "gpt-5.6-sol",
        openCodePermission: null,
        reasoningLevel: "max",
      })
    ).toEqual({
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionMode: "codex:fullAccess",
      defaultProjectId: "project-1",
      modelId: "gpt-5.6-sol",
      openCodePermission: null,
      reasoningLevel: "max",
    });
    expect(
      getAgentProfileCreationDefaultsResponseSchema.parse({
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:fullAccess",
        agentControllerRef: "builtin:codex",
        defaultProjectId: "project-1",
        modelId: "gpt-5.6-sol",
        openCodePermission: null,
        organizationId: "org-1",
        reasoningLevel: "max",
        updatedAt: "2026-08-18T12:00:00.000Z",
        userId: "user-1",
      })
    ).toMatchObject({
      agentControllerCollaborationMode: "codex:plan",
      agentControllerRef: "builtin:codex",
      defaultProjectId: "project-1",
      modelId: "gpt-5.6-sol",
    });
    expect(() =>
      setAgentProfileCreationDefaultsBodySchema.parse({
        agentControllerCollaborationMode: null,
        agentControllerPermissionMode: null,
        defaultProjectId: null,
        modelId: null,
        openCodePermission: null,
        reasoningLevel: "max",
      })
    ).toThrow(REASONING_REQUIRES_MODEL_PATTERN);
  });

  it("lists every remembered Local Agent setup for one user in one Organization", () => {
    expect(
      listAgentProfileCreationDefaultsResponseSchema.parse({
        defaults: [
          {
            agentControllerCollaborationMode: "codex:plan",
            agentControllerPermissionMode: "codex:approveForMe",
            agentControllerRef: "builtin:codex",
            defaultProjectId: "project-1",
            modelId: "gpt-5.6-sol",
            openCodePermission: null,
            organizationId: "org-1",
            reasoningLevel: "high",
            updatedAt: "2026-08-26T01:00:00.000Z",
            userId: "user-1",
          },
          {
            agentControllerCollaborationMode: null,
            agentControllerPermissionMode: null,
            agentControllerRef: "builtin:opencode",
            defaultProjectId: null,
            modelId: "anthropic/claude-sonnet-4-5",
            openCodePermission: { edit: "allow" },
            organizationId: "org-1",
            reasoningLevel: "high",
            updatedAt: "2026-08-25T01:00:00.000Z",
            userId: "user-1",
          },
        ],
        organizationId: "org-1",
        userId: "user-1",
      })
    ).toMatchObject({
      defaults: [
        { agentControllerRef: "builtin:codex" },
        { agentControllerRef: "builtin:opencode" },
      ],
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("accepts read/write Binding payloads without caller-provided owner identity", () => {
    expect(
      agentProfileBindingRouteParamsSchema.parse({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).toEqual({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
    });

    expect(
      ensureAgentProfilePrimaryBindingBodySchema.parse({
        agentControllerRef: "builtin:codex",
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:approveForMe",
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    ).toMatchObject({
      agentControllerRef: "builtin:codex",
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionMode: "codex:approveForMe",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    });

    expect(
      ensureAgentProfilePrimaryBindingBodySchema.parse({
        agentControllerRef: "builtin:codex",
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
        writeMode: "reconnect",
      })
    ).toMatchObject({
      agentControllerRef: "builtin:codex",
      writeMode: "reconnect",
    });

    expect(() =>
      ensureAgentProfilePrimaryBindingBodySchema.parse({
        agentControllerRef: "builtin:codex",
        deviceId: "device-1",
        lane: "openmeld-dev",
        ownerAccountId: "owner-from-body",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    ).toThrow();
  });

  it("requires a resumed Session selection to match the Binding conversation", () => {
    const body = {
      agentControllerConversationId: "native-session-1",
      agentControllerRef: "builtin:codex",
      deviceId: "device-1",
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority" as const,
        value: "runtime_opaque_1",
      },
      sessionInventorySelection: {
        computerId: "computer-1",
        nativeSessionId: "native-session-1",
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "project-1",
        provider: "codex" as const,
      },
    };

    expect(ensureAgentProfilePrimaryBindingBodySchema.parse(body)).toEqual(
      body
    );
    expect(
      ensureAgentProfilePrimaryBindingBodySchema.safeParse({
        ...body,
        agentControllerConversationId: "another-native-session",
      }).success
    ).toBe(false);
    expect(
      ensureAgentProfilePrimaryBindingBodySchema.safeParse({
        ...body,
        agentControllerConversationId: undefined,
      }).success
    ).toBe(false);

    const longestNativeSessionId = "s".repeat(512);
    expect(
      ensureAgentProfilePrimaryBindingBodySchema.safeParse({
        ...body,
        agentControllerConversationId: longestNativeSessionId,
        sessionInventorySelection: {
          ...body.sessionInventorySelection,
          nativeSessionId: longestNativeSessionId,
        },
      }).success
    ).toBe(true);
    expect(
      ensureAgentProfilePrimaryBindingBodySchema.safeParse({
        ...body,
        agentControllerConversationId: `${longestNativeSessionId}s`,
        sessionInventorySelection: {
          ...body.sessionInventorySelection,
          nativeSessionId: `${longestNativeSessionId}s`,
        },
      }).success
    ).toBe(false);
  });

  it("keeps Codex Collaboration Mode separate from Permission Mode", () => {
    expect(agentControllerCollaborationModeSchema.options).toEqual([
      "codex:default",
      "codex:plan",
    ]);

    expect(
      ensureAgentProfilePrimaryBindingBodySchema.safeParse({
        agentControllerCollaborationMode: "plan",
        agentControllerRef: "builtin:codex",
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      }).success
    ).toBe(false);
  });

  it("keeps Agent Controller Permission Mode values explicit and rejects unsupported spellings", () => {
    expect(agentControllerPermissionModeSchema.options).toEqual([
      "claude-code:default",
      "claude-code:acceptEdits",
      "claude-code:plan",
      "claude-code:auto",
      "claude-code:dontAsk",
      "claude-code:bypassPermissions",
      "codex:askForApproval",
      "codex:approveForMe",
      "codex:fullAccess",
      "codex:customConfig",
      "cursor:default",
      "cursor:plan",
      "cursor:ask",
      "cursor:autoReview",
      "cursor:force",
      "grok-build:default",
      "grok-build:acceptEdits",
      "grok-build:plan",
      "grok-build:auto",
      "grok-build:dontAsk",
      "grok-build:bypassPermissions",
    ]);

    expect(
      ensureAgentProfilePrimaryBindingBodySchema.safeParse({
        agentControllerRef: "builtin:codex",
        agentControllerPermissionMode: "auto-edit",
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      }).success
    ).toBe(false);
  });

  it("requires accepted Binding command responses to carry Binding truth projection", () => {
    expect(
      ensureAgentProfilePrimaryBindingResponseSchema.parse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "binding_truth",
          bindingId: "binding_opaque_1",
          bindingState: "enabled_primary",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.command_eligible"],
            routable: true,
            status: "routable",
          },
          grantsClaimSuccess: false,
          agentControllerCollaborationMode: "codex:plan",
          agentControllerPermissionMode: "codex:approveForMe",
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
        },
        grantsClaimSuccess: false,
        outcome: "created",
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "accepted",
      })
    ).toMatchObject({
      status: "accepted",
      binding: {
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:approveForMe",
        bindingState: "enabled_primary",
      },
    });

    expect(
      ensureAgentProfilePrimaryBindingResponseSchema.parse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "binding_truth",
          bindingId: "binding_opaque_2",
          bindingState: "enabled_primary",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.command_eligible"],
            routable: true,
            status: "routable",
          },
          grantsClaimSuccess: false,
          agentControllerPermissionMode: "codex:askForApproval",
          reasonCodes: ["agent_profile_binding.command_eligible"],
          resolutionSource: "binding_truth",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_2",
            },
          },
          routable: true,
        },
        grantsClaimSuccess: false,
        outcome: "reconnected",
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "accepted",
      })
    ).toMatchObject({
      outcome: "reconnected",
      status: "accepted",
    });

    expect(
      ensureAgentProfilePrimaryBindingResponseSchema.safeParse({
        grantsClaimSuccess: false,
        outcome: "created",
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "accepted",
      }).success
    ).toBe(false);

    expect(
      ensureAgentProfilePrimaryBindingResponseSchema.safeParse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "none",
          bindingState: "missing",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.missing"],
            routable: false,
            status: "not_routable",
          },
          grantsClaimSuccess: false,
          reasonCodes: ["agent_profile_binding.missing"],
          resolutionSource: "missing_projection",
          executionTarget: null,
          routable: false,
        },
        grantsClaimSuccess: false,
        outcome: "created",
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "accepted",
      }).success
    ).toBe(false);

    expect(
      ensureAgentProfilePrimaryBindingResponseSchema.safeParse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "binding_truth",
          bindingId: "binding_opaque_1",
          bindingState: "enabled_primary",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.command_eligible"],
            routable: false,
            status: "not_routable",
          },
          grantsClaimSuccess: false,
          reasonCodes: ["agent_profile_binding.command_eligible"],
          resolutionSource: "binding_truth",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          },
          routable: false,
        },
        grantsClaimSuccess: false,
        outcome: "created",
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "accepted",
      }).success
    ).toBe(false);

    expect(
      ensureAgentProfilePrimaryBindingResponseSchema.safeParse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "none",
          agentControllerPermissionMode: "codex:askForApproval",
          bindingState: "missing",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.missing"],
            routable: false,
            status: "not_routable",
          },
          grantsClaimSuccess: false,
          reasonCodes: ["agent_profile_binding.missing"],
          resolutionSource: "missing_projection",
          executionTarget: null,
          routable: false,
        },
        grantsClaimSuccess: false,
        outcome: "created",
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "accepted",
      }).success
    ).toBe(false);
  });

  it("keeps rejected Binding command responses free of caller openMeldServiceRuntimeId evidence", () => {
    expect(
      ensureAgentProfilePrimaryBindingResponseSchema.parse({
        grantsClaimSuccess: false,
        reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
        routable: false,
        status: "rejected",
      })
    ).toEqual({
      grantsClaimSuccess: false,
      reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
      routable: false,
      status: "rejected",
    });

    expect(
      ensureAgentProfilePrimaryBindingResponseSchema.safeParse({
        grantsClaimSuccess: false,
        reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
        routable: false,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "owner_account:owner-1:device-1:openmeld-dev",
        },
        status: "rejected",
      }).success
    ).toBe(false);
  });

  it("reads missing Binding as explicit non-routable projection", () => {
    expect(
      getAgentProfilePrimaryBindingResponseSchema.parse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "none",
          bindingState: "missing",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.missing"],
            routable: false,
            status: "not_routable",
          },
          grantsClaimSuccess: false,
          reasonCodes: ["agent_profile_binding.missing"],
          resolutionSource: "missing_projection",
          executionTarget: null,
          routable: false,
        },
        grantsClaimSuccess: false,
        status: "missing",
      })
    ).toMatchObject({
      binding: {
        bindingState: "missing",
      },
      status: "missing",
    });

    expect(
      getAgentProfilePrimaryBindingResponseSchema.safeParse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "none",
          bindingState: "missing",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.missing"],
            routable: false,
            status: "not_routable",
          },
          grantsClaimSuccess: false,
          reasonCodes: ["agent_profile_binding.missing"],
          resolutionSource: "missing_projection",
          executionTarget: null,
          routable: false,
        },
        grantsClaimSuccess: false,
        status: "found",
      }).success
    ).toBe(false);
  });

  it("reads unavailable Binding evidence without reporting it as missing", () => {
    expect(
      getAgentProfilePrimaryBindingResponseSchema.parse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "none",
          bindingState: "missing",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
            routable: false,
            status: "not_routable",
          },
          grantsClaimSuccess: false,
          reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
          resolutionSource: "missing_projection",
          executionTarget: null,
          routable: false,
        },
        grantsClaimSuccess: false,
        status: "unavailable",
      })
    ).toMatchObject({
      binding: {
        reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
      },
      status: "unavailable",
    });

    expect(
      getAgentProfilePrimaryBindingResponseSchema.safeParse({
        binding: {
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          authoritySource: "none",
          bindingState: "missing",
          dispatchEligibility: {
            reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
            routable: false,
            status: "not_routable",
          },
          grantsClaimSuccess: false,
          reasonCodes: ["agent_profile_binding.profile_owner_unavailable"],
          resolutionSource: "missing_projection",
          executionTarget: null,
          routable: false,
        },
        grantsClaimSuccess: false,
        status: "missing",
      }).success
    ).toBe(false);
  });
});
