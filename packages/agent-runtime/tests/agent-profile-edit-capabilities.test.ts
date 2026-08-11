import type { ModelCatalog } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  listAgentControllerCollaborationModeOptions,
  listAgentControllerPermissionModeOptions,
  resolveAgentProfileEditCapabilities,
} from "../src";

const CATALOG: ModelCatalog = {
  schemaVersion: 1,
  updatedAt: "2026-07-06T00:00:00.000Z",
  agentControllers: {
    "claude-code": {
      defaultModelId: "claude-opus-4-8",
      models: [
        {
          id: "claude-opus-4-8",
          displayName: "Claude Opus 4.8",
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high"],
          minCliVersion: null,
        },
        {
          id: "claude-retired",
          displayName: "Claude Retired",
          unavailable: true,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
        },
      ],
    },
    codex: {
      defaultModelId: "gpt-5.5",
      models: [
        {
          id: "gpt-5.5",
          displayName: "GPT-5.5",
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
          minCliVersion: null,
        },
        {
          id: "gpt-5.4-mini",
          displayName: "GPT-5.4 Mini",
          unavailable: false,
          supportedReasoningLevels: [],
          minCliVersion: null,
        },
      ],
    },
    cursor: {
      defaultModelId: "default[]",
      models: [
        {
          id: "default[]",
          displayName: "Auto",
          unavailable: false,
          supportedReasoningLevels: [],
          minCliVersion: null,
        },
      ],
    },
    opencode: {
      defaultModelId: "opencode-local",
      models: [
        {
          id: "opencode-local",
          displayName: "OpenCode Local",
          unavailable: false,
          supportedReasoningLevels: [],
          minCliVersion: null,
        },
      ],
    },
    openclaw: {
      defaultModelId: "openclaw-local",
      models: [],
    },
  },
};

describe("resolveAgentProfileEditCapabilities", () => {
  it("resolves claude-code edit capabilities from the permission resolver and model catalog", () => {
    const capabilities = resolveAgentProfileEditCapabilities({
      agentControllerRef: "builtin:claude-code",
      modelCatalog: CATALOG,
    });

    expect(capabilities.rename).toEqual({
      editable: true,
      field: "profileName",
      target: "profile",
    });
    expect(capabilities.modelSelection).toMatchObject({
      editable: true,
      source: "model_catalog",
    });
    expect(capabilities.modelSelection.models.map((model) => model.id)).toEqual(
      ["claude-opus-4-8"]
    );
    expect(capabilities.reasoningLevel).toEqual({
      editable: true,
      source: "model_catalog",
      models: [
        {
          editable: true,
          levels: ["low", "medium", "high"],
          modelId: "claude-opus-4-8",
        },
      ],
    });
    expect(capabilities.permissionMode).toMatchObject({
      editable: true,
      source: "agent_controller_permission_mode_options",
      options: listAgentControllerPermissionModeOptions({
        agentControllerRef: "builtin:claude-code",
      }),
    });
    expect(capabilities.controllerChange).toEqual({
      editable: true,
      fieldPatch: false,
      operation: "ensurePrimaryBinding",
      semantics: "rebind",
    });
  });

  it("resolves codex model and per-model reasoning capabilities", () => {
    const capabilities = resolveAgentProfileEditCapabilities({
      agentControllerRef: "builtin:codex",
      modelCatalog: CATALOG,
    });

    expect(capabilities.modelSelection.models.map((model) => model.id)).toEqual(
      ["gpt-5.5", "gpt-5.4-mini"]
    );
    expect(capabilities.reasoningLevel).toEqual({
      editable: true,
      source: "model_catalog",
      models: [
        {
          editable: true,
          levels: ["low", "medium", "high", "xhigh"],
          modelId: "gpt-5.5",
        },
        {
          editable: false,
          levels: [],
          modelId: "gpt-5.4-mini",
        },
      ],
    });
    expect(capabilities.permissionMode.options).toEqual(
      listAgentControllerPermissionModeOptions({
        agentControllerRef: "builtin:codex",
      })
    );
    expect(capabilities.collaborationMode).toEqual({
      editable: true,
      options: listAgentControllerCollaborationModeOptions({
        agentControllerRef: "builtin:codex",
      }),
      source: "agent_controller_collaboration_mode_options",
    });
  });

  it("keeps opencode permission mode fail-closed while allowing catalog-backed model selection", () => {
    const capabilities = resolveAgentProfileEditCapabilities({
      agentControllerRef: "builtin:opencode",
      modelCatalog: CATALOG,
    });

    expect(capabilities.modelSelection).toMatchObject({
      editable: true,
      source: "model_catalog",
    });
    expect(capabilities.reasoningLevel).toEqual({
      editable: false,
      source: "model_catalog",
      models: [
        {
          editable: false,
          levels: [],
          modelId: "opencode-local",
        },
      ],
    });
    expect(capabilities.permissionMode).toEqual({
      editable: false,
      options: [],
      source: "agent_controller_permission_mode_options",
      unavailableReason: "not_supported",
    });
  });

  it("supports Cursor ACP model and permission selection without inventing an independent reasoning control", () => {
    const capabilities = resolveAgentProfileEditCapabilities({
      agentControllerRef: "builtin:cursor",
      modelCatalog: CATALOG,
    });

    expect(capabilities.modelSelection).toMatchObject({
      editable: true,
      models: [{ displayName: "Auto", id: "default[]" }],
    });
    expect(capabilities.reasoningLevel).toEqual({
      editable: false,
      source: "model_catalog",
      models: [
        {
          editable: false,
          levels: [],
          modelId: "default[]",
        },
      ],
    });
    expect(capabilities.permissionMode.options).toEqual(
      listAgentControllerPermissionModeOptions({
        agentControllerRef: "builtin:cursor",
      })
    );
  });

  it("keeps openclaw model and permission mode fail-closed when the catalog has no models", () => {
    const capabilities = resolveAgentProfileEditCapabilities({
      agentControllerRef: "builtin:openclaw",
      modelCatalog: CATALOG,
    });

    expect(capabilities.modelSelection).toEqual({
      editable: false,
      models: [],
      source: "model_catalog",
      unavailableReason: "no_models",
    });
    expect(capabilities.reasoningLevel).toEqual({
      editable: false,
      models: [],
      source: "model_catalog",
      unavailableReason: "no_models",
    });
    expect(capabilities.permissionMode.editable).toBe(false);
    expect(capabilities.collaborationMode).toEqual({
      editable: false,
      options: [],
      source: "agent_controller_collaboration_mode_options",
      unavailableReason: "not_supported",
    });
  });

  it("fails closed for unknown controllers and missing catalogs", () => {
    const unknown = resolveAgentProfileEditCapabilities({
      agentControllerRef: "builtin:unknown",
      modelCatalog: CATALOG,
    });
    const missingCatalog = resolveAgentProfileEditCapabilities({
      agentControllerRef: "builtin:codex",
      modelCatalog: null,
    });

    expect(unknown.rename.editable).toBe(true);
    expect(unknown.modelSelection).toEqual({
      editable: false,
      models: [],
      source: "model_catalog",
      unavailableReason: "agent_controller_not_found",
    });
    expect(unknown.reasoningLevel).toEqual({
      editable: false,
      models: [],
      source: "model_catalog",
      unavailableReason: "agent_controller_not_found",
    });
    expect(unknown.permissionMode.editable).toBe(false);
    expect(unknown.collaborationMode.editable).toBe(false);
    expect(unknown.controllerChange).toMatchObject({
      editable: true,
      operation: "ensurePrimaryBinding",
      semantics: "rebind",
    });

    expect(missingCatalog.modelSelection).toEqual({
      editable: false,
      models: [],
      source: "model_catalog",
      unavailableReason: "model_catalog_unavailable",
    });
    expect(missingCatalog.reasoningLevel).toEqual({
      editable: false,
      models: [],
      source: "model_catalog",
      unavailableReason: "model_catalog_unavailable",
    });
    expect(missingCatalog.permissionMode.options).toEqual(
      listAgentControllerPermissionModeOptions({
        agentControllerRef: "builtin:codex",
      })
    );
    expect(missingCatalog.collaborationMode.editable).toBe(true);
  });
});
