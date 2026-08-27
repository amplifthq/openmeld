import type { ModelCatalog } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  listCenterAgentModelChoices,
  resolveCenterAgentModelRoute,
} from "../src/center-agent-model-routing";

const CATALOG = {
  schemaVersion: 1,
  updatedAt: "2026-08-13T00:00:00.000Z",
  agentControllers: {
    "center-agent": {
      defaultModelId: "x-ai/grok-4.6",
      hostedRuntimePolicy: {
        automaticModelFallback: false,
        imageUnderstandingModelId: "x-ai/grok-4.6",
      },
      models: [
        {
          id: "x-ai/grok-4.6",
          displayName: "Grok 4.6",
          badgeLabel: "New",
          unavailable: false,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text", "image"],
            contextWindow: 500_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
        },
        {
          id: "x-ai/grok-4.5",
          displayName: "Grok 4.5",
          unavailable: false,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text", "image"],
            contextWindow: 500_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
        },
        {
          id: "deepseek/deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          unavailable: false,
          supportedReasoningLevels: ["high", "xhigh"],
          minCliVersion: null,
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text"],
            contextWindow: 1_000_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
        },
        {
          id: "retired",
          displayName: "Retired",
          unavailable: true,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text"],
            contextWindow: 32_000,
            maxOutputTokens: 4096,
            reasoningLevel: "high",
          },
        },
      ],
    },
  },
} satisfies ModelCatalog;

describe("resolveCenterAgentModelRoute", () => {
  it("late-binds the system default and records the auxiliary image model", () => {
    expect(
      resolveCenterAgentModelRoute({
        catalog: CATALOG,
        preference: { kind: "system_default" },
      })
    ).toEqual({
      status: "accepted",
      route: {
        automaticModelFallback: false,
        catalogUpdatedAt: "2026-08-13T00:00:00.000Z",
        contextWindow: 500_000,
        displayName: "Grok 4.6",
        imageUnderstandingModel: {
          contextWindow: 500_000,
          displayName: "Grok 4.6",
          inputModalities: ["text", "image"],
          maxOutputTokens: 16_384,
          modelId: "x-ai/grok-4.6",
          provider: "openrouter",
          reasoningLevel: "high",
        },
        inputModalities: ["text", "image"],
        maxOutputTokens: 16_384,
        modelId: "x-ai/grok-4.6",
        preference: { kind: "system_default" },
        provider: "openrouter",
        reasoningLevel: "high",
      },
    });
  });

  it("pins an explicit DeepSeek route without a primary fallback", () => {
    expect(
      resolveCenterAgentModelRoute({
        catalog: CATALOG,
        preference: {
          kind: "selected_model",
          modelId: "deepseek/deepseek-v4-flash",
        },
      })
    ).toEqual({
      status: "accepted",
      route: {
        automaticModelFallback: false,
        catalogUpdatedAt: "2026-08-13T00:00:00.000Z",
        contextWindow: 1_000_000,
        displayName: "DeepSeek V4 Flash",
        imageUnderstandingModel: {
          contextWindow: 500_000,
          displayName: "Grok 4.6",
          inputModalities: ["text", "image"],
          maxOutputTokens: 16_384,
          modelId: "x-ai/grok-4.6",
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
      },
    });
  });

  it("rejects an unavailable explicit model instead of falling back", () => {
    expect(
      resolveCenterAgentModelRoute({
        catalog: CATALOG,
        preference: { kind: "selected_model", modelId: "retired" },
      })
    ).toEqual({
      status: "rejected",
      code: "center_agent_model_unavailable",
      message: "The selected Center Agent model is unavailable.",
    });
  });

  it("rejects an unknown explicit model instead of falling back", () => {
    expect(
      resolveCenterAgentModelRoute({
        catalog: CATALOG,
        preference: { kind: "selected_model", modelId: "missing" },
      })
    ).toEqual({
      status: "rejected",
      code: "center_agent_model_unknown",
      message: "The selected Center Agent model is not in the model catalog.",
    });
  });

  it("lists the system default separately from explicit choices", () => {
    expect(listCenterAgentModelChoices(CATALOG)).toEqual([
      {
        badgeLabel: "New",
        displayName: "OpenMeld default",
        effectiveModelDisplayName: "Grok 4.6",
        preference: { kind: "system_default" },
        supportsImageInput: true,
      },
      {
        badgeLabel: "New",
        displayName: "Grok 4.6",
        effectiveModelDisplayName: "Grok 4.6",
        preference: {
          kind: "selected_model",
          modelId: "x-ai/grok-4.6",
        },
        supportsImageInput: true,
      },
      {
        badgeLabel: null,
        displayName: "Grok 4.5",
        effectiveModelDisplayName: "Grok 4.5",
        preference: {
          kind: "selected_model",
          modelId: "x-ai/grok-4.5",
        },
        supportsImageInput: true,
      },
      {
        badgeLabel: null,
        displayName: "DeepSeek V4 Flash",
        effectiveModelDisplayName: "DeepSeek V4 Flash",
        preference: {
          kind: "selected_model",
          modelId: "deepseek/deepseek-v4-flash",
        },
        supportsImageInput: false,
      },
    ]);
  });
});

// Mirrors the shipped release/vendor-models.json center-agent controller after
// GLM 5.3 Flash became the system default on 2026-08-27.
const GLM_DEFAULT_CATALOG = {
  schemaVersion: 1,
  updatedAt: "2026-08-27T00:00:00.000Z",
  agentControllers: {
    "center-agent": {
      defaultModelId: "z-ai/glm-5.3-flash",
      hostedRuntimePolicy: {
        automaticModelFallback: false,
        imageUnderstandingModelId: "x-ai/grok-4.6",
      },
      models: [
        {
          id: "z-ai/glm-5.3-flash",
          displayName: "GLM 5.3 Flash",
          badgeLabel: "New",
          unavailable: false,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text", "image"],
            contextWindow: 1_048_576,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
        },
        {
          id: "x-ai/grok-4.6",
          displayName: "Grok 4.6",
          unavailable: false,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text", "image"],
            contextWindow: 500_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
        },
        {
          id: "x-ai/grok-4.5",
          displayName: "Grok 4.5",
          unavailable: false,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text", "image"],
            contextWindow: 500_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
        },
        {
          id: "deepseek/deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          unavailable: false,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text"],
            contextWindow: 1_000_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
        },
      ],
    },
  },
} satisfies ModelCatalog;

describe("GLM 5.3 Flash system-default routing", () => {
  it("resolves the system default onto the exact frozen GLM route", () => {
    expect(
      resolveCenterAgentModelRoute({
        catalog: GLM_DEFAULT_CATALOG,
        preference: { kind: "system_default" },
      })
    ).toEqual({
      status: "accepted",
      route: {
        automaticModelFallback: false,
        catalogUpdatedAt: "2026-08-27T00:00:00.000Z",
        contextWindow: 1_048_576,
        displayName: "GLM 5.3 Flash",
        imageUnderstandingModel: {
          contextWindow: 500_000,
          displayName: "Grok 4.6",
          inputModalities: ["text", "image"],
          maxOutputTokens: 16_384,
          modelId: "x-ai/grok-4.6",
          provider: "openrouter",
          reasoningLevel: "high",
        },
        inputModalities: ["text", "image"],
        maxOutputTokens: 16_384,
        modelId: "z-ai/glm-5.3-flash",
        preference: { kind: "system_default" },
        provider: "openrouter",
        reasoningLevel: "high",
      },
    });
  });

  it("keeps an explicitly selected Grok 4.6 pinned after the default change", () => {
    const result = resolveCenterAgentModelRoute({
      catalog: GLM_DEFAULT_CATALOG,
      preference: {
        kind: "selected_model",
        modelId: "x-ai/grok-4.6",
      },
    });
    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.route.modelId).toBe("x-ai/grok-4.6");
      expect(result.route.displayName).toBe("Grok 4.6");
    }
  });

  it("presents the OpenMeld default as GLM 5.3 Flash with its badge", () => {
    expect(listCenterAgentModelChoices(GLM_DEFAULT_CATALOG)[0]).toEqual({
      badgeLabel: "New",
      displayName: "OpenMeld default",
      effectiveModelDisplayName: "GLM 5.3 Flash",
      preference: { kind: "system_default" },
      supportsImageInput: true,
    });
  });
});
