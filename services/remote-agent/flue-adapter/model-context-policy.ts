// Reviewed OpenRouter prompt-price boundaries, captured on 2026-10-02 from
// https://openrouter.ai/api/v1/model/{author}/{slug}. These are runtime cost
// policy, not model identity/capacity or a second model-selection catalog.
// Keep exact IDs: a new model does not inherit a price band from its family.
const PROMPT_PRICE_TIER_BOUNDARIES: Readonly<Record<string, number>> = {
  "openai/gpt-6.1-sol-pro": 272_000,
  "openai/gpt-6.1-sol": 272_000,
  "openai/gpt-6-sol": 272_000,
  "openai/gpt-6-luna": 272_000,
  "openai/gpt-6-astra-pro": 272_000,
  "openai/gpt-6-astra": 272_000,
  "openai/gpt-5.6-sol": 272_000,
  "openai/gpt-5.6-terra": 272_000,
  "openai/gpt-5.6-luna": 272_000,
  "x-ai/grok-4.7": 200_000,
  "x-ai/grok-4.6": 200_000,
  "x-ai/grok-4.5": 200_000,
};

export function resolveReviewedPromptPriceTierBoundary(
  modelId: string
): number | null {
  return PROMPT_PRICE_TIER_BOUNDARIES[modelId] ?? null;
}
