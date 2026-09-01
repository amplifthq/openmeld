import type { ConversationPolicy, ModelCatalog } from "@openmeld/schemas/types";
import { parseAgentControllerRef } from "./agent-controller-ref";
import {
  type AgentProfileBindingModelSelectionInput,
  createAgentProfileBindingModelSelection,
} from "./agent-profile-binding";

export type ConversationPolicyResolution = {
  status: "accepted";
  conversationPolicy: ConversationPolicy;
};

export function resolveConversationPolicyFromModelSelection(input: {
  agentControllerConversationId?: string | null;
  agentControllerRef: string;
  catalog: ModelCatalog;
  modelSelection?: AgentProfileBindingModelSelectionInput | null;
}): ConversationPolicyResolution {
  const selection = createAgentProfileBindingModelSelection(
    input.modelSelection
  );
  const parsedRef = parseAgentControllerRef(input.agentControllerRef);
  if (!parsedRef) {
    return {
      status: "accepted",
      conversationPolicy: {},
    };
  }
  const controller = input.catalog.agentControllers[parsedRef.id];
  if (!controller) {
    return {
      status: "accepted",
      conversationPolicy: {},
    };
  }

  const availableModels = controller.models.filter(
    (model) => !model.unavailable
  );
  const defaultModel =
    availableModels.find((model) => model.id === controller.defaultModelId) ??
    availableModels[0] ??
    null;
  if (!defaultModel) {
    return {
      status: "accepted",
      conversationPolicy: {},
    };
  }

  if (!selection) {
    if (
      parsedRef.kind === "builtin" &&
      parsedRef.id === "codex" &&
      normalizeOptionalText(input.agentControllerConversationId)
    ) {
      return {
        status: "accepted",
        conversationPolicy: {},
      };
    }
    return {
      status: "accepted",
      conversationPolicy: {
        fallbackModel: defaultModel.id,
        model: defaultModel.id,
      },
    };
  }

  const selectedModel =
    availableModels.find((model) => model.id === selection.modelId) ?? null;
  const model = selectedModel ?? defaultModel;
  const reasoningLevel =
    selectedModel &&
    selection.reasoningLevel &&
    selectedModel.supportedReasoningLevels.includes(selection.reasoningLevel)
      ? selection.reasoningLevel
      : null;

  return {
    status: "accepted",
    conversationPolicy: {
      fallbackModel: defaultModel.id,
      model: model.id,
      ...(reasoningLevel ? { reasoningLevel } : {}),
    },
  };
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
