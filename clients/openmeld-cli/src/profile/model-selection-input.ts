export type NormalizedModelSelectionInput = {
  hasAnyModelSelectionInput: boolean;
  modelId?: string;
  reasoningLevel?: string;
};

export function normalizeModelSelectionInput(input: {
  model?: string;
  reasoningEffort?: string;
}): NormalizedModelSelectionInput {
  const modelId = normalizeOptionalString(input.model);
  const reasoningLevel = normalizeOptionalString(input.reasoningEffort);
  if (!(modelId || reasoningLevel)) {
    return {
      hasAnyModelSelectionInput: false,
    };
  }
  if (!modelId) {
    throw new Error("--reasoning-effort requires --model.");
  }
  return {
    hasAnyModelSelectionInput: true,
    modelId,
    ...(reasoningLevel ? { reasoningLevel } : {}),
  };
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
