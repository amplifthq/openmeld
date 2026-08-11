import type { ConversationPolicy } from "@openmeld/adapter-core";

export type ClaudeConversationPolicyOptions = {
  fallbackModel?: string;
  model?: string;
  reasoningLevel?: string;
};

export function resolveClaudeConversationPolicyOptions(
  conversationPolicy?: ConversationPolicy
): ClaudeConversationPolicyOptions {
  const model = normalizeOptionalText(conversationPolicy?.model);
  const fallbackModel = normalizeOptionalText(
    conversationPolicy?.fallbackModel
  );
  const reasoningLevel = normalizeOptionalText(
    conversationPolicy?.reasoningLevel
  );

  return {
    ...(model ? { model } : {}),
    ...(fallbackModel && fallbackModel !== model ? { fallbackModel } : {}),
    ...(reasoningLevel ? { reasoningLevel } : {}),
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
