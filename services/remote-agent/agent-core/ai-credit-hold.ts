import type { RemoteAiCreditHold } from "@openmeld/schemas/types";

type TokenPrice = {
  // USD per million tokens.
  input: number;
  output: number;
};

type ReviewedModelPrice = TokenPrice & {
  // OpenRouter's higher price band once the prompt reaches this size.
  tier?: TokenPrice & { minPromptTokens: number };
  // USD per server web search or fetch.
  webSearchUsd?: number;
  // Pro variants run extended server-side reasoning; reserve their output cap twice.
  outputReservationMultiplier?: number;
};

// Reviewed OpenRouter prices, captured on 2026-10-21 from
// https://openrouter.ai/api/v1/models (tests/fixtures/openrouter-model-prices-2026-10-21.json).
// These are admission estimates, not billing facts: settlement always uses the
// provider-reported cost. A model without a reviewed price cannot use platform
// credits. Keep exact IDs: a new model does not inherit a family price.
const REVIEWED_MODEL_PRICES: Readonly<Record<string, ReviewedModelPrice>> = {
  "anthropic/claude-fable-5": { input: 10, output: 50, webSearchUsd: 0.01 },
  "anthropic/claude-fable-5.1": { input: 10, output: 50, webSearchUsd: 0.01 },
  "anthropic/claude-haiku-5.5": {
    input: 0.1,
    output: 0.5,
    tier: { minPromptTokens: 100_000, input: 0.5, output: 2.5 },
    webSearchUsd: 0.01,
  },
  "anthropic/claude-opus-5": { input: 5, output: 25, webSearchUsd: 0.01 },
  "anthropic/claude-opus-5.5": { input: 4, output: 20, webSearchUsd: 0.01 },
  "anthropic/claude-sonnet-5": { input: 2, output: 10, webSearchUsd: 0.01 },
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10, webSearchUsd: 0.01 },
  "deepseek/deepseek-v4-flash": { input: 0.091, output: 0.182 },
  "deepseek/deepseek-v4.1-flash": { input: 0.049, output: 0.525 },
  "google/gemini-3.1-pro-preview": {
    input: 2,
    output: 12,
    tier: { minPromptTokens: 200_000, input: 4, output: 18 },
    webSearchUsd: 0.014,
  },
  "google/gemini-3.5-flash-lite": {
    input: 0.3,
    output: 2.5,
    webSearchUsd: 0.014,
  },
  "google/gemini-3.8-flash": {
    input: 0.825,
    output: 4.125,
    webSearchUsd: 0.014,
  },
  "google/gemini-4-argon": { input: 2, output: 10, webSearchUsd: 0.014 },
  "meta/muse-wonder": { input: 4, output: 20, webSearchUsd: 0.0025 },
  "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, webSearchUsd: 0.01 },
  "openai/gpt-5.6-luna": {
    input: 0.2,
    output: 1.2,
    tier: { minPromptTokens: 272_000, input: 0.4, output: 1.8 },
    webSearchUsd: 0.01,
  },
  "openai/gpt-5.6-sol": {
    input: 4,
    output: 20,
    tier: { minPromptTokens: 272_000, input: 8, output: 30 },
    webSearchUsd: 0.01,
  },
  "openai/gpt-5.6-terra": {
    input: 2,
    output: 12,
    tier: { minPromptTokens: 272_000, input: 4, output: 18 },
    webSearchUsd: 0.01,
  },
  "openai/gpt-6-astra": {
    input: 10,
    output: 50,
    tier: { minPromptTokens: 272_000, input: 20, output: 75 },
    webSearchUsd: 0.01,
  },
  "openai/gpt-6-astra-pro": {
    input: 10,
    output: 50,
    tier: { minPromptTokens: 272_000, input: 20, output: 75 },
    webSearchUsd: 0.01,
    outputReservationMultiplier: 2,
  },
  "openai/gpt-6-luna": {
    input: 0.1,
    output: 0.5,
    tier: { minPromptTokens: 272_000, input: 0.2, output: 0.75 },
    webSearchUsd: 0.01,
  },
  "openai/gpt-6-sol": {
    input: 2,
    output: 10,
    tier: { minPromptTokens: 272_000, input: 4, output: 15 },
    webSearchUsd: 0.01,
  },
  "openai/gpt-6.1-sol": {
    input: 2,
    output: 10,
    tier: { minPromptTokens: 272_000, input: 4, output: 15 },
    webSearchUsd: 0.01,
  },
  "openai/gpt-6.1-sol-pro": {
    input: 2,
    output: 10,
    tier: { minPromptTokens: 272_000, input: 4, output: 15 },
    webSearchUsd: 0.01,
    outputReservationMultiplier: 2,
  },
  "x-ai/grok-4.5": {
    input: 2,
    output: 6,
    tier: { minPromptTokens: 200_000, input: 4, output: 12 },
    webSearchUsd: 0.005,
  },
  "x-ai/grok-4.6": {
    input: 2,
    output: 6,
    tier: { minPromptTokens: 200_000, input: 4, output: 12 },
    webSearchUsd: 0.005,
  },
  "x-ai/grok-4.7": {
    input: 2,
    output: 6,
    tier: { minPromptTokens: 200_000, input: 4, output: 12 },
    webSearchUsd: 0.005,
  },
  "z-ai/glm-5.3-flash": { input: 0.15, output: 0.5 },
};

// Tokenizers average about four UTF-8 bytes per token for English and code;
// three bytes per token stays above that and covers CJK text.
const PROMPT_BYTES_PER_TOKEN = 3;
// Above the largest per-image charge of the reviewed providers at their
// maximum input resolution.
const IMAGE_INPUT_TOKENS = 6000;
// Server tools add retrieved content to a second model pass.
const WEB_SEARCH_RESULT_TOKENS = 4000;
const DEFAULT_WEB_SEARCH_RESULTS = 5;
const DEFAULT_WEB_FETCH_CONTENT_TOKENS = 30_000;
// Covers price drift between reviews and estimate error.
const HOLD_SAFETY_MULTIPLIER = 1.25;
const NANO_USD_PER_USD_PER_MILLION_TOKENS = 1000;
const NANO_USD_PER_USD = 1_000_000_000;

export function hasReviewedModelPrice(modelId: string) {
  return Object.hasOwn(REVIEWED_MODEL_PRICES, modelId);
}

export function reviewedModelPrice(
  modelId: string
): Readonly<ReviewedModelPrice> | null {
  return REVIEWED_MODEL_PRICES[modelId] ?? null;
}

/**
 * Estimates the most one chat completion request can cost from its exact
 * body. The provider-reported cost replaces this hold at settlement.
 */
export function estimateRemoteAiCreditHold(input: {
  modelId: string;
  body: Record<string, unknown>;
}): RemoteAiCreditHold {
  const modelId =
    typeof input.body.model === "string" ? input.body.model : input.modelId;
  const price = REVIEWED_MODEL_PRICES[modelId];
  if (!(price && modelId === input.modelId)) {
    return { status: "unavailable", reason: "unknown_model_price" };
  }
  // Fallback model lists, plugins, and multiple choices would be billed beyond
  // one priced model and one output cap.
  if (
    input.body.models !== undefined ||
    input.body.plugins !== undefined ||
    (input.body.n !== undefined && input.body.n !== 1)
  ) {
    return { status: "unavailable", reason: "unsupported_request" };
  }
  const maxOutputTokens = readPositiveInteger(
    input.body.max_tokens ?? input.body.max_completion_tokens
  );
  if (maxOutputTokens === null) {
    return { status: "unavailable", reason: "missing_output_limit" };
  }
  const serverTools = estimateServerTools(input.body.tools, price);
  if (!serverTools) {
    return { status: "unavailable", reason: "unsupported_request" };
  }
  const bodyTokens = estimatePromptTokens(input.body);
  const estimatedInputTokens =
    serverTools.searches > 0
      ? 2 * bodyTokens + serverTools.contentTokens
      : bodyTokens;
  const band =
    price.tier && estimatedInputTokens >= price.tier.minPromptTokens
      ? price.tier
      : price;
  const outputTokens =
    maxOutputTokens * (price.outputReservationMultiplier ?? 1);
  const nanoUsd = Math.ceil(
    HOLD_SAFETY_MULTIPLIER *
      (NANO_USD_PER_USD_PER_MILLION_TOKENS *
        (estimatedInputTokens * band.input + outputTokens * band.output) +
        NANO_USD_PER_USD * serverTools.searches * (price.webSearchUsd ?? 0))
  );
  return {
    status: "estimated",
    nanoUsd: Math.max(1, nanoUsd),
    estimatedInputTokens,
    maxOutputTokens,
  };
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function estimatePromptTokens(body: Record<string, unknown>) {
  let images = 0;
  // Image payloads are billed per image, not per encoded byte.
  const text = JSON.stringify(body, (key, value) => {
    if (key === "image_url") {
      images += 1;
      return null;
    }
    return value;
  });
  return (
    Math.ceil(
      new TextEncoder().encode(text).byteLength / PROMPT_BYTES_PER_TOKEN
    ) +
    images * IMAGE_INPUT_TOKENS
  );
}

function estimateServerTools(tools: unknown, price: ReviewedModelPrice) {
  let searches = 0;
  let contentTokens = 0;
  if (tools === undefined) {
    return { searches, contentTokens };
  }
  if (!Array.isArray(tools)) {
    return null;
  }
  for (const tool of tools) {
    const type =
      tool && typeof tool === "object" && "type" in tool ? tool.type : null;
    if (type === "function") {
      continue;
    }
    const parameters =
      tool && typeof tool === "object" && "parameters" in tool
        ? (tool.parameters as Record<string, unknown> | null)
        : null;
    if (type === "openrouter:web_search" && price.webSearchUsd !== undefined) {
      const results =
        readPositiveInteger(parameters?.max_total_results) ??
        readPositiveInteger(parameters?.max_results) ??
        DEFAULT_WEB_SEARCH_RESULTS;
      searches += results;
      contentTokens += results * WEB_SEARCH_RESULT_TOKENS;
      continue;
    }
    if (type === "openrouter:web_fetch" && price.webSearchUsd !== undefined) {
      const uses = readPositiveInteger(parameters?.max_uses) ?? 1;
      searches += uses;
      contentTokens +=
        uses *
        (readPositiveInteger(parameters?.max_content_tokens) ??
          DEFAULT_WEB_FETCH_CONTENT_TOKENS);
      continue;
    }
    return null;
  }
  return { searches, contentTokens };
}
