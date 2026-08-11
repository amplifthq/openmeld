import type { CenterAgentModelRoute } from "@openmeld/schemas/types";

export const TEST_CENTER_AGENT_MODEL_ROUTE = {
  automaticModelFallback: false,
  catalogUpdatedAt: "2026-07-31T00:00:00.000Z",
  contextWindow: 1_000_000,
  displayName: "DeepSeek V4 Flash",
  imageUnderstandingModel: {
    contextWindow: 500_000,
    displayName: "Grok 4.5",
    inputModalities: ["text", "image"],
    maxOutputTokens: 16_384,
    modelId: "x-ai/grok-4.5",
    provider: "openrouter",
    reasoningLevel: "high",
  },
  inputModalities: ["text"],
  maxOutputTokens: 16_384,
  modelId: "deepseek/deepseek-v4-flash",
  preference: {
    kind: "selected_model",
    modelId: "deepseek/deepseek-v4-flash",
  },
  provider: "openrouter",
  reasoningLevel: "high",
} as const satisfies CenterAgentModelRoute;
