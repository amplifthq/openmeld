import type { ConversationPolicy, ModelCatalog } from "@openmeld/schemas/types";
import { parseAgentControllerRef } from "./agent-controller-ref";
import {
  type AgentProfileBindingModelSelectionInput,
  createAgentProfileBindingModelSelection,
} from "./agent-profile-binding";
import {
  type ModelRetirementContext,
  resolveModelAvailability,
} from "./model-retirement";

export type ConversationPolicyResolution =
  | { status: "accepted"; conversationPolicy: ConversationPolicy }
  | {
      status: "rejected";
      reasonCode: "model.retired" | "model.unavailable";
      message: string;
    };

export function resolveConversationPolicyFromModelSelection(input: {
  agentControllerConversationId?: string | null;
  agentControllerRef: string;
  catalog: ModelCatalog;
  modelSelection?: AgentProfileBindingModelSelectionInput | null;
  authType?: ModelRetirementContext["authType"];
  providerId?: ModelRetirementContext["providerId"];
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
  if (selection) {
    const selectedModel = controller?.models.find(
      (model) => model.id === selection.modelId
    );
    const availability = resolveModelAvailability(selectedModel, input);
    if (!availability.available) {
      return {
        status: "rejected",
        reasonCode: availability.reasonCode,
        message: availability.message,
      };
    }
    const reasoningLevel =
      selection.reasoningLevel &&
      selectedModel?.supportedReasoningLevels.includes(selection.reasoningLevel)
        ? selection.reasoningLevel
        : null;
    return {
      status: "accepted",
      conversationPolicy: {
        model: selection.modelId,
        ...(reasoningLevel ? { reasoningLevel } : {}),
      },
    };
  }
  if (!controller) {
    return {
      status: "accepted",
      conversationPolicy: {},
    };
  }

  const availableModels = controller.models.filter(
    (model) => resolveModelAvailability(model, input).available
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

  if (
    parsedRef.kind === "builtin" &&
    parsedRef.id === "codex" &&
    normalizeOptionalText(input.agentControllerConversationId)
  ) {
    return { status: "accepted", conversationPolicy: {} };
  }
  return {
    status: "accepted",
    conversationPolicy: {
      fallbackModel: defaultModel.id,
      model: defaultModel.id,
    },
  };
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
