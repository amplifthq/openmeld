import type { RemoteAiCreditHold } from "@openmeld/schemas/types";

type TokenPrice = {
  // USD per million tokens.
  input: number;
  output: number;
};

type ReviewedModelPrice = TokenPrice & {
  // OpenRouter's higher price band once the prompt reaches this size.
  tier?: TokenPrice & { minPromptTokens: number };
  // USD per result of the provider's native web search.
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
// Each server-tool step adds retrieved content and another model pass.
// OpenRouter shares one step budget across server tools: `max_tool_calls`,
// default and maximum 30.
const MAX_SERVER_TOOL_STEPS = 30;
const WEB_SEARCH_RESULT_TOKENS = 4000;
const DEFAULT_WEB_SEARCH_RESULTS = 5;
const DEFAULT_WEB_FETCH_CONTENT_TOKENS = 30_000;
// OpenRouter server-tool engine fees, reviewed 2026-10-21 from
// https://openrouter.ai/docs/guides/features/server-tools/web-search and
// .../web-fetch. Fees are per search or fetch call. Search without native
// pricing falls back to Exa, reserved at its most expensive mode: per call with
// 10 results, plus each extra result.
const EXA_SEARCH_REQUEST_USD = 0.015;
const EXA_SEARCH_INCLUDED_RESULTS = 10;
const EXA_SEARCH_EXTRA_RESULT_USD = 0.001;
const WEB_FETCH_USD_BY_ENGINE: Readonly<Record<string, number>> = {
  openrouter: 0,
  exa: 0.001,
  parallel: 0.001,
  firecrawl: 0.0025,
};
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
  const serverTools = estimateServerTools(input.body, price);
  if (!serverTools) {
    return { status: "unavailable", reason: "unsupported_request" };
  }
  // Every step re-sends the prompt with the content retrieved so far.
  const estimatedInputTokens =
    (serverTools.steps + 1) * estimatePromptTokens(input.body) +
    serverTools.steps * serverTools.contentTokens;
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
        NANO_USD_PER_USD * serverTools.feeUsd)
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

function estimateServerTools(
  body: Record<string, unknown>,
  price: ReviewedModelPrice
) {
  const { tools } = body;
  const total = { steps: 0, feeUsd: 0, contentTokens: 0 };
  if (tools === undefined) {
    return total;
  }
  if (!Array.isArray(tools)) {
    return null;
  }
  const stepBudget = Math.min(
    readPositiveInteger(body.max_tool_calls) ?? MAX_SERVER_TOOL_STEPS,
    MAX_SERVER_TOOL_STEPS
  );
  let calls = 0;
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
    const estimate = estimateServerTool(
      type,
      parameters ?? {},
      price,
      stepBudget
    );
    // Unknown tools and engines whose fees are not reviewed fail closed.
    if (!estimate) {
      return null;
    }
    calls += estimate.calls;
    total.feeUsd += estimate.feeUsd;
    total.contentTokens += estimate.contentTokens;
  }
  total.steps = Math.min(stepBudget, calls);
  return total;
}

function estimateServerTool(
  type: unknown,
  parameters: Record<string, unknown>,
  price: ReviewedModelPrice,
  stepBudget: number
) {
  const engine = parameters.engine ?? "auto";
  if (type === "openrouter:web_search") {
    // `max_uses` binds only Anthropic native search, so every step may search.
    const calls = stepBudget;
    const perCall =
      readPositiveInteger(parameters.max_results) ?? DEFAULT_WEB_SEARCH_RESULTS;
    const results = Math.min(
      readPositiveInteger(parameters.max_total_results) ?? calls * perCall,
      calls * perCall
    );
    const feeUsd = webSearchFeeUsd(engine, { calls, perCall, results }, price);
    return feeUsd === null
      ? null
      : { calls, feeUsd, contentTokens: results * WEB_SEARCH_RESULT_TOKENS };
  }
  if (type !== "openrouter:web_fetch") {
    return null;
  }
  const perFetchUsd =
    typeof engine === "string" && Object.hasOwn(WEB_FETCH_USD_BY_ENGINE, engine)
      ? WEB_FETCH_USD_BY_ENGINE[engine]
      : undefined;
  if (perFetchUsd === undefined) {
    return null;
  }
  const calls = Math.min(
    readPositiveInteger(parameters.max_uses) ?? stepBudget,
    stepBudget
  );
  return {
    calls,
    feeUsd: calls * perFetchUsd,
    contentTokens:
      calls *
      (readPositiveInteger(parameters.max_content_tokens) ??
        DEFAULT_WEB_FETCH_CONTENT_TOKENS),
  };
}

function webSearchFeeUsd(
  engine: unknown,
  search: { calls: number; perCall: number; results: number },
  price: ReviewedModelPrice
) {
  const exa =
    search.calls * EXA_SEARCH_REQUEST_USD +
    EXA_SEARCH_EXTRA_RESULT_USD *
      Math.min(
        search.results,
        search.calls * Math.max(0, search.perCall - EXA_SEARCH_INCLUDED_RESULTS)
      );
  // Native fees are passed through; reserve the reviewed fee per call or result.
  const native =
    price.webSearchUsd === undefined
      ? 0
      : Math.max(search.calls, search.results) * price.webSearchUsd;
  if (engine === "exa") {
    return exa;
  }
  // Auto and native use native search when the model has it, otherwise Exa.
  if (engine === "auto" || engine === "native") {
    return Math.max(exa, native);
  }
  return null;
}
