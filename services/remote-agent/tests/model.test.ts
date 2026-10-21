import {
  createModels,
  fauxAssistantMessage,
  fauxToolCall,
  isContextOverflow,
} from "@earendil-works/pi-ai";
// biome-ignore lint/performance/noNamespaceImport: Vitest spies on the real provider registration export.
import * as flue from "@flue/runtime";
import {
  resetModelsForTests as resetProviderRuntime,
  resolveModel,
} from "@flue/runtime/internal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise routing and native provider payloads in Node. The
// Durable Object attribution boundary is exercised by localhost metering smoke.
vi.mock("../flue-adapter/ai-usage", () => ({
  createFlueMeteredFetch:
    (input: { fetch?: typeof fetch }) =>
    (...args: Parameters<typeof fetch>) =>
      (input.fetch ?? fetch)(...args),
}));

import { estimateRemoteAiCreditHold } from "../agent-core/ai-credit-hold";
import {
  buildRemoteAgentAiGatewayHeaders,
  buildRemoteAgentGatewayMetadata,
  REMOTE_AGENT_MAX_OUTPUT_TOKENS,
  REMOTE_AGENT_MODEL_DISPLAY_NAME,
  REMOTE_AGENT_OPENROUTER_MODEL_ID,
  resolveRemoteAgentAiGatewayAccountId,
  resolveRemoteAgentAiGatewayId,
  resolveRemoteAgentAiGatewayOpenRouterBaseUrl,
  resolveRemoteAgentAiGatewayToken,
  resolveRemoteAgentFlueModelSpecifier,
  resolveRemoteAgentModelDisplayName,
  resolveRemoteAgentOpenRouterModelId,
} from "../agent-core/model";
import {
  REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS,
  registerRemoteAgentCloudflareProvider,
  resolveRemoteAgentModelRuntimeConfig,
  resolveRemoteAgentModelRuntimeConfigForRegistration,
  resolveRemoteAgentOpenRouterModelMetadataUrl,
} from "../flue-adapter/model";
import {
  TEST_CENTER_AGENT_GLM_DEFAULT_MODEL_ROUTE,
  TEST_CENTER_AGENT_MODEL_ROUTE,
} from "./fixtures";
import openAiGpt54MiniModel from "./fixtures/openrouter-model-openai-gpt-5.4-mini.json";
import xAiGrok45Model from "./fixtures/openrouter-model-x-ai-grok-4.5.json";
import xAiGrok46Model from "./fixtures/openrouter-model-x-ai-grok-4.6.json";
import zAiGlm53FlashModel from "./fixtures/openrouter-model-z-ai-glm-5.3-flash.json";

const CONFIGURED_AI_GATEWAY_ENV = {
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID: "account_123",
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: "gateway_123",
} as const;

describe("remote agent model routing", () => {
  it("bounds context deferral by a small route's input capacity", async () => {
    const config = await resolveRemoteAgentModelRuntimeConfigForRegistration({
      env: {},
      modelRoute: {
        ...TEST_CENTER_AGENT_MODEL_ROUTE,
        contextWindow: 32_000,
        maxOutputTokens: 8000,
      },
    });
    expect(config.compaction.workingContextTokens).toBe(24_000);
    expect(config.compaction.maxWorkingContextTokens).toBe(24_000);
    expect(config.compaction.preserveActiveInput).toBe(true);
    expect(config.compaction.thinkingLevel).toBe("low");
  });
  let models = createModels();
  const streamRegisteredModel: typeof models.stream = (...args) =>
    models.stream(...args);
  beforeEach(() => {
    models = createModels();
    const register = flue.setProvider;
    vi.spyOn(flue, "setProvider").mockImplementation((provider) => {
      models.setProvider(provider);
      register(provider);
    });
  });
  afterEach(() => vi.restoreAllMocks());
  it.each([
    "anthropic/claude-opus-5.5",
    "openai/gpt-6-sol",
    "google/gemini-2.5-pro",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen-plus",
    "z-ai/glm-5.3-flash",
    "x-ai/grok-4.6",
  ])("refreshes the outgoing clock for %s without moving accepted input", async (modelId) => {
    resetProviderRuntime();
    const payloads: Record<string, unknown>[] = [];
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const captureFetch = vi.fn<typeof fetch>((_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return Promise.reject(
        new Error("Captured outgoing vendor payload before network dispatch")
      );
    });
    try {
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: {
          ...TEST_CENTER_AGENT_MODEL_ROUTE,
          modelId,
          preference: { kind: "selected_model", modelId },
        },
        organizationId: "org_clock",
      });
      const model = resolveModel(runtime.modelSpecifier);
      const context = {
        systemPrompt: "Stable system instruction.",
        messages: [
          {
            role: "user" as const,
            timestamp: 1,
            content: "Request received at UTC: 1970-01-01T00:00:01.000Z",
          },
        ],
      };
      for (const nowMs of [100_000, 700_000]) {
        clock.mockReturnValue(nowMs);
        await streamRegisteredModel(model, context, {
          apiKey: "unused",
          fetch: captureFetch,
          maxRetries: 0,
        }).result();
      }
      expect(payloads).toHaveLength(2);
      expect(JSON.stringify(payloads[0])).toContain("1970-01-01T00:01:40.000Z");
      expect(JSON.stringify(payloads[1])).toContain("1970-01-01T00:11:40.000Z");
      for (const payload of payloads) {
        expect(JSON.stringify(payload)).toContain(
          "Request received at UTC: 1970-01-01T00:00:01.000Z"
        );
        expect(
          (payload.messages as { role: string; content: unknown }[]).filter(
            (message) =>
              message.role === "user" &&
              typeof message.content === "string" &&
              message.content.startsWith("[OpenMeld runtime clock]")
          )
        ).toHaveLength(1);
        const clockMessage = (payload.messages as Record<string, unknown>[]).at(
          -1
        );
        expect(clockMessage).toMatchObject({
          role: "user",
          content: expect.stringContaining("[OpenMeld runtime clock]"),
        });
        expect(clockMessage).not.toHaveProperty("cache_control");
      }
      const retainedMessages = (payload: Record<string, unknown> | undefined) =>
        (payload?.messages as unknown[] | undefined)?.slice(0, -1);
      expect(retainedMessages(payloads[1])).toEqual(
        retainedMessages(payloads[0])
      );
      expect(context.messages).toHaveLength(1);
      expect(context.systemPrompt).toBe("Stable system instruction.");
    } finally {
      resetProviderRuntime();
    }
  });
  it("registers GPT-5.4 mini from static metadata", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    const fetchModelMetadata = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    await expect(
      resolveRemoteAgentModelRuntimeConfigForRegistration({
        env: {
          OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: "openai/gpt-5.4-mini",
        },
        fetchModelMetadata,
      })
    ).resolves.toEqual({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 40_000,
      },
      contextWindow: 400_000,
      maxTokens: 8192,
      modelId: "openai/gpt-5.4-mini",
      modelSpecifier: "openrouter/openai/gpt-5.4-mini",
    });
    expect(fetchModelMetadata).toHaveBeenCalledTimes(1);

    resolveRefresh?.(Response.json(openAiGpt54MiniModel));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("registers Grok from static metadata before the background refresh settles", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    const fetchModelMetadata = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    await expect(
      resolveRemoteAgentModelRuntimeConfigForRegistration({
        env: {},
        fetchModelMetadata,
      })
    ).resolves.toEqual({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 340_000,
      },
      contextWindow: 500_000,
      maxTokens: 8192,
      modelId: "x-ai/grok-4.5",
      modelSpecifier: "openrouter/x-ai/grok-4.5",
    });
    expect(fetchModelMetadata).toHaveBeenCalledTimes(1);

    resolveRefresh?.(Response.json(xAiGrok45Model));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("keeps legacy v1 image input during a Remote Agent first rollout", async () => {
    resetProviderRuntime();
    try {
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        organizationId: "org_legacy",
      });
      const model = resolveModel(runtime.modelSpecifier);
      let capturedPayload: unknown;
      const stream = streamRegisteredModel(
        model,
        {
          messages: [
            {
              content: [
                { text: "Describe this image.", type: "text" },
                {
                  data: "cG5n",
                  mimeType: "image/png",
                  type: "image",
                },
              ],
              role: "user",
              timestamp: 1,
            },
          ],
        },
        {
          apiKey: "unused",
          onPayload: (payload) => {
            capturedPayload = payload;
            throw new Error(
              "Request payload captured before network dispatch."
            );
          },
        }
      );

      await stream.result();

      expect(JSON.stringify(capturedPayload)).toContain('"type":"image_url"');
      expect(JSON.stringify(capturedPayload)).not.toContain(
        "image omitted: model does not support images"
      );
    } finally {
      resetProviderRuntime();
    }
  });

  it("keeps provider registration isolated across organizations and frozen routes", async () => {
    resetProviderRuntime();
    try {
      const grokRoute = {
        ...TEST_CENTER_AGENT_MODEL_ROUTE,
        contextWindow: 500_000,
        displayName: "Grok 4.5",
        inputModalities: ["text" as const, "image" as const],
        modelId: "x-ai/grok-4.5",
        preference: {
          kind: "selected_model" as const,
          modelId: "x-ai/grok-4.5",
        },
      };
      const first = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: grokRoute,
        organizationId: "org_alpha",
      });
      const second = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        organizationId: "org_beta",
      });

      expect(first.modelSpecifier).not.toBe(second.modelSpecifier);
      const firstModel = resolveModel(first.modelSpecifier);
      const secondModel = resolveModel(second.modelSpecifier);
      expect(firstModel.contextWindow).toBe(500_000);
      expect(secondModel.contextWindow).toBe(1_000_000);
      expect(
        JSON.parse(String(firstModel.headers?.["cf-aig-metadata"]))
      ).toEqual(
        expect.objectContaining({
          model: "x-ai/grok-4.5",
          organizationId: "org_alpha",
        })
      );
      expect(
        JSON.parse(String(secondModel.headers?.["cf-aig-metadata"]))
      ).toEqual(
        expect.objectContaining({
          model: "deepseek/deepseek-v4-flash",
          organizationId: "org_beta",
        })
      );
    } finally {
      resetProviderRuntime();
    }
  });

  it("wires the frozen route budget into final provider preflight", async () => {
    resetProviderRuntime();
    try {
      const constrainedRoute = {
        ...TEST_CENTER_AGENT_MODEL_ROUTE,
        contextWindow: 600,
      };
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: constrainedRoute,
        organizationId: "org_constrained",
      });
      const model = resolveModel(runtime.modelSpecifier);
      const stream = streamRegisteredModel(
        model,
        {
          messages: [
            {
              content: "x".repeat(2000),
              role: "user",
              timestamp: 1,
            },
          ],
        },
        { apiKey: "unused" }
      );

      const result = await stream.result();
      expect(result.stopReason).toBe("error");
      expect(isContextOverflow(result, constrainedRoute.contextWindow)).toBe(
        true
      );
      expect(result.errorMessage).toContain("(request_too_large)");
    } finally {
      resetProviderRuntime();
    }
  });

  it("allows a summarizer above the economic threshold through the physical preflight", async () => {
    resetProviderRuntime();
    const providerFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "provider reached" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );
    try {
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: {
          ...TEST_CENTER_AGENT_MODEL_ROUTE,
          modelId: "openai/gpt-6.1-sol-pro",
          contextWindow: 1_050_000,
        },
      });
      const result = await streamRegisteredModel(
        resolveModel(runtime.modelSpecifier),
        {
          messages: [
            { role: "user", timestamp: 1, content: "x".repeat(900_000) },
          ],
        },
        { apiKey: "unused" }
      ).result();
      expect(providerFetch).toHaveBeenCalled();
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("HTTP 400");
      expect(result.errorMessage).not.toContain("provider reached");
    } finally {
      resetProviderRuntime();
    }
  });

  it.each([
    { environment: "prod", rich: false },
    { environment: undefined, rich: false },
    { environment: "dev", rich: true },
  ])("applies content policy to both registered model entry points: $environment", async (policy) => {
    resetProviderRuntime();
    const privateText = "Private provider excerpt: Project Cedar";
    const runtime = await registerRemoteAgentCloudflareProvider({
      env: {
        ...CONFIGURED_AI_GATEWAY_ENV,
        CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        OPENMELD_WORKER_ENVIRONMENT: policy.environment,
      },
      modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      organizationId: "external",
    });
    try {
      const model = resolveModel(runtime.modelSpecifier);
      const context = {
        messages: [
          { role: "user" as const, content: "Answer briefly.", timestamp: 1 },
        ],
      };
      const options = {
        apiKey: "unused",
        fetch: () =>
          Promise.resolve(
            Response.json({ error: { message: privateText } }, { status: 400 })
          ),
      };
      for (const stream of [
        streamRegisteredModel(model, context, options),
        models.streamSimple(model, context, options),
      ]) {
        const result = await stream.result();
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("400");
        expect(result.errorMessage?.includes(privateText)).toBe(policy.rich);
      }
    } finally {
      resetProviderRuntime();
    }
  });

  it.each([
    ["anthropic/claude-opus-5.5", undefined, true],
    ["anthropic/claude-sonnet-4.6", undefined, true],
    ["anthropic/claude-opus-5.5", "none", false],
    ["deepseek/deepseek-v3.2", undefined, true],
    ["qwen/qwen-plus", undefined, true],
    ["qwen/qwen3-max", undefined, true],
    ["qwen/qwen3.6-plus", undefined, true],
    ["qwen/qwen3-coder-plus", undefined, true],
    ["qwen/qwen3-coder-flash", undefined, true],
    ["qwen/qwen3.6-flash", undefined, true],
    ["qwen/qwen3.7-max", undefined, true],
    ["qwen/qwen3.7-plus", undefined, true],
    ["qwen/qwen3.7-flash", undefined, true],
    ["qwen/qwen3.8-max-0902", undefined, true],
    ["qwen/qwen3.8-flash", undefined, true],
    ["qwen/qwen3-coder-plus", "none", false],
    ["qwen/qwen3.5-plus-02-15", undefined, false],
    ["qwen/qwen3.5-flash-02-23", undefined, false],
    ["qwen/qwen3-coder", undefined, false],
    ["google/gemini-2.5-pro", undefined, false],
    ["openai/gpt-6-sol", undefined, false],
    ["deepseek/deepseek-v4-flash", undefined, false],
    ["z-ai/glm-5.3-flash", undefined, false],
    ["x-ai/grok-4.6", undefined, false],
  ] as const)("preserves native prompt caching for scoped %s with retention %s", async (modelId, cacheRetention, cacheEnabled) => {
    resetProviderRuntime();
    try {
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: {
          ...TEST_CENTER_AGENT_MODEL_ROUTE,
          modelId,
          preference: { kind: "selected_model", modelId },
        },
        organizationId: "org_prompt_cache",
      });
      const model = resolveModel(runtime.modelSpecifier);
      let capturedPayload: unknown;
      const stream = streamRegisteredModel(
        model,
        {
          systemPrompt: "Stable system instruction.",
          messages: [
            { role: "user", content: "Current question.", timestamp: 1 },
          ],
          tools: [
            {
              name: "read_example",
              description: "Read an example.",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
        {
          apiKey: "unused",
          cacheRetention,
          maxRetries: 0,
          reasoningEffort: "high",
          sessionId: "conversation_prompt_cache",
          fetch: (_url, init) => {
            capturedPayload = JSON.parse(String(init?.body));
            throw new Error(
              "Request payload captured before network dispatch."
            );
          },
        }
      );

      await stream.result();

      expect(capturedPayload).toMatchObject({
        model: modelId,
        reasoning: { effort: "high" },
        session_id: "conversation_prompt_cache",
        provider: { allow_fallbacks: true },
        tools: [
          {
            function: {
              name: "read_example",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      });
      if (cacheEnabled) {
        expect(capturedPayload).toMatchObject({
          messages: [
            {
              content: [
                {
                  type: "text",
                  text: "Stable system instruction.",
                  cache_control: { type: "ephemeral" },
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Current question.",
                  cache_control: { type: "ephemeral" },
                },
              ],
            },
            {
              role: "user",
              content: expect.stringContaining("[OpenMeld runtime clock]"),
            },
          ],
        });
        if (modelId.startsWith("anthropic/")) {
          expect(capturedPayload).toMatchObject({
            tools: [{ cache_control: { type: "ephemeral" } }],
          });
        } else {
          expect(capturedPayload).toMatchObject({
            tools: [
              expect.not.objectContaining({ cache_control: expect.anything() }),
            ],
          });
        }
      } else {
        expect(capturedPayload).toMatchObject({
          messages: [
            { content: "Stable system instruction." },
            { role: "user", content: "Current question." },
            {
              role: "user",
              content: expect.stringContaining("[OpenMeld runtime clock]"),
            },
          ],
        });
        expect(JSON.stringify(capturedPayload)).not.toContain("cache_control");
      }
    } finally {
      resetProviderRuntime();
    }
  });

  it("preserves OpenRouter reasoning for a scoped Grok provider", async () => {
    resetProviderRuntime();
    try {
      const grokRoute = {
        ...TEST_CENTER_AGENT_MODEL_ROUTE,
        contextWindow: 500_000,
        displayName: "Grok 4.6",
        inputModalities: ["text" as const, "image" as const],
        modelId: "x-ai/grok-4.6",
        preference: {
          kind: "selected_model" as const,
          modelId: "x-ai/grok-4.6",
        },
      };
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: grokRoute,
        organizationId: "org_grok_reasoning",
      });
      const model = resolveModel(runtime.modelSpecifier);
      let capturedPayload: unknown;
      const stream = streamRegisteredModel(
        model,
        { messages: [] },
        {
          apiKey: "unused",
          onPayload: (payload) => {
            capturedPayload = payload;
            throw new Error(
              "Request payload captured before network dispatch."
            );
          },
          reasoningEffort: "high",
        }
      );

      await stream.result();

      expect(capturedPayload).toMatchObject({
        reasoning: { effort: "high" },
      });
    } finally {
      resetProviderRuntime();
    }
  });

  it("omits OpenRouter reasoning when a scoped model turn does not request it", async () => {
    resetProviderRuntime();
    try {
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        organizationId: "org_deepseek_reasoning_off",
      });
      const model = resolveModel(runtime.modelSpecifier);
      let capturedPayload: unknown;
      const stream = streamRegisteredModel(
        model,
        { messages: [] },
        {
          apiKey: "unused",
          onPayload: (payload) => {
            capturedPayload = payload;
            throw new Error(
              "Request payload captured before network dispatch."
            );
          },
        }
      );

      await stream.result();

      expect(capturedPayload).not.toHaveProperty("reasoning");
    } finally {
      resetProviderRuntime();
    }
  });

  it("preserves DeepSeek reasoning content across a scoped tool continuation", async () => {
    resetProviderRuntime();
    try {
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
        organizationId: "org_deepseek_tools",
      });
      const model = resolveModel(runtime.modelSpecifier);
      const assistant = {
        ...fauxAssistantMessage(
          fauxToolCall("inspect_space", {}, { id: "tool-call-1" }),
          { stopReason: "toolUse" }
        ),
        api: "openai-completions" as const,
        model: model.id,
        provider: model.provider,
      };
      let capturedPayload: unknown;
      const stream = streamRegisteredModel(
        model,
        {
          messages: [
            assistant,
            {
              content: [{ text: "Space inspected.", type: "text" }],
              isError: false,
              role: "toolResult",
              timestamp: 2,
              toolCallId: "tool-call-1",
              toolName: "inspect_space",
            },
          ],
        },
        {
          apiKey: "unused",
          onPayload: (payload) => {
            capturedPayload = payload;
            throw new Error(
              "Request payload captured before network dispatch."
            );
          },
          reasoningEffort: "high",
        }
      );

      await stream.result();

      expect(capturedPayload).toMatchObject({
        messages: [
          expect.objectContaining({
            reasoning_content: "",
            role: "assistant",
            tool_calls: expect.any(Array),
          }),
          expect.objectContaining({ role: "tool" }),
        ],
        reasoning: { effort: "high" },
      });
    } finally {
      resetProviderRuntime();
    }
  });

  it.each([
    ["openai/gpt-6.1-sol-pro", 1_050_000, 217_600],
    ["openai/gpt-6.1-sol", 1_050_000, 217_600],
    ["x-ai/grok-4.5", 500_000, 160_000],
    ["openai/gpt-6.1-sol-pro", 100_000, 90_000],
  ])("compacts the frozen %s route before its price band within a %i window", async (modelId, contextWindow, threshold) => {
    const fetchModelMetadata = vi.fn();
    const config = await resolveRemoteAgentModelRuntimeConfigForRegistration({
      env: {},
      fetchModelMetadata,
      modelRoute: {
        ...TEST_CENTER_AGENT_MODEL_ROUTE,
        modelId,
        contextWindow,
      },
    });
    expect(config.contextWindow - config.compaction.reserveTokens).toBe(
      threshold
    );
    expect(config.contextWindow).toBe(contextWindow);
    expect(config.modelId).toBe(modelId);
    expect(config.maxTokens).toBe(
      TEST_CENTER_AGENT_MODEL_ROUTE.maxOutputTokens
    );
    expect(fetchModelMetadata).not.toHaveBeenCalled();
  });

  it("uses the frozen per-turn DeepSeek route without reading mutable model metadata", async () => {
    const fetchModelMetadata = vi.fn();

    await expect(
      resolveRemoteAgentModelRuntimeConfigForRegistration({
        env: {},
        fetchModelMetadata,
        modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      })
    ).resolves.toEqual({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 64_000,
      },
      contextWindow: 1_000_000,
      maxTokens: 16_384,
      modelId: "deepseek/deepseek-v4-flash",
      modelSpecifier: "openrouter/deepseek/deepseek-v4-flash",
    });
    expect(fetchModelMetadata).not.toHaveBeenCalled();
    expect(
      resolveRemoteAgentOpenRouterModelId({}, TEST_CENTER_AGENT_MODEL_ROUTE)
    ).toBe("deepseek/deepseek-v4-flash");
    expect(
      resolveRemoteAgentModelDisplayName({}, TEST_CENTER_AGENT_MODEL_ROUTE)
    ).toBe("DeepSeek V4 Flash");
  });

  it("sends the exact GLM 5.3 Flash default route with frozen reasoning and capacity", async () => {
    const fetchModelMetadata = vi.fn();

    await expect(
      resolveRemoteAgentModelRuntimeConfigForRegistration({
        env: {},
        fetchModelMetadata,
        modelRoute: TEST_CENTER_AGENT_GLM_DEFAULT_MODEL_ROUTE,
      })
    ).resolves.toEqual({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 64_000,
      },
      contextWindow: 1_048_576,
      maxTokens: 16_384,
      modelId: "z-ai/glm-5.3-flash",
      modelSpecifier: "openrouter/z-ai/glm-5.3-flash",
    });
    expect(fetchModelMetadata).not.toHaveBeenCalled();
    expect(
      resolveRemoteAgentOpenRouterModelId(
        {},
        TEST_CENTER_AGENT_GLM_DEFAULT_MODEL_ROUTE
      )
    ).toBe("z-ai/glm-5.3-flash");
    expect(
      resolveRemoteAgentModelDisplayName(
        {},
        TEST_CENTER_AGENT_GLM_DEFAULT_MODEL_ROUTE
      )
    ).toBe("GLM 5.3 Flash");

    resetProviderRuntime();
    try {
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: TEST_CENTER_AGENT_GLM_DEFAULT_MODEL_ROUTE,
        organizationId: "org_glm_default",
      });
      const model = resolveModel(runtime.modelSpecifier);
      let capturedPayload: unknown;
      const stream = streamRegisteredModel(
        model,
        {
          messages: [
            {
              content: "Ping.",
              role: "user",
              timestamp: 1,
            },
          ],
        },
        {
          apiKey: "unused",
          onPayload: (payload) => {
            capturedPayload = payload;
            throw new Error(
              "Request payload captured before network dispatch."
            );
          },
          reasoningEffort: "high",
        }
      );

      await stream.result();

      expect(capturedPayload).toMatchObject({
        model: "z-ai/glm-5.3-flash",
        reasoning: { effort: "high" },
      });
    } finally {
      resetProviderRuntime();
    }
  });

  it.each([
    "x-ai/grok-4.5",
    "openai/gpt-6-sol",
    "anthropic/claude-opus-5.5",
  ])("sends an output cap that a platform credit hold can price for %s", async (modelId) => {
    resetProviderRuntime();
    let payload: Record<string, unknown> | undefined;
    try {
      const runtime = await registerRemoteAgentCloudflareProvider({
        env: {
          ...CONFIGURED_AI_GATEWAY_ENV,
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        modelRoute: {
          ...TEST_CENTER_AGENT_MODEL_ROUTE,
          modelId,
          preference: { kind: "selected_model", modelId },
        },
        organizationId: "org_credit_hold",
      });
      // Flue turns use the simple stream, which applies the route output cap.
      await models
        .streamSimple(
          resolveModel(runtime.modelSpecifier),
          {
            systemPrompt: "Stable system instruction.",
            messages: [{ role: "user", content: "Hello", timestamp: 1 }],
          },
          {
            apiKey: "unused",
            maxRetries: 0,
            fetch: (_url, init) => {
              payload = JSON.parse(String(init?.body));
              throw new Error("Captured outgoing vendor payload.");
            },
          }
        )
        .result();
      expect(
        payload && estimateRemoteAiCreditHold({ modelId, body: payload })
      ).toMatchObject({
        status: "estimated",
        maxOutputTokens: TEST_CENTER_AGENT_MODEL_ROUTE.maxOutputTokens,
      });
    } finally {
      resetProviderRuntime();
    }
  });

  it("keeps model metadata fresh for at least one day", () => {
    expect(REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000
    );
  });

  it("fails explicitly when an expired custom model cache cannot refresh", async () => {
    const modelId = "openai/custom-registration-model";
    const modelMetadata = {
      data: {
        context_length: 128_000,
        id: modelId,
        top_provider: {
          context_length: 128_000,
          max_completion_tokens: 4096,
        },
      },
    };

    await expect(
      resolveRemoteAgentModelRuntimeConfigForRegistration({
        env: { OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: modelId },
        fetchModelMetadata: async () => Response.json(modelMetadata),
        nowMs: 0,
      })
    ).resolves.toEqual(
      expect.objectContaining({ contextWindow: 128_000, modelId })
    );

    await expect(
      resolveRemoteAgentModelRuntimeConfigForRegistration({
        env: { OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: modelId },
        fetchModelMetadata: async () => new Response(null, { status: 503 }),
        nowMs: REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS + 1,
      })
    ).rejects.toThrow(
      `OpenRouter model metadata lookup failed for ${modelId} with HTTP 503.`
    );
  });

  it("pins only the legacy v1 OpenRouter model fallback", () => {
    expect(REMOTE_AGENT_OPENROUTER_MODEL_ID).toBe("x-ai/grok-4.5");
    expect(REMOTE_AGENT_MAX_OUTPUT_TOKENS).toBe(8192);
  });

  it("requires the environment-owned AI Gateway account and gateway ids", () => {
    expect(() => resolveRemoteAgentAiGatewayAccountId({})).toThrow(
      "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID must be configured"
    );
    expect(() => resolveRemoteAgentAiGatewayId({})).toThrow(
      "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID must be configured"
    );
    expect(() =>
      resolveRemoteAgentAiGatewayId({
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: "   ",
      })
    ).toThrow("OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID must be configured");
    expect(
      resolveRemoteAgentAiGatewayId({
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: " custom-gateway ",
      })
    ).toBe("custom-gateway");
  });

  it("resolves the Cloudflare AI Gateway OpenRouter endpoint", () => {
    expect(() =>
      resolveRemoteAgentAiGatewayOpenRouterBaseUrl({
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: "gateway",
      })
    ).toThrow("OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID must be configured");
    expect(
      resolveRemoteAgentAiGatewayOpenRouterBaseUrl({
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID: " account_123 ",
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: " custom-gateway ",
      })
    ).toBe(
      "https://gateway.ai.cloudflare.com/v1/account_123/custom-gateway/openrouter"
    );
  });

  it("requires a Cloudflare AI Gateway token for authenticated provider-native requests", () => {
    expect(
      resolveRemoteAgentAiGatewayToken({
        CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: " token_123 ",
      })
    ).toBe("token_123");
    expect(() => resolveRemoteAgentAiGatewayToken({})).toThrow(
      "CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN must be configured with a Cloudflare AI Gateway Run token before the Remote Agent can call OpenRouter."
    );
  });

  it("falls back to the production OpenRouter model when no model override is configured", () => {
    expect(resolveRemoteAgentOpenRouterModelId({})).toBe(
      REMOTE_AGENT_OPENROUTER_MODEL_ID
    );
    expect(resolveRemoteAgentFlueModelSpecifier({})).toBe(
      `openrouter/${REMOTE_AGENT_OPENROUTER_MODEL_ID}`
    );
  });

  it("allows an OpenRouter model override for smoke tests", () => {
    expect(
      resolveRemoteAgentOpenRouterModelId({
        OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: " openrouter/free ",
      })
    ).toBe("openrouter/free");
    expect(
      resolveRemoteAgentFlueModelSpecifier({
        OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: "openrouter/free",
      })
    ).toBe("openrouter/openrouter/free");
  });

  it("discloses the curated display name for the default model", () => {
    expect(resolveRemoteAgentModelDisplayName({})).toBe(
      REMOTE_AGENT_MODEL_DISPLAY_NAME
    );
  });

  it("discloses the raw model id when an override replaces the curated default", () => {
    expect(
      resolveRemoteAgentModelDisplayName({
        OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: "openrouter/free",
      })
    ).toBe("openrouter/free");
  });

  it("rejects non-OpenRouter-shaped model overrides", () => {
    expect(() =>
      resolveRemoteAgentOpenRouterModelId({
        OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: "grok-4.5",
      })
    ).toThrow(
      "OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID must be an OpenRouter model id like x-ai/grok-4.5."
    );
  });

  it("supports direct OpenRouter without company gateway credentials", () => {
    expect(resolveRemoteAgentAiGatewayOpenRouterBaseUrl({})).toBe(
      "https://openrouter.ai/api/v1"
    );
    expect(buildRemoteAgentAiGatewayHeaders({ env: {} })).toEqual({});
  });

  it("builds gateway metadata without an official credential fallback", () => {
    expect(
      buildRemoteAgentAiGatewayHeaders({
        env: {
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "token_123",
          OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID: "account_123",
          OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: "gateway_123",
        },
        metadata: {
          model: REMOTE_AGENT_OPENROUTER_MODEL_ID,
          worker: "openmeld-remote-agent",
        },
      })
    ).toEqual({
      "cf-aig-authorization": "Bearer token_123",
      "cf-aig-collect-log": "true",
      "cf-aig-collect-log-payload": "false",
      "cf-aig-metadata": JSON.stringify({
        model: REMOTE_AGENT_OPENROUTER_MODEL_ID,
        worker: "openmeld-remote-agent",
      }),
    });
  });

  it.each([
    ["prod", "00000000-0000-4000-8000-000000000002", false],
    ["prod", "00000000-0000-4000-8000-000000000001", true],
    ["local", undefined, true],
    ["dev", undefined, true],
    ["stg", undefined, true],
    [undefined, "00000000-0000-4000-8000-000000000001", false],
    ["production", "00000000-0000-4000-8000-000000000001", false],
    ["prod", undefined, false],
    ["prod", "invalid", false],
  ])("keeps usage logs and applies content privacy for %s / %s", (environment, organizationId, allowed) => {
    const headers = buildRemoteAgentAiGatewayHeaders({
      env: {
        CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "token_123",
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID: "account_123",
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: "gateway_123",
        OPENMELD_WORKER_ENVIRONMENT: environment,
        CLOUDFLARE_OPENMELD_INTERNAL_DIAGNOSTICS_ORGANIZATION_ID:
          "00000000-0000-4000-8000-000000000001",
      },
      organizationId,
      // Attribution metadata cannot grant the internal Organization exception.
      metadata: {
        organizationId: "00000000-0000-4000-8000-000000000001",
        Authorization: "Bearer must-not-be-logged",
      },
    });
    expect(headers["cf-aig-collect-log"]).toBe("true");
    expect(headers["cf-aig-collect-log-payload"]).toBe(String(allowed));
    expect(headers["cf-aig-metadata"]).not.toContain("must-not-be-logged");
  });

  it.each([
    undefined,
    "",
    "invalid",
    " 00000000-0000-4000-8000-000000000001 ",
  ])("omits content when the production internal Organization configuration is %s", (configuredOrganizationId) => {
    const headers = buildRemoteAgentAiGatewayHeaders({
      env: {
        CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "token_123",
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID: "account_123",
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: "gateway_123",
        OPENMELD_WORKER_ENVIRONMENT: "prod",
        CLOUDFLARE_OPENMELD_INTERNAL_DIAGNOSTICS_ORGANIZATION_ID:
          configuredOrganizationId,
      },
      organizationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(headers["cf-aig-collect-log"]).toBe("true");
    expect(headers["cf-aig-collect-log-payload"]).toBe("false");
  });

  it("tags AI Gateway metadata with the organization for per-org usage attribution", () => {
    const metadata = buildRemoteAgentGatewayMetadata({
      organizationId: "org_123",
    });
    expect(metadata).toEqual({
      model: REMOTE_AGENT_OPENROUTER_MODEL_ID,
      organizationId: "org_123",
      provider: "openrouter",
      worker: "openmeld-remote-agent",
    });
    // AI Gateway allows at most 5 flat scalar metadata entries.
    expect(Object.keys(metadata).length).toBeLessThanOrEqual(5);
    for (const value of Object.values(metadata)) {
      expect(typeof value).toBe("string");
    }
  });

  it("omits organizationId when it is missing so no request is mis-attributed", () => {
    expect(buildRemoteAgentGatewayMetadata()).toEqual({
      model: REMOTE_AGENT_OPENROUTER_MODEL_ID,
      provider: "openrouter",
      worker: "openmeld-remote-agent",
    });
    expect(
      buildRemoteAgentGatewayMetadata({ organizationId: "  " })
    ).not.toHaveProperty("organizationId");
  });

  it("tags AI Gateway metadata with the resolved model override", () => {
    expect(
      buildRemoteAgentGatewayMetadata({
        modelId: " x-ai/grok-4-fast:free ",
      })
    ).toEqual({
      model: "x-ai/grok-4-fast:free",
      provider: "openrouter",
      worker: "openmeld-remote-agent",
    });
  });

  it("uses current OpenRouter metadata to keep Flue below the selected model's real context window", async () => {
    const fetchModelMetadata = vi.fn(async () => Response.json(xAiGrok45Model));

    await expect(
      resolveRemoteAgentModelRuntimeConfig({
        env: {},
        fetchModelMetadata,
      })
    ).resolves.toEqual({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 340_000,
      },
      contextWindow: 500_000,
      maxTokens: 8192,
      modelId: "x-ai/grok-4.5",
      modelSpecifier: "openrouter/x-ai/grok-4.5",
    });
    expect(fetchModelMetadata).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/model/x-ai/grok-4.5",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("accepts the captured OpenRouter metadata contract for Grok 4.6", async () => {
    const fetchModelMetadata = vi.fn(async () => Response.json(xAiGrok46Model));

    await expect(
      resolveRemoteAgentModelRuntimeConfig({
        env: {
          OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: "x-ai/grok-4.6",
        },
        fetchModelMetadata,
      })
    ).resolves.toEqual({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 340_000,
      },
      contextWindow: 500_000,
      maxTokens: 8192,
      modelId: "x-ai/grok-4.6",
      modelSpecifier: "openrouter/x-ai/grok-4.6",
    });
    expect(fetchModelMetadata).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/model/x-ai/grok-4.6",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("accepts the captured OpenRouter metadata contract for GLM 5.3 Flash", async () => {
    const fetchModelMetadata = vi.fn(async () =>
      Response.json(zAiGlm53FlashModel)
    );

    await expect(
      resolveRemoteAgentModelRuntimeConfig({
        env: {
          OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: "z-ai/glm-5.3-flash",
        },
        fetchModelMetadata,
      })
    ).resolves.toEqual({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        // Compacts before the top provider's 1,048,576-token limit, not the
        // larger catalog context length.
        reserveTokens: 64_000,
      },
      contextWindow: 1_048_576,
      maxTokens: 8192,
      modelId: "z-ai/glm-5.3-flash",
      modelSpecifier: "openrouter/z-ai/glm-5.3-flash",
    });
    expect(fetchModelMetadata).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/model/z-ai/glm-5.3-flash",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    ["missing pricing", undefined],
    ["null pricing", null],
    ["invalid pricing", "invalid"],
    ["missing overrides", {}],
    ["null overrides", { overrides: null }],
    ["empty overrides", { overrides: [] }],
    ["invalid overrides", { overrides: "invalid" }],
  ])("keeps the base compaction reserve when metadata has %s", async (_caseName, pricing) => {
    const modelId = "openai/model-without-price-tiers";
    const modelMetadata = {
      data: {
        context_length: 500_000,
        id: modelId,
        pricing,
        top_provider: {
          context_length: 500_000,
          max_completion_tokens: null,
        },
      },
    };

    await expect(
      resolveRemoteAgentModelRuntimeConfig({
        env: { OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: modelId },
        fetchModelMetadata: async () => Response.json(modelMetadata),
      })
    ).resolves.toMatchObject({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 50_000,
      },
    });
  });

  it("compacts before the smallest valid prompt price tier", async () => {
    const modelId = "openai/model-with-multiple-price-tiers";
    const modelMetadata = {
      data: {
        context_length: 500_000,
        id: modelId,
        pricing: {
          overrides: [
            { min_prompt_tokens: 300_000 },
            { min_prompt_tokens: 200_000 },
            { min_prompt_tokens: 250_000 },
          ],
        },
        top_provider: {
          context_length: 500_000,
          max_completion_tokens: null,
        },
      },
    };

    await expect(
      resolveRemoteAgentModelRuntimeConfig({
        env: { OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: modelId },
        fetchModelMetadata: async () => Response.json(modelMetadata),
      })
    ).resolves.toMatchObject({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 340_000,
      },
    });
  });

  it.each([
    ["a missing boundary", {}],
    ["a zero boundary", { min_prompt_tokens: 0 }],
    ["a negative boundary", { min_prompt_tokens: -1 }],
    ["a non-numeric boundary", { min_prompt_tokens: "200000" }],
  ])("ignores pricing overrides with %s", async (_caseName, pricingOverride) => {
    const modelId = "openai/model-with-invalid-price-tier";
    const modelMetadata = {
      data: {
        context_length: 500_000,
        id: modelId,
        pricing: {
          overrides: [pricingOverride],
        },
        top_provider: {
          context_length: 500_000,
          max_completion_tokens: null,
        },
      },
    };

    await expect(
      resolveRemoteAgentModelRuntimeConfig({
        env: { OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: modelId },
        fetchModelMetadata: async () => Response.json(modelMetadata),
      })
    ).resolves.toMatchObject({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 50_000,
      },
    });
  });

  it("keeps the positive base reserve when the price tier does not require earlier compaction", async () => {
    const modelId = "openai/small-context-model";
    const modelMetadata = {
      data: {
        context_length: 100_000,
        id: modelId,
        pricing: {
          overrides: [{ min_prompt_tokens: 200_000 }],
        },
        top_provider: {
          context_length: 100_000,
          max_completion_tokens: null,
        },
      },
    };

    const runtimeConfig = await resolveRemoteAgentModelRuntimeConfig({
      env: { OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: modelId },
      fetchModelMetadata: async () => Response.json(modelMetadata),
    });

    expect(runtimeConfig.compaction.reserveTokens).toBe(10_000);
    expect(runtimeConfig.compaction.reserveTokens).toBeGreaterThan(0);
  });

  it("keeps an explicit recent verbatim tail instead of relying on a Flue default", async () => {
    const runtimeConfig = await resolveRemoteAgentModelRuntimeConfig({
      env: {},
      fetchModelMetadata: async () => Response.json(xAiGrok45Model),
    });

    expect(
      (
        runtimeConfig.compaction as {
          keepRecentTokens?: number;
        }
      ).keepRecentTokens
    ).toBe(8000);
  });

  it("keeps the Workers runtime receiver when using the default metadata fetch", async () => {
    const runtimeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(Response.json(xAiGrok45Model));
    });
    vi.stubGlobal("fetch", runtimeFetch);

    try {
      await expect(
        resolveRemoteAgentModelRuntimeConfig({ env: {} })
      ).resolves.toEqual(
        expect.objectContaining({
          modelId: "x-ai/grok-4.5",
        })
      );
      expect(runtimeFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("derives a replacement model's limits from its model id without another capacity setting", async () => {
    const fetchModelMetadata = vi.fn(async () =>
      Response.json(openAiGpt54MiniModel)
    );

    await expect(
      resolveRemoteAgentModelRuntimeConfig({
        env: {
          OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID: "openai/gpt-5.4-mini",
        },
        fetchModelMetadata,
      })
    ).resolves.toEqual({
      compaction: {
        workingContextTokens: 48_000,
        maxWorkingContextTokens: 56_000,
        preserveActiveInput: true,
        thinkingLevel: "low",
        workingContextHeadroomTokens: 8000,
        maxSummaryTokens: 4096,
        summaryTargetTokens: 2048,
        keepRecentTokens: 8000,
        reserveTokens: 40_000,
      },
      contextWindow: 400_000,
      maxTokens: 8192,
      modelId: "openai/gpt-5.4-mini",
      modelSpecifier: "openrouter/openai/gpt-5.4-mini",
    });
    expect(fetchModelMetadata).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/model/openai/gpt-5.4-mini",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("times out an OpenRouter metadata refresh after three seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetchModelMetadata = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          })
      );
      const result = resolveRemoteAgentModelRuntimeConfig({
        env: {},
        fetchModelMetadata,
      });
      const expectedTimeout = expect(result).rejects.toThrow(
        "OpenRouter model metadata lookup timed out for x-ai/grok-4.5 after 3000ms."
      );

      await vi.advanceTimersByTimeAsync(3000);
      await expectedTimeout;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when OpenRouter returns metadata for a different model", async () => {
    await expect(
      resolveRemoteAgentModelRuntimeConfig({
        env: {},
        fetchModelMetadata: async () => Response.json(openAiGpt54MiniModel),
      })
    ).rejects.toThrow(
      "OpenRouter model metadata returned openai/gpt-5.4-mini for x-ai/grok-4.5."
    );
  });

  it("encodes both OpenRouter model id segments in the metadata URL", () => {
    expect(
      resolveRemoteAgentOpenRouterModelMetadataUrl("vendor/model:free")
    ).toBe("https://openrouter.ai/api/v1/model/vendor/model%3Afree");
  });
});
