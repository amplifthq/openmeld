import { describe, expect, it } from "vitest";
import vendorModelCatalog from "../../../../release/vendor-models.json";
import {
  MODEL_CATALOG_SCHEMA_VERSION,
  modelCatalogSchema,
} from "../../src/index";

describe("model catalog schema", () => {
  it("accepts the release vendor model catalog", () => {
    const result = modelCatalogSchema.safeParse(vendorModelCatalog);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(MODEL_CATALOG_SCHEMA_VERSION);
      expect(result.data.updatedAt).toBe("2026-08-01T17:26:00.000Z");
      expect(result.data.agentControllers.codex?.defaultModelId).toBe(
        "gpt-5.5"
      );

      for (const [id, displayName, supportedReasoningLevels] of [
        [
          "gpt-5.6-sol",
          "GPT-5.6 Sol",
          ["low", "medium", "high", "xhigh", "max", "ultra"],
        ],
        [
          "gpt-5.6-terra",
          "GPT-5.6 Terra",
          ["low", "medium", "high", "xhigh", "max", "ultra"],
        ],
        [
          "gpt-5.6-luna",
          "GPT-5.6 Luna",
          ["low", "medium", "high", "xhigh", "max"],
        ],
      ] as const) {
        expect(
          result.data.agentControllers.codex?.models.find(
            (model) => model.id === id
          )
        ).toEqual({
          id,
          displayName,
          unavailable: false,
          supportedReasoningLevels,
          minCliVersion: null,
        });
      }

      for (const [id, displayName, minCliVersion] of [
        ["claude-fable-5", "Claude Fable 5", "2.1.170"],
        ["claude-opus-5", "Claude Opus 5", "2.1.219"],
        ["claude-opus-4-8", "Claude Opus 4.8", "2.1.154"],
        ["claude-sonnet-5", "Claude Sonnet 5", "2.1.197"],
      ] as const) {
        expect(
          result.data.agentControllers["claude-code"]?.models.find(
            (model) => model.id === id
          )
        ).toEqual({
          id,
          displayName,
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high", "xhigh", "max"],
          minCliVersion,
        });
      }

      expect(result.data.agentControllers.opencode?.defaultModelId).toBe(
        "opencode/north-mini-code-free"
      );
      expect(
        result.data.agentControllers.opencode?.models.find(
          (model) => model.id === "opencode/north-mini-code-free"
        )?.supportedReasoningLevels
      ).toEqual(["none", "high"]);
      expect(
        result.data.agentControllers.opencode?.models.find(
          (model) => model.id === "opencode/deepseek-v4-flash-free"
        )?.supportedReasoningLevels
      ).toEqual(["low", "medium", "high", "max"]);

      expect(result.data.agentControllers.cursor?.defaultModelId).toBe(
        "default[]"
      );
      expect(
        result.data.agentControllers.cursor?.models.find(
          (model) =>
            model.id === "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]"
        )
      ).toMatchObject({
        displayName: "gpt-5.6-sol",
        supportedReasoningLevels: [],
      });

      expect(result.data.agentControllers["center-agent"]).toMatchObject({
        defaultModelId: "x-ai/grok-4.5",
        hostedRuntimePolicy: {
          automaticModelFallback: false,
          imageUnderstandingModelId: "x-ai/grok-4.5",
        },
        models: [
          {
            id: "x-ai/grok-4.5",
            displayName: "Grok 4.5",
            hostedRuntime: {
              contextWindow: 500_000,
              inputModalities: ["text", "image"],
              maxOutputTokens: 16_384,
              provider: "openrouter",
              reasoningLevel: "high",
            },
          },
          {
            id: "deepseek/deepseek-v4-flash",
            displayName: "DeepSeek V4 Flash",
            hostedRuntime: {
              contextWindow: 1_000_000,
              inputModalities: ["text"],
              maxOutputTokens: 16_384,
              provider: "openrouter",
              reasoningLevel: "high",
            },
          },
        ],
      });
    }
  });

  it("rejects duplicate model ids per controller", () => {
    const result = modelCatalogSchema.safeParse({
      schemaVersion: 1,
      updatedAt: "2026-06-18T00:00:00.000Z",
      agentControllers: {
        codex: {
          defaultModelId: "gpt-5.5",
          models: [
            createModel({ id: "gpt-5.5" }),
            createModel({ id: "gpt-5.5" }),
          ],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects unavailable defaults", () => {
    const result = modelCatalogSchema.safeParse({
      schemaVersion: 1,
      updatedAt: "2026-06-18T00:00:00.000Z",
      agentControllers: {
        codex: {
          defaultModelId: "gpt-5.5",
          models: [createModel({ id: "gpt-5.5", unavailable: true })],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate reasoning levels per model", () => {
    const result = modelCatalogSchema.safeParse({
      schemaVersion: 1,
      updatedAt: "2026-06-18T00:00:00.000Z",
      agentControllers: {
        codex: {
          defaultModelId: "gpt-5.5",
          models: [
            createModel({
              id: "gpt-5.5",
              supportedReasoningLevels: ["high", "high"],
            }),
          ],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a hosted image model without image input support", () => {
    const result = modelCatalogSchema.safeParse({
      schemaVersion: 1,
      updatedAt: "2026-07-31T00:00:00.000Z",
      agentControllers: {
        "center-agent": {
          defaultModelId: "text-only",
          hostedRuntimePolicy: {
            automaticModelFallback: false,
            imageUnderstandingModelId: "text-only",
          },
          models: [
            createModel({
              id: "text-only",
              hostedRuntime: {
                contextWindow: 100_000,
                inputModalities: ["text"],
                maxOutputTokens: 8192,
                provider: "openrouter",
                reasoningLevel: "high",
              },
            }),
          ],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unsupported hosted reasoning level", () => {
    const result = modelCatalogSchema.safeParse({
      schemaVersion: 1,
      updatedAt: "2026-07-31T00:00:00.000Z",
      agentControllers: {
        "center-agent": {
          defaultModelId: "hosted-model",
          hostedRuntimePolicy: {
            automaticModelFallback: false,
            imageUnderstandingModelId: "hosted-model",
          },
          models: [
            createModel({
              id: "hosted-model",
              hostedRuntime: {
                contextWindow: 100_000,
                inputModalities: ["text", "image"],
                maxOutputTokens: 8192,
                provider: "openrouter",
                reasoningLevel: "ultra",
              },
            }),
          ],
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

function createModel(input: {
  id: string;
  supportedReasoningLevels?: string[];
  unavailable?: boolean;
  hostedRuntime?: {
    contextWindow: number;
    inputModalities: string[];
    maxOutputTokens: number;
    provider: string;
    reasoningLevel: string;
  };
}) {
  return {
    id: input.id,
    displayName: input.id,
    ...(input.hostedRuntime ? { hostedRuntime: input.hostedRuntime } : {}),
    unavailable: input.unavailable ?? false,
    supportedReasoningLevels: input.supportedReasoningLevels ?? ["high"],
    minCliVersion: null,
  };
}
