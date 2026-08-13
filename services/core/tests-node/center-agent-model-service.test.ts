import type { ModelCatalog } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  projectCenterAgentModelConfiguration,
  resolveCenterAgentModelRouteForBinding,
} from "../src/center-agent/application/center-agent-model-service";

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
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text", "image"],
            contextWindow: 500_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
          unavailable: false,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
        },
        {
          id: "x-ai/grok-4.5",
          displayName: "Grok 4.5",
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text", "image"],
            contextWindow: 500_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
          unavailable: false,
          supportedReasoningLevels: ["high"],
          minCliVersion: null,
        },
        {
          id: "deepseek/deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          hostedRuntime: {
            provider: "openrouter",
            inputModalities: ["text"],
            contextWindow: 1_000_000,
            maxOutputTokens: 16_384,
            reasoningLevel: "high",
          },
          unavailable: false,
          supportedReasoningLevels: ["high", "xhigh"],
          minCliVersion: null,
        },
      ],
    },
  },
} satisfies ModelCatalog;

describe("Center Agent model service", () => {
  it("projects an exact effective default for every member", () => {
    expect(
      projectCenterAgentModelConfiguration({
        binding: {
          configurationRevision: 7,
          modelId: null,
        },
        canManage: false,
        catalog: CATALOG,
        organizationId: "org_1",
      })
    ).toMatchObject({
      canManage: false,
      configurationRevision: 7,
      effectiveModel: {
        availability: "available",
        displayName: "Grok 4.6",
        modelId: "x-ai/grok-4.6",
        supportsImageInput: true,
      },
      preference: { kind: "system_default" },
    });
  });

  it("resolves the selected model into a frozen execution route", () => {
    expect(
      resolveCenterAgentModelRouteForBinding({
        binding: {
          configurationRevision: 8,
          modelId: "deepseek/deepseek-v4-flash",
        },
        catalog: CATALOG,
      })
    ).toMatchObject({
      automaticModelFallback: false,
      displayName: "DeepSeek V4 Flash",
      imageUnderstandingModel: {
        modelId: "x-ai/grok-4.6",
      },
      modelId: "deepseek/deepseek-v4-flash",
      preference: {
        kind: "selected_model",
        modelId: "deepseek/deepseek-v4-flash",
      },
    });
  });

  it("keeps a stale explicit selection visible without silently routing it", () => {
    expect(
      projectCenterAgentModelConfiguration({
        binding: {
          configurationRevision: 9,
          modelId: "retired/provider-model",
        },
        canManage: true,
        catalog: CATALOG,
        organizationId: "org_1",
      })
    ).toMatchObject({
      effectiveModel: {
        availability: "unknown",
        displayName: "Unavailable model",
        modelId: "retired/provider-model",
      },
      preference: {
        kind: "selected_model",
        modelId: "retired/provider-model",
      },
    });
    expect(() =>
      resolveCenterAgentModelRouteForBinding({
        binding: {
          configurationRevision: 9,
          modelId: "retired/provider-model",
        },
        catalog: CATALOG,
      })
    ).toThrow("not in the model catalog");
  });
});
