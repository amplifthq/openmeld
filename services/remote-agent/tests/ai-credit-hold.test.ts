import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  estimateRemoteAiCreditHold,
  hasReviewedModelPrice,
  reviewedModelPrice,
} from "../agent-core/ai-credit-hold";
import { CENTER_AGENT_SESSION_TITLE_MODEL } from "../agent-core/center-agent-session-title";
import { resolveReviewedPromptPriceTierBoundary } from "../flue-adapter/model-context-policy";

const priceCapture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/openrouter-model-prices-2026-10-21.json",
      import.meta.url
    ),
    "utf8"
  )
) as {
  data: {
    id: string;
    pricing: {
      prompt: string;
      completion: string;
      web_search?: string;
      overrides?: {
        min_prompt_tokens: number;
        prompt: string;
        completion: string;
      }[];
    };
  }[];
};
const vendorModels = JSON.parse(
  readFileSync(
    new URL("../../../release/vendor-models.json", import.meta.url),
    "utf8"
  )
);
const perMillion = (usdPerToken: string) =>
  Math.round(Number(usdPerToken) * 1e12) / 1e6;

function hostedCatalogModelIds(): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      const entry = value as Record<string, unknown>;
      if (entry.hostedRuntime && typeof entry.id === "string") {
        ids.add(entry.id);
      }
      if (typeof entry.imageUnderstandingModelId === "string") {
        ids.add(entry.imageUnderstandingModelId);
      }
      Object.values(entry).forEach(visit);
    }
  };
  visit(vendorModels);
  return [...ids];
}

describe("Remote AI credit holds", () => {
  it("reserves the prompt and the full output cap at the reviewed price with a safety margin", () => {
    const body = {
      model: "x-ai/grok-4.5",
      max_tokens: 8192,
      messages: [{ role: "user", content: "x".repeat(2998) }],
    };
    const promptTokens = Math.ceil(JSON.stringify(body).length / 3);
    expect(
      estimateRemoteAiCreditHold({ modelId: "x-ai/grok-4.5", body })
    ).toEqual({
      status: "estimated",
      estimatedInputTokens: promptTokens,
      maxOutputTokens: 8192,
      nanoUsd: Math.ceil(1.25 * 1000 * (promptTokens * 2 + 8192 * 6)),
    });
  });

  it("uses the higher price band for large prompts and doubles reasoning-heavy output caps", () => {
    const body = {
      model: "openai/gpt-6.1-sol-pro",
      max_completion_tokens: 16_384,
      messages: [{ role: "user", content: "x".repeat(900_000) }],
    };
    const hold = estimateRemoteAiCreditHold({
      modelId: "openai/gpt-6.1-sol-pro",
      body,
    });
    expect(hold.status === "estimated" && hold.estimatedInputTokens).toBe(
      Math.ceil(JSON.stringify(body).length / 3)
    );
    const inputTokens =
      hold.status === "estimated" ? hold.estimatedInputTokens : 0;
    expect(hold).toMatchObject({
      nanoUsd: Math.ceil(1.25 * 1000 * (inputTokens * 4 + 2 * 16_384 * 15)),
    });
  });

  it("counts images per image and server research tools per use", () => {
    const image = `data:image/png;base64,${"A".repeat(3_000_000)}`;
    const imageHold = estimateRemoteAiCreditHold({
      modelId: "openai/gpt-6-luna",
      body: {
        model: "openai/gpt-6-luna",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe" },
              { type: "image_url", image_url: { url: image } },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      },
    });
    expect(
      imageHold.status === "estimated" && imageHold.estimatedInputTokens
    ).toBeGreaterThan(12_000);
    expect(
      imageHold.status === "estimated" && imageHold.estimatedInputTokens
    ).toBeLessThan(12_200);
    const search = estimateRemoteAiCreditHold({
      modelId: "x-ai/grok-4.5",
      body: {
        model: "x-ai/grok-4.5",
        max_tokens: 8192,
        messages: [{ role: "user", content: "news" }],
        tools: [
          {
            type: "openrouter:web_search",
            parameters: { max_results: 3, max_total_results: 3 },
          },
        ],
      },
    });
    // Three results at $0.005 each, retrieved content, and a second pass.
    expect(search.status === "estimated" && search.nanoUsd).toBeGreaterThan(
      1.25 * 3 * 5_000_000
    );
    expect(
      search.status === "estimated" && search.estimatedInputTokens
    ).toBeGreaterThan(12_000);
  });

  // The parameters external-tools.ts sends for web_search and web_fetch.
  const researchTools = {
    web_search: {
      type: "openrouter:web_search",
      parameters: {
        engine: "auto",
        max_results: 5,
        max_total_results: 5,
        search_context_size: "medium",
      },
    },
    web_fetch: {
      type: "openrouter:web_fetch",
      parameters: {
        engine: "openrouter",
        max_uses: 1,
        max_content_tokens: 30_000,
      },
    },
  };

  it.each(
    hostedCatalogModelIds().flatMap((modelId) =>
      Object.entries(researchTools).map(([name, tool]) => [modelId, name, tool])
    )
  )("prices %s research through %s", (modelId, _name, tool) => {
    const hold = estimateRemoteAiCreditHold({
      modelId: String(modelId),
      body: {
        model: modelId,
        max_tokens: 8192,
        max_tool_calls: 3,
        messages: [{ role: "user", content: "research" }],
        tools: [tool],
      },
    });
    expect(hold.status).toBe("estimated");
  });

  it("reserves a search fee for every server-tool step the request allows", () => {
    const searchHold = (steps?: number) =>
      estimateRemoteAiCreditHold({
        modelId: "deepseek/deepseek-v4.1-flash",
        body: {
          model: "deepseek/deepseek-v4.1-flash",
          max_tokens: 8192,
          ...(steps ? { max_tool_calls: steps } : {}),
          messages: [{ role: "user", content: "news" }],
          tools: [researchTools.web_search],
        },
      });
    const nanoUsd = (hold: ReturnType<typeof searchHold>) =>
      hold.status === "estimated" ? hold.nanoUsd : Number.NaN;
    // Five one-result searches within max_total_results still pay five fees.
    expect(nanoUsd(searchHold(5))).toBeGreaterThan(1.25 * 5 * 15_000_000);
    // Without max_tool_calls, OpenRouter allows up to 30 steps; larger caps clamp.
    expect(nanoUsd(searchHold())).toBeGreaterThan(1.25 * 30 * 15_000_000);
    expect(nanoUsd(searchHold(100))).toBe(nanoUsd(searchHold(999)));
  });

  it("prices research fees by engine, separately from model tokens", () => {
    const body = (modelId: string, tool: unknown) =>
      estimateRemoteAiCreditHold({
        modelId,
        body: {
          model: modelId,
          max_tokens: 1,
          messages: [],
          tools: [tool],
        },
      });
    const nanoUsd = (hold: ReturnType<typeof estimateRemoteAiCreditHold>) =>
      hold.status === "estimated" ? hold.nanoUsd : Number.NaN;
    const fetchWith = (engine: string) => ({
      type: "openrouter:web_fetch",
      parameters: { engine, max_uses: 2, max_content_tokens: 1000 },
    });
    // The direct OpenRouter fetch is free; Firecrawl charges $0.0025 a fetch.
    // The engine names differ by one prompt byte, priced in fractions of a cent.
    const fetchFee =
      nanoUsd(body("x-ai/grok-4.5", fetchWith("firecrawl"))) -
      nanoUsd(body("x-ai/grok-4.5", fetchWith("openrouter")));
    expect(Math.abs(fetchFee - 1.25 * 2 * 2_500_000)).toBeLessThan(10_000);
    // Without native search pricing, auto search reserves the Exa fallback.
    const exaSearch = {
      type: "openrouter:web_search",
      parameters: { engine: "auto", max_results: 12, max_total_results: 12 },
    };
    const withoutSearch = body("deepseek/deepseek-v4.1-flash", {
      ...exaSearch,
      type: "function",
    });
    const tokensOnly = body("deepseek/deepseek-v4.1-flash", {
      ...exaSearch,
      parameters: { ...exaSearch.parameters, engine: "exa" },
    });
    expect(nanoUsd(tokensOnly)).toBeGreaterThan(nanoUsd(withoutSearch));
    expect(nanoUsd(body("deepseek/deepseek-v4.1-flash", exaSearch))).toBe(
      nanoUsd(tokensOnly)
    );
    for (const tool of [
      fetchWith("native"),
      { ...exaSearch, parameters: { engine: "perplexity" } },
    ]) {
      expect(body("x-ai/grok-4.5", tool)).toEqual({
        status: "unavailable",
        reason: "unsupported_request",
      });
    }
  });

  it.each([
    [
      "unknown_model_price",
      "openai/unreviewed",
      { model: "openai/unreviewed", max_tokens: 10, messages: [] },
    ],
    [
      "unknown_model_price",
      "x-ai/grok-4.5",
      { model: "openai/gpt-6.1-sol-pro", max_tokens: 10, messages: [] },
    ],
    [
      "missing_output_limit",
      "x-ai/grok-4.5",
      { model: "x-ai/grok-4.5", messages: [] },
    ],
    [
      "unsupported_request",
      "x-ai/grok-4.5",
      { model: "x-ai/grok-4.5", max_tokens: 10, models: ["openai/gpt-6-luna"] },
    ],
    [
      "unsupported_request",
      "x-ai/grok-4.5",
      {
        model: "x-ai/grok-4.5",
        max_tokens: 10,
        tools: [{ type: "openrouter:image_generation" }],
      },
    ],
  ])("fails closed with %s for an unbounded or unpriced request", (reason, modelId, body) => {
    expect(estimateRemoteAiCreditHold({ modelId, body })).toEqual({
      status: "unavailable",
      reason,
    });
  });

  it("matches the captured OpenRouter prices and covers every hosted model", () => {
    for (const captured of priceCapture.data) {
      const override = captured.pricing.overrides?.[0];
      expect(reviewedModelPrice(captured.id)).toMatchObject({
        input: perMillion(captured.pricing.prompt),
        output: perMillion(captured.pricing.completion),
        ...(override
          ? {
              tier: {
                minPromptTokens: override.min_prompt_tokens,
                input: perMillion(override.prompt),
                output: perMillion(override.completion),
              },
            }
          : {}),
        ...(captured.pricing.web_search
          ? { webSearchUsd: Number(captured.pricing.web_search) }
          : {}),
      });
    }
    const unpriced = [
      ...hostedCatalogModelIds(),
      CENTER_AGENT_SESSION_TITLE_MODEL,
    ].filter((modelId) => !hasReviewedModelPrice(modelId));
    expect(unpriced).toEqual([]);
    for (const captured of priceCapture.data) {
      const boundary = resolveReviewedPromptPriceTierBoundary(captured.id);
      if (boundary !== null) {
        expect(reviewedModelPrice(captured.id)?.tier?.minPromptTokens).toBe(
          boundary
        );
      }
    }
  });
});
