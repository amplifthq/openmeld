import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { modelCatalogSchema } from "@openmeld/schemas";
import type { ModelCatalog } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type AgentProfileBindingCommandStore,
  AgentProfileBindingModelSelectionValidationError,
  ensurePrimaryAgentProfileBinding,
  type RuntimeAgentControllerReportReadStore,
  updatePrimaryAgentProfileBindingAgentControllerCollaborationMode,
  updatePrimaryAgentProfileBindingAgentControllerPermissionMode,
  updatePrimaryAgentProfileBindingModelSelection,
  updatePrimaryAgentProfileBindingOpenCodePermission,
} from "../src/agent-profile-binding/application/agent-profile-binding-command-service";
import { readModelCatalog } from "../src/config/model-catalog";
import type { RuntimeLookupStore } from "../src/runtime-registry/application/runtime-lookup-service";
import { readAvailableModelIds } from "./test-support/model-catalog.test-support";

const OWNER = {
  id: "owner-1",
  kind: "owner_account",
} as const;
const OTHER_OWNER = {
  id: "owner-2",
  kind: "owner_account",
} as const;

describe("Agent Profile Binding command service", () => {
  it("creates a routable enabled primary Binding when all required evidence passes", async () => {
    const runtimeLookupInput = ownerAccountRuntimeLookupInput();
    const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
      lookupInput: runtimeLookupInput,
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_registry_authority",
    });
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        agentProfileId: "agent-profile-1",
        bindingStore,
        agentControllerRef: "builtin:codex",
        createBindingId: () => "binding_opaque_1",
        createdByProfileId: "profile-1",
        nowMs: 2000,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
        runtimeAgentControllerReportStore: createCurrentReportStore({
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.available"],
          openMeldServiceRuntimeId,
          status: "ready",
        }),
        openMeldServiceRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore(
          openMeldServiceRuntimeId
        ),
      })
    ).resolves.toEqual({
      binding: {
        agentControllerCollaborationMode: null,
        agentControllerPermissionMode: null,
        agentProfileId: "agent-profile-1",
        agentControllerConversationId: undefined,
        bindingId: "binding_opaque_1",
        bindingState: "enabled_primary",
        agentControllerRef: "builtin:codex",
        createdAtMs: 2000,
        createdByProfileId: "profile-1",
        disabledAtMs: null,
        modelId: null,
        openCodePermission: null,
        owner: {
          id: "owner-1",
          kind: "owner_account",
        },
        reasonCode: "agent_profile_binding.command_eligible",
        reasoningLevel: null,
        openMeldServiceRuntimeId: "runtime_opaque_1",
        updatedAtMs: 2000,
      },
      outcome: "created",
      reasonCodes: ["agent_profile_binding.command_eligible"],
      routable: true,
      status: "accepted",
    });

    expect(bindingStore.records).toHaveLength(1);
  });

  it("stores model selection as Binding metadata on the same target", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        modelId: "gpt-5.5",
        reasoningLevel: "high",
      })
    ).resolves.toMatchObject({
      binding: {
        bindingId: "binding_opaque_1",
        modelId: "gpt-5.5",
        reasoningLevel: "high",
      },
      outcome: "created",
      status: "accepted",
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        createBindingId: () => "binding_should_not_replace_target",
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
        nowMs: 3000,
      })
    ).resolves.toMatchObject({
      binding: {
        bindingId: "binding_opaque_1",
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
        updatedAtMs: 3000,
      },
      outcome: "reused",
      status: "accepted",
    });

    expect(bindingStore.records).toHaveLength(1);
  });

  it.each([
    {
      agentControllerRef: "builtin:codex",
      modelId: "gpt-5.6-sol",
      reasoningLevel: "ultra",
    },
    {
      agentControllerRef: "builtin:claude-code",
      modelId: "claude-fable-5",
      reasoningLevel: "max",
    },
  ])("stores supported $modelId and $reasoningLevel selections", async ({
    agentControllerRef,
    modelId,
    reasoningLevel,
  }) => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({ agentControllerRef }),
        bindingStore,
        modelId,
        reasoningLevel,
      })
    ).resolves.toMatchObject({
      binding: {
        agentControllerRef,
        modelId,
        reasoningLevel,
      },
      status: "accepted",
    });
  });

  it("rejects an unavailable catalog model without offering it as a supported value", async () => {
    const bindingStore = createInMemoryBindingStore();
    const availableModelIds = readAvailableModelIds("codex");
    let error: unknown;
    try {
      await ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        modelId: "gpt-test-unavailable",
        readModelCatalog: () => createCatalogWithUnavailableCodexModel(),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(
      AgentProfileBindingModelSelectionValidationError
    );
    expect(error).toMatchObject({
      code: "agent_profile_binding.model_not_supported",
    });
    if (!(error instanceof Error)) {
      throw new Error("expected model selection validation error");
    }
    expect(error.message).toBe(
      `Model "gpt-test-unavailable" is not supported for Agent Controller "builtin:codex". Supported models: ${availableModelIds.join(", ")}.`
    );
    expect(availableModelIds).not.toContain("gpt-test-unavailable");
    expect(bindingStore.records).toHaveLength(0);
  });

  it("rejects invalid Agent Controller Permission Mode on Binding writes", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        agentControllerPermissionMode: "auto-edit",
        bindingStore,
      })
    ).resolves.toMatchObject({
      reasonCodes: [
        "agent_profile_binding.agent_controller_permission_mode_invalid",
      ],
      routable: false,
      status: "rejected",
    });

    expect(bindingStore.records).toHaveLength(0);
  });

  it("rejects cross-provider Agent Controller Permission Mode on Binding writes", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        agentControllerPermissionMode: "claude-code:default",
        bindingStore,
      })
    ).resolves.toMatchObject({
      reasonCodes: [
        "agent_profile_binding.agent_controller_permission_mode_invalid",
      ],
      routable: false,
      status: "rejected",
    });

    expect(bindingStore.records).toHaveLength(0);
  });

  it("rejects unsupported-controller Agent Controller Permission Mode on Binding writes", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({ agentControllerRef: "builtin:openclaw" }),
        agentControllerPermissionMode: "codex:askForApproval",
        bindingStore,
      })
    ).resolves.toMatchObject({
      reasonCodes: [
        "agent_profile_binding.agent_controller_permission_mode_invalid",
      ],
      routable: false,
      status: "rejected",
    });

    expect(bindingStore.records).toHaveLength(0);
  });

  it("rejects invalid Agent Controller Permission Mode updates without writing default", async () => {
    const bindingStore = createInMemoryBindingStore();

    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput(),
      agentControllerPermissionMode: "codex:approveForMe",
      bindingStore,
    });

    await expect(
      updatePrimaryAgentProfileBindingAgentControllerPermissionMode({
        agentProfileId: "agent-profile-1",
        agentControllerPermissionMode: "unsupported",
        bindingStore,
        nowMs: 3000,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
      })
    ).resolves.toMatchObject({
      reasonCodes: [
        "agent_profile_binding.agent_controller_permission_mode_invalid",
      ],
      routable: false,
      status: "rejected",
    });

    expect(bindingStore.records).toHaveLength(1);
    expect(bindingStore.records[0]?.agentControllerPermissionMode).toBe(
      "codex:approveForMe"
    );
    expect(bindingStore.records[0]?.updatedAtMs).toBe(2000);
  });

  it("rejects cross-provider Agent Controller Permission Mode updates without writing", async () => {
    const bindingStore = createInMemoryBindingStore();

    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput({
        agentControllerRef: "builtin:claude-code",
      }),
      agentControllerPermissionMode: "claude-code:acceptEdits",
      bindingStore,
    });

    await expect(
      updatePrimaryAgentProfileBindingAgentControllerPermissionMode({
        agentProfileId: "agent-profile-1",
        agentControllerPermissionMode: "codex:fullAccess",
        bindingStore,
        nowMs: 3000,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
      })
    ).resolves.toMatchObject({
      reasonCodes: [
        "agent_profile_binding.agent_controller_permission_mode_invalid",
      ],
      routable: false,
      status: "rejected",
    });

    expect(bindingStore.records).toHaveLength(1);
    expect(bindingStore.records[0]?.agentControllerPermissionMode).toBe(
      "claude-code:acceptEdits"
    );
    expect(bindingStore.records[0]?.updatedAtMs).toBe(2000);
  });

  it("rejects unsupported-controller Agent Controller Permission Mode updates without writing", async () => {
    const bindingStore = createInMemoryBindingStore();

    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput({
        agentControllerRef: "builtin:openclaw",
      }),
      bindingStore,
    });

    await expect(
      updatePrimaryAgentProfileBindingAgentControllerPermissionMode({
        agentProfileId: "agent-profile-1",
        agentControllerPermissionMode: "codex:fullAccess",
        bindingStore,
        nowMs: 3000,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
      })
    ).resolves.toMatchObject({
      reasonCodes: [
        "agent_profile_binding.agent_controller_permission_mode_invalid",
      ],
      routable: false,
      status: "rejected",
    });

    expect(bindingStore.records).toHaveLength(1);
    expect(bindingStore.records[0]?.agentControllerPermissionMode).toBeNull();
    expect(bindingStore.records[0]?.updatedAtMs).toBe(2000);
  });

  it("updates Codex Collaboration Mode independently from Permission Mode", async () => {
    const bindingStore = createInMemoryBindingStore();

    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput(),
      agentControllerCollaborationMode: "codex:default",
      agentControllerPermissionMode: "codex:askForApproval",
      bindingStore,
    });

    await expect(
      updatePrimaryAgentProfileBindingAgentControllerCollaborationMode({
        agentProfileId: "agent-profile-1",
        agentControllerCollaborationMode: "codex:plan",
        bindingStore,
        nowMs: 3000,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
      })
    ).resolves.toMatchObject({
      status: "accepted",
    });

    expect(bindingStore.records).toHaveLength(1);
    expect(bindingStore.records[0]).toMatchObject({
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionMode: "codex:askForApproval",
      updatedAtMs: 3000,
    });
  });

  it("rejects Codex Collaboration Mode for a non-Codex controller", async () => {
    const bindingStore = createInMemoryBindingStore();

    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput({
        agentControllerRef: "builtin:claude-code",
      }),
      bindingStore,
    });

    await expect(
      updatePrimaryAgentProfileBindingAgentControllerCollaborationMode({
        agentProfileId: "agent-profile-1",
        agentControllerCollaborationMode: "codex:plan",
        bindingStore,
        nowMs: 3000,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
      })
    ).resolves.toMatchObject({
      reasonCodes: [
        "agent_profile_binding.agent_controller_collaboration_mode_invalid",
      ],
      routable: false,
      status: "rejected",
    });

    expect(
      bindingStore.records[0]?.agentControllerCollaborationMode
    ).toBeNull();
    expect(bindingStore.records[0]?.updatedAtMs).toBe(2000);
  });

  it("replaces a historical invalid model selection without changing the existing Binding target", async () => {
    const bindingStore = createInMemoryBindingStore();
    bindingStore.records.push({
      agentProfileId: "agent-profile-1",
      agentControllerConversationId: "codex-thread-existing",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime_other_computer",
      bindingId: "binding_existing",
      bindingState: "enabled_primary",
      createdAtMs: 1000,
      createdByProfileId: "profile-1",
      disabledAtMs: null,
      modelId: "gpt-99-historical",
      owner: OWNER,
      reasonCode: "agent_profile_binding.command_eligible",
      reasoningLevel: "ultra",
      updatedAtMs: 1000,
    });

    await expect(
      updatePrimaryAgentProfileBindingModelSelection({
        agentProfileId: "agent-profile-1",
        bindingStore,
        modelId: "gpt-5.4-mini",
        nowMs: 3000,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
        reasoningLevel: "medium",
      })
    ).resolves.toMatchObject({
      binding: {
        agentControllerConversationId: "codex-thread-existing",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_other_computer",
        bindingId: "binding_existing",
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
        updatedAtMs: 3000,
      },
      outcome: "reused",
      status: "accepted",
    });

    expect(bindingStore.records).toHaveLength(1);
  });

  it("rejects model selection updates when no primary Binding exists", async () => {
    await expect(
      updatePrimaryAgentProfileBindingModelSelection({
        agentProfileId: "agent-profile-1",
        bindingStore: createInMemoryBindingStore(),
        modelId: "gpt-5.4-mini",
        nowMs: 3000,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
      })
    ).resolves.toMatchObject({
      reasonCodes: ["agent_profile_binding.primary_missing"],
      routable: false,
      status: "rejected",
    });
  });

  it("stores and updates OpenCode permission policy on OpenCode Bindings", async () => {
    const bindingStore = createInMemoryBindingStore();
    const openCodePermission = {
      bash: {
        npm: "ask",
      },
      edit: "allow",
    } as const;

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({
          agentControllerRef: "builtin:opencode",
        }),
        bindingStore,
        openCodePermission,
      })
    ).resolves.toMatchObject({
      binding: {
        agentControllerRef: "builtin:opencode",
        bindingId: "binding_opaque_1",
        openCodePermission,
      },
      outcome: "created",
      status: "accepted",
    });

    const updatedOpenCodePermission = {
      bash: "deny",
      webfetch: "ask",
    } as const;

    await expect(
      updatePrimaryAgentProfileBindingOpenCodePermission({
        agentProfileId: "agent-profile-1",
        bindingStore,
        nowMs: 3000,
        openCodePermission: updatedOpenCodePermission,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
      })
    ).resolves.toMatchObject({
      binding: {
        openCodePermission: updatedOpenCodePermission,
        updatedAtMs: 3000,
      },
      outcome: "reused",
      status: "accepted",
    });

    await expect(
      updatePrimaryAgentProfileBindingOpenCodePermission({
        agentProfileId: "agent-profile-1",
        bindingStore,
        nowMs: 4000,
        openCodePermission: null,
        ownerAuthorization: {
          owner: OWNER,
          status: "allowed",
        },
        profileOwnerValidation: {
          owner: OWNER,
          status: "valid",
        },
      })
    ).resolves.toMatchObject({
      binding: {
        openCodePermission: null,
        updatedAtMs: 4000,
      },
      outcome: "reused",
      status: "accepted",
    });

    expect(bindingStore.records).toHaveLength(1);
  });

  it("rejects OpenCode permission policy on non-OpenCode Bindings", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({
          agentControllerRef: "builtin:codex",
        }),
        bindingStore,
        openCodePermission: {
          edit: "allow",
        },
      })
    ).resolves.toMatchObject({
      reasonCodes: ["agent_profile_binding.open_code_permission_invalid"],
      routable: false,
      status: "rejected",
    });

    expect(bindingStore.records).toHaveLength(0);
  });

  it("preserves existing model selection when same-target ensure omits model fields", async () => {
    const bindingStore = createInMemoryBindingStore();

    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput(),
      bindingStore,
      modelId: "gpt-5.5",
      reasoningLevel: "high",
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        createBindingId: () => "binding_should_not_replace_target",
        nowMs: 3000,
        readModelCatalog: () => {
          throw new Error("model catalog should not be read");
        },
      })
    ).resolves.toMatchObject({
      binding: {
        bindingId: "binding_opaque_1",
        modelId: "gpt-5.5",
        reasoningLevel: "high",
        updatedAtMs: 2000,
      },
      outcome: "reused",
      status: "accepted",
    });

    expect(bindingStore.records).toHaveLength(1);
  });

  it("preserves an existing Agent Controller Conversation ID when ensure omits it", async () => {
    const runtimeLookupInput = ownerAccountRuntimeLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const bindingStore = createInMemoryBindingStore();
    bindingStore.records.push({
      agentProfileId: "agent-profile-1",
      agentControllerConversationId: "codex-thread-existing",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      bindingId: "binding_existing",
      bindingState: "enabled_primary",
      createdAtMs: 1000,
      createdByProfileId: "profile-1",
      disabledAtMs: null,
      owner: OWNER,
      reasonCode: "agent_profile_binding.command_eligible",
      updatedAtMs: 1000,
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        }),
        bindingStore,
      })
    ).resolves.toMatchObject({
      binding: {
        agentControllerConversationId: "codex-thread-existing",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
        bindingId: "binding_existing",
      },
      outcome: "reused",
      routable: true,
      status: "accepted",
    });

    expect(bindingStore.records).toHaveLength(1);
  });

  it("does not carry a conversation ID across different Agent Controllers", async () => {
    const bindingStore = createInMemoryBindingStore();
    bindingStore.records.push({
      agentProfileId: "agent-profile-1",
      agentControllerConversationId: "claude-session-existing",
      agentControllerRef: "builtin:claude-code",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      bindingId: "binding_existing",
      bindingState: "enabled_primary",
      createdAtMs: 1000,
      createdByProfileId: "profile-1",
      disabledAtMs: null,
      owner: OWNER,
      reasonCode: "agent_profile_binding.command_eligible",
      updatedAtMs: 1000,
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
      })
    ).resolves.toMatchObject({
      existingBinding: {
        agentControllerConversationId: "claude-session-existing",
        agentControllerRef: "builtin:claude-code",
      },
      reasonCodes: ["agent_profile_binding.primary_conflict"],
      routable: false,
      status: "rejected",
    });

    expect(bindingStore.records).toHaveLength(1);
  });

  it.each([
    {
      reasonCode: "agent_profile_binding.owner_authorization_denied",
      status: "denied",
    },
    {
      reasonCode: "agent_profile_binding.owner_authorization_unknown",
      status: "unknown",
    },
    {
      reasonCode: "agent_profile_binding.owner_authorization_unavailable",
      status: "unavailable",
    },
  ] as const)("rejects owner authorization $status before writing", async ({
    reasonCode,
    status,
  }) => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        ownerAuthorization: {
          reasonCode,
          status,
        },
      })
    ).resolves.toEqual({
      reasonCodes: [reasonCode],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it.each([
    {
      reasonCode: "agent_profile_binding.profile_owner_invalid",
      status: "invalid",
    },
    {
      reasonCode: "agent_profile_binding.profile_owner_unknown",
      status: "unknown",
    },
    {
      reasonCode: "agent_profile_binding.profile_owner_unavailable",
      status: "unavailable",
    },
  ] as const)("rejects Profile owner validation $status before writing", async ({
    reasonCode,
    status,
  }) => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        profileOwnerValidation: {
          reasonCode,
          status,
        },
      })
    ).resolves.toEqual({
      reasonCodes: [reasonCode],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects lookup-derived openMeldServiceRuntimeId before writing", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "owner_account:owner-1:device-1:openmeld-dev",
        },
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects a forged opaque openMeldServiceRuntimeId that does not match Runtime Registry lookup", async () => {
    const bindingStore = createInMemoryBindingStore();
    const runtimeLookupInput = ownerAccountRuntimeLookupInput();
    const submittedRuntimeId = authorityRuntimeId({
      runtimeLookupInput,
      value: "runtime_forged",
    });
    const registeredRuntimeId = authorityRuntimeId({
      runtimeLookupInput,
      value: "runtime_registered",
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({
          openMeldServiceRuntimeId: submittedRuntimeId,
          runtimeLookupInput,
        }),
        bindingStore,
        runtimeLookupStore: createFoundRuntimeLookupStore(registeredRuntimeId),
      })
    ).resolves.toEqual({
      reasonCodes: [
        "agent_profile_binding.openmeld_service_runtime_id_mismatch",
      ],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects a missing Runtime before writing", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        runtimeLookupStore: {
          readRuntimeRecord: async () => ({
            status: "missing",
          }),
        },
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.runtime_missing"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects Runtime lookup conflicts before writing", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        runtimeLookupStore: {
          readRuntimeRecord: async () => ({
            reason: "openmeld_service_runtime_id_invalid",
            status: "conflict",
          }),
        },
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.runtime_lookup_conflict"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects auth owner mismatch with Profile owner validation before writing", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        ownerAuthorization: {
          owner: OTHER_OWNER,
          status: "allowed",
        },
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.owner_mismatch"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects Profile owner mismatch with Runtime lookup owner before writing", async () => {
    const bindingStore = createInMemoryBindingStore();
    const runtimeLookupInput = createRuntimeLookupInput({
      deviceId: "device-1",
      lane: "openmeld-dev",
      owner: OTHER_OWNER,
    });
    const openMeldServiceRuntimeId = authorityRuntimeId({
      runtimeLookupInput,
      value: "runtime_opaque_1",
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        }),
        bindingStore,
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.runtime_owner_mismatch"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects an invalid agentControllerRef before writing", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        agentControllerRef: "codex",
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects a missing Runtime Agent Controller Report before writing", async () => {
    const bindingStore = createInMemoryBindingStore();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore,
        runtimeAgentControllerReportStore: createCurrentReportStore(null),
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects a Runtime Agent Controller Report for a different openMeldServiceRuntimeId before writing", async () => {
    const bindingStore = createInMemoryBindingStore();
    const commandInput = createValidCommandInput();
    const differentRuntimeId = authorityRuntimeId({
      runtimeLookupInput: commandInput.runtimeLookupInput,
      value: "runtime_other",
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...commandInput,
        bindingStore,
        runtimeAgentControllerReportStore: createCurrentReportStore({
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.available"],
          openMeldServiceRuntimeId: differentRuntimeId,
          status: "ready",
        }),
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("rejects a stale Runtime Agent Controller Report before writing", async () => {
    const bindingStore = createInMemoryBindingStore();
    const commandInput = createValidCommandInput();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...commandInput,
        bindingStore,
        runtimeAgentControllerReportStore: createCurrentReportStore({
          agentControllerRef: "builtin:codex",
          expiresAtMs: 2000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.available"],
          openMeldServiceRuntimeId: commandInput.openMeldServiceRuntimeId,
          status: "ready",
        }),
      })
    ).resolves.toEqual({
      reasonCodes: ["agent_profile_binding.agent_controller_report_stale"],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it.each([
    {
      expectedReasonCode:
        "agent_profile_binding.agent_controller_report_disabled",
      status: "disabled",
    },
    {
      expectedReasonCode:
        "agent_profile_binding.agent_controller_report_unavailable",
      status: "unavailable",
    },
    {
      expectedReasonCode:
        "agent_profile_binding.agent_controller_report_unavailable",
      status: "unknown",
    },
  ] as const)("rejects a $status Runtime Agent Controller Report before writing", async ({
    expectedReasonCode,
    status,
  }) => {
    const bindingStore = createInMemoryBindingStore();
    const commandInput = createValidCommandInput();

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...commandInput,
        bindingStore,
        runtimeAgentControllerReportStore: createCurrentReportStore({
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: [`runtime.agent_controller_report.${status}`],
          openMeldServiceRuntimeId: commandInput.openMeldServiceRuntimeId,
          status,
        }),
      })
    ).resolves.toEqual({
      reasonCodes: [expectedReasonCode],
      routable: false,
      status: "rejected",
    });
    expect(bindingStore.records).toEqual([]);
  });

  it("returns primary conflict without silently replacing an existing Binding target", async () => {
    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore: {
          readPrimaryBinding: async () => null,
          ensurePrimaryBinding: async ({ record }) => ({
            existingBinding: {
              ...record,
              bindingId: "binding_existing",
              bindingState: "enabled_primary",
              agentControllerRef: "builtin:claude-code",
              disabledAtMs: null,
              openMeldServiceRuntimeId: "runtime_existing",
            },
            reason: "primary_conflict",
            status: "rejected",
          }),
          reconnectPrimaryBinding: async ({ record }) => ({
            binding: {
              ...record,
              bindingState: "enabled_primary",
              disabledAtMs: null,
            },
            outcome: "reconnected",
            status: "accepted",
          }),
          updatePrimaryBindingAgentControllerCollaborationMode: async () => ({
            binding: null,
            status: "missing",
          }),
          updatePrimaryBindingAgentControllerPermissionMode: async () => ({
            binding: null,
            status: "missing",
          }),
          updatePrimaryBindingModelSelection: async () => ({
            binding: null,
            status: "missing",
          }),
          updatePrimaryBindingOpenCodePermission: async () => ({
            binding: null,
            status: "missing",
          }),
        },
      })
    ).resolves.toEqual({
      existingBinding: expect.objectContaining({
        bindingId: "binding_existing",
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime_existing",
      }),
      reasonCodes: ["agent_profile_binding.primary_conflict"],
      routable: false,
      status: "rejected",
    });
  });

  it("returns controller conversation conflict when the requested conversation belongs to another Agent Profile", async () => {
    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput(),
        bindingStore: {
          readPrimaryBinding: async () => null,
          ensurePrimaryBinding: async ({ record }) => ({
            existingBinding: {
              ...record,
              agentProfileId: "agent-profile-2",
              bindingId: "binding_existing",
              bindingState: "enabled_primary",
              disabledAtMs: null,
            },
            reason: "controller_conversation_conflict",
            status: "rejected",
          }),
          reconnectPrimaryBinding: async ({ record }) => ({
            binding: {
              ...record,
              bindingState: "enabled_primary",
              disabledAtMs: null,
            },
            outcome: "reconnected",
            status: "accepted",
          }),
          updatePrimaryBindingAgentControllerCollaborationMode: async () => ({
            binding: null,
            status: "missing",
          }),
          updatePrimaryBindingAgentControllerPermissionMode: async () => ({
            binding: null,
            status: "missing",
          }),
          updatePrimaryBindingModelSelection: async () => ({
            binding: null,
            status: "missing",
          }),
          updatePrimaryBindingOpenCodePermission: async () => ({
            binding: null,
            status: "missing",
          }),
        },
        agentControllerConversationId: "ctx-shared",
      })
    ).resolves.toEqual({
      existingBinding: expect.objectContaining({
        agentProfileId: "agent-profile-2",
        bindingId: "binding_existing",
      }),
      reasonCodes: ["agent_profile_binding.controller_conversation_conflict"],
      routable: false,
      status: "rejected",
    });
  });

  it("reconnects an existing Binding target only when reconnect mode is explicit", async () => {
    const bindingStore = createInMemoryBindingStore();
    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput({
        openMeldServiceRuntimeId: authorityRuntimeId({
          runtimeLookupInput: ownerAccountRuntimeLookupInput(),
          value: "runtime_existing",
        }),
      }),
      bindingStore,
      agentControllerRef: "builtin:claude-code",
      createBindingId: () => "binding_existing",
      runtimeAgentControllerReportStore: createCurrentReportStore({
        agentControllerRef: "builtin:claude-code",
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId: authorityRuntimeId({
          runtimeLookupInput: ownerAccountRuntimeLookupInput(),
          value: "runtime_existing",
        }),
        status: "ready",
      }),
    });

    const runtimeLookupInput = ownerAccountRuntimeLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      runtimeLookupInput,
      value: "runtime_opaque_1",
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({
          openMeldServiceRuntimeId,
          runtimeLookupInput,
        }),
        bindingStore,
        writeMode: "reconnect",
      })
    ).resolves.toMatchObject({
      binding: {
        bindingId: "binding_opaque_1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      },
      outcome: "reconnected",
      routable: true,
      status: "accepted",
    });

    expect(bindingStore.records).toEqual([
      expect.objectContaining({
        bindingId: "binding_existing",
        bindingState: "disabled_historical",
      }),
      expect.objectContaining({
        bindingId: "binding_opaque_1",
        bindingState: "enabled_primary",
      }),
    ]);
  });

  it("preserves controller settings when reconnecting the same controller to a new runtime", async () => {
    const bindingStore = createInMemoryBindingStore();
    const runtimeLookupInput = ownerAccountRuntimeLookupInput();
    const previousRuntimeId = authorityRuntimeId({
      runtimeLookupInput,
      value: "runtime_previous",
    });

    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput({
        runtimeLookupInput,
        openMeldServiceRuntimeId: previousRuntimeId,
      }),
      agentControllerCollaborationMode: "codex:plan",
      agentControllerPermissionMode: "codex:customConfig",
      bindingStore,
      createBindingId: () => "binding_previous",
      modelId: "gpt-5.6-sol",
      reasoningLevel: "ultra",
    });

    const currentRuntimeId = authorityRuntimeId({
      runtimeLookupInput,
      value: "runtime_current",
    });
    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({
          runtimeLookupInput,
          openMeldServiceRuntimeId: currentRuntimeId,
        }),
        bindingStore,
        createBindingId: () => "binding_current",
        nowMs: 3000,
        writeMode: "reconnect",
      })
    ).resolves.toMatchObject({
      binding: {
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:customConfig",
        agentControllerRef: "builtin:codex",
        bindingId: "binding_current",
        modelId: "gpt-5.6-sol",
        reasoningLevel: "ultra",
        openMeldServiceRuntimeId: "runtime_current",
      },
      outcome: "reconnected",
      status: "accepted",
    });

    const openCodeBindingStore = createInMemoryBindingStore();
    const openCodePermission = {
      bash: { npm: "ask" },
      edit: "allow",
    } as const;
    await ensurePrimaryAgentProfileBinding({
      ...createValidCommandInput({
        agentControllerRef: "builtin:opencode",
        runtimeLookupInput,
        openMeldServiceRuntimeId: previousRuntimeId,
      }),
      bindingStore: openCodeBindingStore,
      createBindingId: () => "binding_opencode_previous",
      openCodePermission,
    });

    await expect(
      ensurePrimaryAgentProfileBinding({
        ...createValidCommandInput({
          agentControllerRef: "builtin:opencode",
          runtimeLookupInput,
          openMeldServiceRuntimeId: currentRuntimeId,
        }),
        bindingStore: openCodeBindingStore,
        createBindingId: () => "binding_opencode_current",
        nowMs: 3000,
        writeMode: "reconnect",
      })
    ).resolves.toMatchObject({
      binding: {
        agentControllerRef: "builtin:opencode",
        bindingId: "binding_opencode_current",
        openCodePermission,
        openMeldServiceRuntimeId: "runtime_current",
      },
      outcome: "reconnected",
      status: "accepted",
    });
  });
});

function ownerAccountRuntimeLookupInput(): RuntimeLookupInput {
  return createRuntimeLookupInput({
    deviceId: "device-1",
    lane: "openmeld-dev",
    owner: {
      id: OWNER.id,
      kind: OWNER.kind,
    },
  });
}

function createFoundRuntimeLookupStore(
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId
): RuntimeLookupStore {
  return {
    readRuntimeRecord: async () => ({
      openMeldServiceRuntimeId,
      status: "found",
    }),
  };
}

function createCurrentReportStore(
  report: Awaited<
    ReturnType<RuntimeAgentControllerReportReadStore["readCurrentReport"]>
  >
): RuntimeAgentControllerReportReadStore {
  return {
    readCurrentReport: async () => report,
  };
}

function authorityRuntimeId(input: {
  runtimeLookupInput: RuntimeLookupInput;
  value: string;
}): AuthorityOpenMeldServiceRuntimeId {
  return createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: input.runtimeLookupInput,
    openMeldServiceRuntimeId: input.value,
    source: "runtime_registry_authority",
  });
}

function createValidCommandInput(input?: {
  agentControllerRef?: string;
  openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput?: RuntimeLookupInput;
}): Parameters<typeof ensurePrimaryAgentProfileBinding>[0] {
  const agentControllerRef = input?.agentControllerRef ?? "builtin:codex";
  const runtimeLookupInput =
    input?.runtimeLookupInput ?? ownerAccountRuntimeLookupInput();
  const openMeldServiceRuntimeId =
    input?.openMeldServiceRuntimeId ??
    authorityRuntimeId({
      runtimeLookupInput,
      value: "runtime_opaque_1",
    });
  return {
    agentProfileId: "agent-profile-1",
    bindingStore: createInMemoryBindingStore(),
    agentControllerRef,
    createBindingId: () => "binding_opaque_1",
    createdByProfileId: "profile-1",
    nowMs: 2000,
    ownerAuthorization: {
      owner: OWNER,
      status: "allowed",
    },
    profileOwnerValidation: {
      owner: OWNER,
      status: "valid",
    },
    runtimeAgentControllerReportStore: createCurrentReportStore({
      agentControllerRef,
      expiresAtMs: 5000,
      observedAtMs: 1000,
      reasonCodes: ["runtime.agent_controller_report.available"],
      openMeldServiceRuntimeId,
      status: "ready",
    }),
    openMeldServiceRuntimeId,
    runtimeLookupInput,
    runtimeLookupStore: createFoundRuntimeLookupStore(openMeldServiceRuntimeId),
  };
}

function createCatalogWithUnavailableCodexModel(): ModelCatalog {
  const catalog = readModelCatalog();
  const codexCatalog = catalog.agentControllers.codex;
  if (!codexCatalog) {
    throw new Error("Codex model catalog is required by this test fixture");
  }
  return modelCatalogSchema.parse({
    ...catalog,
    agentControllers: {
      ...catalog.agentControllers,
      codex: {
        ...codexCatalog,
        models: [
          ...codexCatalog.models,
          {
            id: "gpt-test-unavailable",
            displayName: "GPT Test Unavailable",
            unavailable: true,
            supportedReasoningLevels: ["low"],
            minCliVersion: null,
          },
        ],
      },
    },
  });
}

function createInMemoryBindingStore(): AgentProfileBindingCommandStore & {
  records: Array<
    Parameters<
      AgentProfileBindingCommandStore["ensurePrimaryBinding"]
    >[0]["record"] & {
      bindingState: "enabled_primary" | "disabled_historical";
      disabledAtMs: number | null;
    }
  >;
} {
  const records: Array<
    Parameters<
      AgentProfileBindingCommandStore["ensurePrimaryBinding"]
    >[0]["record"] & {
      bindingState: "enabled_primary" | "disabled_historical";
      disabledAtMs: number | null;
    }
  > = [];

  return {
    records,
    readPrimaryBinding: ({ agentProfileId, owner }) =>
      Promise.resolve(
        records.find(
          (candidate) =>
            candidate.owner.kind === owner.kind &&
            candidate.owner.id === owner.id &&
            candidate.agentProfileId === agentProfileId &&
            candidate.bindingState === "enabled_primary"
        ) ?? null
      ),
    ensurePrimaryBinding: ({
      agentControllerPermissionModePatch,
      modelSelectionPatch,
      openCodePermissionPatch,
      record,
    }) => {
      const current = records.find(
        (candidate) =>
          candidate.owner.kind === record.owner.kind &&
          candidate.owner.id === record.owner.id &&
          candidate.agentProfileId === record.agentProfileId &&
          candidate.bindingState === "enabled_primary"
      );
      if (current) {
        if (bindingTargetsEqual(current, record)) {
          if (modelSelectionPatch) {
            updateStoredModelSelection(current, modelSelectionPatch, {
              updatedAtMs: record.updatedAtMs,
            });
          }
          if (agentControllerPermissionModePatch) {
            updateStoredAgentControllerPermissionMode(
              current,
              agentControllerPermissionModePatch,
              {
                updatedAtMs: record.updatedAtMs,
              }
            );
          }
          if (openCodePermissionPatch) {
            updateStoredOpenCodePermission(current, openCodePermissionPatch, {
              updatedAtMs: record.updatedAtMs,
            });
          }
          return Promise.resolve({
            binding: current,
            outcome: "reused",
            status: "accepted",
          });
        }
        return Promise.resolve({
          existingBinding: current,
          reason: "primary_conflict",
          status: "rejected",
        });
      }
      const binding = {
        ...record,
        bindingState: "enabled_primary" as const,
        disabledAtMs: null,
      };
      records.push(binding);
      return Promise.resolve({
        binding,
        outcome: "created",
        status: "accepted",
      });
    },
    reconnectPrimaryBinding: ({
      agentControllerPermissionModePatch,
      modelSelectionPatch,
      openCodePermissionPatch,
      record,
    }) => {
      const current = records.find(
        (candidate) =>
          candidate.owner.kind === record.owner.kind &&
          candidate.owner.id === record.owner.id &&
          candidate.agentProfileId === record.agentProfileId &&
          candidate.bindingState === "enabled_primary"
      );
      if (current) {
        if (bindingTargetsEqual(current, record)) {
          if (modelSelectionPatch) {
            updateStoredModelSelection(current, modelSelectionPatch, {
              updatedAtMs: record.updatedAtMs,
            });
          }
          if (agentControllerPermissionModePatch) {
            updateStoredAgentControllerPermissionMode(
              current,
              agentControllerPermissionModePatch,
              {
                updatedAtMs: record.updatedAtMs,
              }
            );
          }
          if (openCodePermissionPatch) {
            updateStoredOpenCodePermission(current, openCodePermissionPatch, {
              updatedAtMs: record.updatedAtMs,
            });
          }
          return Promise.resolve({
            binding: current,
            outcome: "reused",
            status: "accepted",
          });
        }
        current.bindingState = "disabled_historical";
        current.disabledAtMs = record.updatedAtMs;
      }
      const binding = {
        ...record,
        bindingState: "enabled_primary" as const,
        disabledAtMs: null,
      };
      records.push(binding);
      return Promise.resolve({
        binding,
        outcome: current ? "reconnected" : "created",
        status: "accepted",
      });
    },
    updatePrimaryBindingModelSelection: ({
      agentProfileId,
      modelSelectionPatch,
      owner,
      updatedAtMs,
    }) => {
      const current = records.find(
        (candidate) =>
          candidate.owner.kind === owner.kind &&
          candidate.owner.id === owner.id &&
          candidate.agentProfileId === agentProfileId &&
          candidate.bindingState === "enabled_primary"
      );
      if (!current) {
        return Promise.resolve({ binding: null, status: "missing" });
      }
      updateStoredModelSelection(current, modelSelectionPatch, {
        updatedAtMs,
      });
      return Promise.resolve({ binding: current, status: "updated" });
    },
    updatePrimaryBindingAgentControllerPermissionMode: ({
      agentProfileId,
      agentControllerPermissionModePatch,
      owner,
      updatedAtMs,
    }) => {
      const current = records.find(
        (candidate) =>
          candidate.owner.kind === owner.kind &&
          candidate.owner.id === owner.id &&
          candidate.agentProfileId === agentProfileId &&
          candidate.bindingState === "enabled_primary"
      );
      if (!current) {
        return Promise.resolve({ binding: null, status: "missing" });
      }
      updateStoredAgentControllerPermissionMode(
        current,
        agentControllerPermissionModePatch,
        { updatedAtMs }
      );
      return Promise.resolve({ binding: current, status: "updated" });
    },
    updatePrimaryBindingAgentControllerCollaborationMode: ({
      agentProfileId,
      agentControllerCollaborationModePatch,
      owner,
      updatedAtMs,
    }) => {
      const current = records.find(
        (candidate) =>
          candidate.owner.kind === owner.kind &&
          candidate.owner.id === owner.id &&
          candidate.agentProfileId === agentProfileId &&
          candidate.bindingState === "enabled_primary"
      );
      if (!current) {
        return Promise.resolve({ binding: null, status: "missing" });
      }
      updateStoredAgentControllerCollaborationMode(
        current,
        agentControllerCollaborationModePatch,
        { updatedAtMs }
      );
      return Promise.resolve({ binding: current, status: "updated" });
    },
    updatePrimaryBindingOpenCodePermission: ({
      agentProfileId,
      openCodePermissionPatch,
      owner,
      updatedAtMs,
    }) => {
      const current = records.find(
        (candidate) =>
          candidate.owner.kind === owner.kind &&
          candidate.owner.id === owner.id &&
          candidate.agentProfileId === agentProfileId &&
          candidate.bindingState === "enabled_primary"
      );
      if (!current) {
        return Promise.resolve({ binding: null, status: "missing" });
      }
      updateStoredOpenCodePermission(current, openCodePermissionPatch, {
        updatedAtMs,
      });
      return Promise.resolve({ binding: current, status: "updated" });
    },
  };
}

function bindingTargetsEqual(
  left: Parameters<
    AgentProfileBindingCommandStore["ensurePrimaryBinding"]
  >[0]["record"],
  right: Parameters<
    AgentProfileBindingCommandStore["ensurePrimaryBinding"]
  >[0]["record"]
): boolean {
  return (
    left.openMeldServiceRuntimeId === right.openMeldServiceRuntimeId &&
    left.agentControllerRef === right.agentControllerRef &&
    normalizeNullableText(left.agentControllerConversationId) ===
      normalizeNullableText(right.agentControllerConversationId)
  );
}

function updateStoredModelSelection(
  current: Parameters<
    AgentProfileBindingCommandStore["ensurePrimaryBinding"]
  >[0]["record"],
  modelSelectionPatch: NonNullable<
    Parameters<
      AgentProfileBindingCommandStore["ensurePrimaryBinding"]
    >[0]["modelSelectionPatch"]
  >,
  options?: {
    updatedAtMs?: number;
  }
): void {
  current.modelId = normalizeNullableText(modelSelectionPatch.modelId);
  current.reasoningLevel = current.modelId
    ? normalizeNullableText(modelSelectionPatch.reasoningLevel)
    : null;
  if (options?.updatedAtMs !== undefined) {
    current.updatedAtMs = options.updatedAtMs;
  }
}

function updateStoredAgentControllerPermissionMode(
  current: Parameters<
    AgentProfileBindingCommandStore["ensurePrimaryBinding"]
  >[0]["record"],
  agentControllerPermissionModePatch: NonNullable<
    Parameters<
      AgentProfileBindingCommandStore["ensurePrimaryBinding"]
    >[0]["agentControllerPermissionModePatch"]
  >,
  options?: {
    updatedAtMs?: number;
  }
): void {
  current.agentControllerPermissionMode =
    agentControllerPermissionModePatch.agentControllerPermissionMode;
  if (options?.updatedAtMs !== undefined) {
    current.updatedAtMs = options.updatedAtMs;
  }
}

function updateStoredAgentControllerCollaborationMode(
  current: Parameters<
    AgentProfileBindingCommandStore["ensurePrimaryBinding"]
  >[0]["record"],
  agentControllerCollaborationModePatch: NonNullable<
    Parameters<
      AgentProfileBindingCommandStore["ensurePrimaryBinding"]
    >[0]["agentControllerCollaborationModePatch"]
  >,
  options?: {
    updatedAtMs?: number;
  }
): void {
  current.agentControllerCollaborationMode =
    agentControllerCollaborationModePatch.agentControllerCollaborationMode;
  if (options?.updatedAtMs !== undefined) {
    current.updatedAtMs = options.updatedAtMs;
  }
}

function updateStoredOpenCodePermission(
  current: Parameters<
    AgentProfileBindingCommandStore["ensurePrimaryBinding"]
  >[0]["record"],
  openCodePermissionPatch: NonNullable<
    Parameters<
      AgentProfileBindingCommandStore["ensurePrimaryBinding"]
    >[0]["openCodePermissionPatch"]
  >,
  options?: {
    updatedAtMs?: number;
  }
): void {
  current.openCodePermission = openCodePermissionPatch.openCodePermission;
  if (options?.updatedAtMs !== undefined) {
    current.updatedAtMs = options.updatedAtMs;
  }
}

function normalizeNullableText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
