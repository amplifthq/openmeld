import { describe, expect, it } from "vitest";
import {
  agentControllerCollaborationModeSchema,
  agentControllerPermissionModeSchema,
  agentProfileBindingRouteParamsSchema,
  bulkAuthorizeAgentProfileBindingsForOrganizationBodySchema,
  bulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema,
  ensureAgentProfilePrimaryBindingBodySchema,
  ensureAgentProfilePrimaryBindingResponseSchema,
  getAgentProfileCreationDefaultsResponseSchema,
  getAgentProfilePrimaryBindingResponseSchema,
  getOrganizationBindingAuthorizationPreferenceResponseSchema,
  listOrganizationBindingAuthorizationProfilesResponseSchema,
  saveOrganizationWakeAccessChoiceBodySchema,
  saveOrganizationWakeAccessChoiceResponseSchema,
  setAgentProfileCreationDefaultsBodySchema,
  setOrganizationBindingAuthorizationPreferenceBodySchema,
} from "../../src/schemas";

const REASONING_REQUIRES_MODEL_PATTERN = /reasoningLevel requires modelId/u;

describe("agent profile binding http schemas", () => {
  it("keeps remembered creation defaults scoped to one Local Agent", () => {
    expect(
      setAgentProfileCreationDefaultsBodySchema.parse({
        agentControllerPermissionMode: "codex:fullAccess",
        defaultProjectId: "project-1",
        modelId: "gpt-5.6-sol",
        openCodePermission: null,
        reasoningLevel: "max",
      })
    ).toEqual({
      agentControllerPermissionMode: "codex:fullAccess",
      defaultProjectId: "project-1",
      modelId: "gpt-5.6-sol",
      openCodePermission: null,
      reasoningLevel: "max",
    });
    expect(
      getAgentProfileCreationDefaultsResponseSchema.parse({
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
      agentControllerRef: "builtin:codex",
      defaultProjectId: "project-1",
      modelId: "gpt-5.6-sol",
    });
    expect(() =>
      setAgentProfileCreationDefaultsBodySchema.parse({
        agentControllerPermissionMode: null,
        defaultProjectId: null,
        modelId: null,
        openCodePermission: null,
        reasoningLevel: "max",
      })
    ).toThrow(REASONING_REQUIRES_MODEL_PATTERN);
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

  it("accepts bulk Organization Binding authorization and preference contracts", () => {
    expect(
      bulkAuthorizeAgentProfileBindingsForOrganizationBodySchema.parse({
        agentProfileIds: ["agt_11111111-1111-4111-8111-111111111111"],
      })
    ).toEqual({
      agentProfileIds: ["agt_11111111-1111-4111-8111-111111111111"],
    });

    expect(
      bulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema.parse({
        alreadyAuthorizedCount: 1,
        authorizedCount: 1,
        authorizations: [
          {
            agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
            authorizedBy: "user-1",
            bindingId: "binding-1",
            createdAt: "2026-07-05T00:00:00.000Z",
            organizationId: "org-1",
            status: "authorized",
          },
          {
            agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
            authorizedBy: "user-1",
            bindingId: "binding-2",
            createdAt: "2026-07-05T00:00:00.000Z",
            organizationId: "org-1",
            status: "already_authorized",
          },
        ],
        organizationId: "org-1",
      })
    ).toMatchObject({
      authorizedCount: 1,
      alreadyAuthorizedCount: 1,
    });

    expect(
      setOrganizationBindingAuthorizationPreferenceBodySchema.parse({
        autoAuthorizeAgentProfileBindings: true,
      })
    ).toEqual({
      autoAuthorizeAgentProfileBindings: true,
    });
    expect(
      getOrganizationBindingAuthorizationPreferenceResponseSchema.parse({
        autoAuthorizeAgentProfileBindings: false,
        organizationId: "org-1",
        updatedAt: null,
        userId: "user-1",
      })
    ).toMatchObject({
      autoAuthorizeAgentProfileBindings: false,
      updatedAt: null,
    });

    expect(
      saveOrganizationWakeAccessChoiceBodySchema.parse({
        enableWakeAccess: true,
      })
    ).toEqual({ enableWakeAccess: true });
    expect(
      saveOrganizationWakeAccessChoiceResponseSchema.parse({
        alreadyAuthorizedCount: 1,
        authorizedCount: 2,
        organizationId: "org-1",
        preference: {
          autoAuthorizeAgentProfileBindings: true,
          organizationId: "org-1",
          updatedAt: "2026-07-16T00:00:00.000Z",
          userId: "user-1",
        },
      })
    ).toMatchObject({
      alreadyAuthorizedCount: 1,
      authorizedCount: 2,
      organizationId: "org-1",
      preference: { autoAuthorizeAgentProfileBindings: true },
    });

    expect(
      listOrganizationBindingAuthorizationProfilesResponseSchema.parse({
        organizationId: "org-1",
        profiles: [
          {
            agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
            authorized: true,
            authorizedAt: "2026-07-05T00:00:00.000Z",
            authorizedBy: "user-1",
            bindingId: "binding-1",
            ownerUserId: "user-1",
            profileHandle: "codex",
            profileName: "Codex",
            profileOrganizationId: "org-personal",
            status: "authorized",
          },
          {
            agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
            authorized: false,
            authorizedAt: null,
            authorizedBy: null,
            bindingId: null,
            ownerUserId: "user-1",
            profileHandle: "assistant",
            profileName: "Assistant",
            profileOrganizationId: "org-1",
            status: "binding_required",
          },
        ],
      })
    ).toMatchObject({
      organizationId: "org-1",
      profiles: [
        expect.objectContaining({ status: "authorized" }),
        expect.objectContaining({ status: "binding_required" }),
      ],
    });
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
