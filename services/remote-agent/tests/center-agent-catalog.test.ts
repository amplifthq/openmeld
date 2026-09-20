import {
  createModels,
  fauxAssistantMessage,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";
// biome-ignore lint/performance/noNamespaceImport: Observe the real registration boundary.
import * as flue from "@flue/runtime";
import { resetModelsForTests, resolveModel } from "@flue/runtime/internal";
import {
  listCenterAgentModelChoices,
  resolveCenterAgentModelRoute,
} from "@openmeld/agent-runtime";
import { modelCatalogSchema } from "@openmeld/schemas/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalogJson from "../../../release/vendor-models.json";
import {
  registerRemoteAgentCloudflareProvider,
  resolveRemoteAgentModelRuntimeConfigForRegistration,
} from "../flue-adapter/model";
import capturedModels from "./fixtures/openrouter-center-agent-models-2026-09-14.json";

const catalog = modelCatalogSchema.parse(catalogJson);

describe("curated Center Agent provider models", () => {
  let models = createModels();
  beforeEach(() => {
    resetModelsForTests();
    models = createModels();
    const register = flue.setProvider;
    vi.spyOn(flue, "setProvider").mockImplementation((provider) => {
      models.setProvider(provider);
      register(provider);
    });
  });
  afterEach(() => {
    resetModelsForTests();
    vi.restoreAllMocks();
  });

  it.each(
    capturedModels.data
  )("routes $id with captured capabilities and a tool continuation", async (evidence) => {
    const resolved = resolveCenterAgentModelRoute({
      catalog,
      preference: { kind: "selected_model", modelId: evidence.id },
    });
    expect(resolved.status).toBe("accepted");
    if (resolved.status !== "accepted") {
      throw new Error(resolved.message);
    }
    const route = resolved.route;
    expect(evidence.supported_parameters).toContain("tools");
    expect(evidence.reasoning.supported_efforts).toContain(
      route.reasoningLevel
    );
    expect(route.contextWindow).toBe(
      Math.min(evidence.context_length, evidence.top_provider.context_length)
    );
    expect(route.maxOutputTokens).toBeLessThanOrEqual(
      evidence.top_provider.max_completion_tokens
    );
    expect(route.inputModalities.toSorted()).toEqual(
      evidence.architecture.input_modalities
        .filter((modality) => modality === "text" || modality === "image")
        .sort()
    );
    expect(route.provider).toBe("openrouter");
    expect(route.automaticModelFallback).toBe(false);

    const fetchModelMetadata = vi.fn();
    const config = await resolveRemoteAgentModelRuntimeConfigForRegistration({
      env: {},
      modelRoute: route,
      fetchModelMetadata,
    });
    expect(config.modelId).toBe(evidence.id);
    expect(config.contextWindow).toBe(route.contextWindow);
    expect(fetchModelMetadata).not.toHaveBeenCalled();
    const runtime = await registerRemoteAgentCloudflareProvider({
      env: {
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID: "test-account",
        OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID: "test-gateway",
        OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS: "openrouter",
        CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
      },
      modelRoute: route,
      organizationId: "test-organization",
    });
    const model = resolveModel(runtime.modelSpecifier);
    const assistant = {
      ...fauxAssistantMessage(
        fauxToolCall("inspect_space", {}, { id: "call-1" }),
        { stopReason: "toolUse" }
      ),
      api: "openai-completions" as const,
      model: model.id,
      provider: model.provider,
    };
    let payload: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (request, init) => {
      const outgoing = new Request(request, init);
      expect(outgoing.url).toBe(
        "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openrouter/chat/completions"
      );
      payload = await outgoing.json();
      throw new Error("Captured before network dispatch.");
    });
    const stream = models.stream(
      model,
      {
        systemPrompt: "Inspect the Space before answering.",
        tools: [
          {
            name: "inspect_space",
            description: "Inspect a Space.",
            parameters: Type.Object({}),
          },
        ],
        messages: [
          { role: "user", content: "Inspect this Space.", timestamp: 1 },
          assistant,
          {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "inspect_space",
            content: [{ type: "text", text: "Space inspected." }],
            isError: false,
            timestamp: 2,
          },
        ],
      },
      {
        apiKey: "unused",
        reasoningEffort: "high",
        maxTokens: route.maxOutputTokens,
      }
    );
    await stream.result();
    expect(payload).toMatchObject({
      model: evidence.id,
      reasoning: { effort: "high" },
      provider: { allow_fallbacks: true },
      tools: [
        expect.objectContaining({
          type: "function",
          function: expect.objectContaining({ name: "inspect_space" }),
        }),
      ],
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: expect.any(Array),
        }),
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
          content: evidence.id.startsWith("anthropic/")
            ? expect.arrayContaining([
                expect.objectContaining({
                  type: "text",
                  text: "Space inspected.",
                }),
              ])
            : "Space inspected.",
        }),
      ]),
    });
    expect(payload).not.toHaveProperty("models");
  });

  it("keeps the existing default and image helper while exposing six model vendors", () => {
    const choices = listCenterAgentModelChoices(catalog);
    const ids = choices.flatMap((choice) =>
      choice.preference.kind === "selected_model"
        ? [choice.preference.modelId]
        : []
    );
    expect(ids).toHaveLength(12);
    expect([...new Set(ids.map((id) => id.split("/")[0]))].sort()).toEqual([
      "anthropic",
      "deepseek",
      "google",
      "openai",
      "x-ai",
      "z-ai",
    ]);
    expect(ids).toEqual(
      expect.arrayContaining([
        "openai/gpt-5.6-terra",
        "openai/gpt-5.6-luna",
        "google/gemini-3.5-flash-lite",
      ])
    );
    expect(ids).not.toEqual(
      expect.arrayContaining(["openai/gpt-6-astra", "openai/gpt-5.6-sol"])
    );
    expect(catalog.agentControllers["center-agent"]?.defaultModelId).toBe(
      "z-ai/glm-5.3-flash"
    );
    expect(
      catalog.agentControllers["center-agent"]?.hostedRuntimePolicy
        ?.imageUnderstandingModelId
    ).toBe("x-ai/grok-4.6");
  });
});
