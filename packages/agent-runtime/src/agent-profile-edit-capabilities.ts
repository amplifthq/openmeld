import type { ModelCatalog, ModelCatalogModel } from "@openmeld/schemas/types";
import {
  type AgentControllerCollaborationModeOption,
  listAgentControllerCollaborationModeOptions,
} from "./agent-controller-collaboration-mode";
import {
  type AgentControllerPermissionModeOption,
  listAgentControllerPermissionModeOptions,
} from "./agent-controller-permission-mode";
import { parseAgentControllerRef } from "./agent-controller-ref";

export type AgentProfileEditUnavailableReason =
  | "agent_controller_not_found"
  | "invalid_agent_controller_ref"
  | "model_catalog_unavailable"
  | "no_models"
  | "not_supported";

export type AgentProfileRenameEditCapability = {
  editable: true;
  field: "profileName";
  target: "profile";
};

export type AgentProfileModelSelectionEditCapability = {
  editable: boolean;
  models: ModelCatalogModel[];
  source: "model_catalog";
  unavailableReason?: AgentProfileEditUnavailableReason;
};

export type AgentProfileReasoningLevelModelCapability = {
  editable: boolean;
  levels: string[];
  modelId: string;
};

export type AgentProfileReasoningLevelEditCapability = {
  editable: boolean;
  models: AgentProfileReasoningLevelModelCapability[];
  source: "model_catalog";
  unavailableReason?: AgentProfileEditUnavailableReason;
};

export type AgentProfilePermissionModeEditCapability = {
  editable: boolean;
  options: AgentControllerPermissionModeOption[];
  source: "agent_controller_permission_mode_options";
  unavailableReason?: AgentProfileEditUnavailableReason;
};

export type AgentProfileCollaborationModeEditCapability = {
  editable: boolean;
  options: AgentControllerCollaborationModeOption[];
  source: "agent_controller_collaboration_mode_options";
  unavailableReason?: AgentProfileEditUnavailableReason;
};

export type AgentProfileControllerChangeEditCapability = {
  editable: true;
  fieldPatch: false;
  operation: "ensurePrimaryBinding";
  semantics: "rebind";
};

export type AgentProfileEditCapabilities = {
  collaborationMode: AgentProfileCollaborationModeEditCapability;
  controllerChange: AgentProfileControllerChangeEditCapability;
  modelSelection: AgentProfileModelSelectionEditCapability;
  permissionMode: AgentProfilePermissionModeEditCapability;
  reasoningLevel: AgentProfileReasoningLevelEditCapability;
  rename: AgentProfileRenameEditCapability;
};

export function resolveAgentProfileEditCapabilities(input: {
  agentControllerRef: string;
  modelCatalog: ModelCatalog | null;
}): AgentProfileEditCapabilities {
  const parsedRef = parseAgentControllerRef(input.agentControllerRef);
  const unavailableReason = resolveModelCatalogUnavailableReason({
    hasCatalog: input.modelCatalog !== null,
    hasParsedRef: parsedRef !== null,
    hasController: parsedRef
      ? Object.hasOwn(input.modelCatalog?.agentControllers ?? {}, parsedRef.id)
      : false,
  });
  const controller =
    parsedRef && input.modelCatalog
      ? (input.modelCatalog.agentControllers[parsedRef.id] ?? null)
      : null;
  const models = (controller?.models ?? [])
    .filter((model) => !model.unavailable)
    .map(cloneModelCatalogModel);
  const modelSelectionUnavailableReason =
    unavailableReason ?? (models.length === 0 ? "no_models" : undefined);
  const reasoningLevelModels = models.map((model) => {
    const levels = [...model.supportedReasoningLevels];
    return {
      editable: levels.length > 0,
      levels,
      modelId: model.id,
    };
  });
  const permissionModeOptions = listAgentControllerPermissionModeOptions({
    agentControllerRef: input.agentControllerRef,
  });
  const collaborationModeOptions = listAgentControllerCollaborationModeOptions({
    agentControllerRef: input.agentControllerRef,
  });

  return {
    collaborationMode: {
      editable: collaborationModeOptions.length > 0,
      options: collaborationModeOptions,
      source: "agent_controller_collaboration_mode_options",
      ...(collaborationModeOptions.length === 0
        ? { unavailableReason: "not_supported" }
        : {}),
    },
    rename: {
      editable: true,
      field: "profileName",
      target: "profile",
    },
    modelSelection: {
      editable: modelSelectionUnavailableReason === undefined,
      models,
      source: "model_catalog",
      ...(modelSelectionUnavailableReason
        ? { unavailableReason: modelSelectionUnavailableReason }
        : {}),
    },
    reasoningLevel: {
      editable: reasoningLevelModels.some((model) => model.editable),
      models: reasoningLevelModels,
      source: "model_catalog",
      ...(reasoningLevelModels.length === 0
        ? {
            unavailableReason:
              modelSelectionUnavailableReason ?? "not_supported",
          }
        : {}),
    },
    permissionMode: {
      editable: permissionModeOptions.length > 0,
      options: permissionModeOptions,
      source: "agent_controller_permission_mode_options",
      ...(permissionModeOptions.length === 0
        ? { unavailableReason: "not_supported" }
        : {}),
    },
    controllerChange: {
      editable: true,
      fieldPatch: false,
      operation: "ensurePrimaryBinding",
      semantics: "rebind",
    },
  };
}

function resolveModelCatalogUnavailableReason(input: {
  hasCatalog: boolean;
  hasController: boolean;
  hasParsedRef: boolean;
}): AgentProfileEditUnavailableReason | undefined {
  if (!input.hasParsedRef) {
    return "invalid_agent_controller_ref";
  }
  if (!input.hasCatalog) {
    return "model_catalog_unavailable";
  }
  if (!input.hasController) {
    return "agent_controller_not_found";
  }
  return undefined;
}

function cloneModelCatalogModel(model: ModelCatalogModel): ModelCatalogModel {
  return {
    ...model,
    supportedReasoningLevels: [...model.supportedReasoningLevels],
  };
}
