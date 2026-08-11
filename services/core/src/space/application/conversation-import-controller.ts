export type ConversationImportControllerSource =
  | "binding_truth"
  | "actor_context";

export type ConversationImportControllerResolution =
  | {
      agentControllerRef: string;
      source: ConversationImportControllerSource;
      status: "resolved";
    }
  | {
      reasonCode: "space.conversation_binding.controller_missing";
      status: "missing";
    };

export function resolveConversationImportAgentControllerRef(input: {
  primaryBindingAgentControllerRef?: string | null;
  legacyActorAgentControllerRef?: string | null;
}): ConversationImportControllerResolution {
  const primaryBindingAgentControllerRef = normalizeOptionalText(
    input.primaryBindingAgentControllerRef
  );
  if (primaryBindingAgentControllerRef) {
    return {
      agentControllerRef: primaryBindingAgentControllerRef,
      source: "binding_truth",
      status: "resolved",
    };
  }

  const legacyActorAgentControllerRef = normalizeOptionalText(
    input.legacyActorAgentControllerRef
  );
  if (legacyActorAgentControllerRef) {
    return {
      agentControllerRef: legacyActorAgentControllerRef,
      source: "actor_context",
      status: "resolved",
    };
  }

  return {
    reasonCode: "space.conversation_binding.controller_missing",
    status: "missing",
  };
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
