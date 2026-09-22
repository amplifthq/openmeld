import { describe, expect, it } from "vitest";
import vendorModelCatalog from "../../../../release/vendor-models.json";
import {
  MODEL_CATALOG_SCHEMA_VERSION,
  modelCatalogSchema,
} from "../../src/index";
import cursorModelCatalogCapture from "../fixtures/cursor-model-catalog-2026.09.10.json";
import localModelCatalogCapture from "../fixtures/local-model-catalog-2026.09.22.json";
import openCodeGoQwen38Flash from "../fixtures/opencode-go-qwen3.8-flash-1.18.25.json";
import openCodeModelCatalogCapture from "../fixtures/opencode-model-catalog-1.18.31.json";

describe("model catalog schema", () => {
  it("preserves the new local models' authenticated IDs and reasoning options", () => {
    const { agentControllers } = modelCatalogSchema.parse(vendorModelCatalog);
    const { cursor, grokBuild, opencode } = localModelCatalogCapture;
    for (const model of cursor.availableModels) {
      expect(cursor.configOptions).toContainEqual({
        value: model.modelId,
        name: model.name,
      });
      expect(agentControllers.cursor?.models).toContainEqual(
        expect.objectContaining({
          id: model.modelId,
          unavailable: false,
          supportedReasoningLevels: [],
        })
      );
    }
    for (const model of grokBuild.sessionModels) {
      expect(grokBuild.initializeModels).toContainEqual(model);
      const selected = agentControllers["grok-build"]?.models.find(
        (entry) => entry.id === model.modelId
      );
      expect(selected?.unavailable).toBe(false);
      expect(selected?.supportedReasoningLevels.toSorted()).toEqual(
        model._meta.reasoningEfforts.map((effort) => effort.id).toSorted()
      );
    }
    for (const model of opencode) {
      expect(agentControllers.opencode?.models).toContainEqual(
        expect.objectContaining({
          id: `${model.providerID}/${model.id}`,
          unavailable: model.status !== "active",
          supportedReasoningLevels: Object.keys(model.variants),
        })
      );
    }
  });
  it("rejects unavailable creation recommendations and unsupported reasoning", () => {
    for (const creationDefaults of [
      { modelId: "missing", reasoningLevel: null },
      { modelId: "gpt-5.5", reasoningLevel: "ultra" },
    ]) {
      const catalog = structuredClone(vendorModelCatalog);
      catalog.agentControllers.codex.creationDefaults =
        creationDefaults as typeof catalog.agentControllers.codex.creationDefaults;
      expect(modelCatalogSchema.safeParse(catalog).success).toBe(false);
    }
  });
  it("accepts the release vendor model catalog", () => {
    const result = modelCatalogSchema.safeParse(vendorModelCatalog);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(MODEL_CATALOG_SCHEMA_VERSION);
      expect(result.data.agentControllers.codex?.defaultModelId).toBe(
        "gpt-5.6-sol"
      );
      expect(
        result.data.agentControllers.codex?.models.some(
          (model) => model.id === "gpt-5.5" && !model.unavailable
        )
      ).toBe(true);
      expect(result.data.agentControllers["grok-build"]).toMatchObject({
        defaultModelId: "grok-4.6",
        models: expect.arrayContaining([
          expect.objectContaining({
            id: "grok-4.6",
            supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
          }),
          expect.objectContaining({
            id: "grok-4.5",
            supportedReasoningLevels: ["low", "medium", "high"],
          }),
        ]),
      });

      for (const [id, displayName, supportedReasoningLevels, minCliVersion] of [
        [
          "gpt-5.6-sol",
          "GPT-5.6 Sol",
          ["low", "medium", "high", "xhigh", "max", "ultra"],
          "0.144.0",
        ],
        [
          "gpt-5.6-terra",
          "GPT-5.6 Terra",
          ["low", "medium", "high", "xhigh", "max", "ultra"],
          "0.144.0",
        ],
        [
          "gpt-5.6-luna",
          "GPT-5.6 Luna",
          ["low", "medium", "high", "xhigh", "max"],
          "0.144.0",
        ],
        ["gpt-5.5", "GPT-5.5", ["low", "medium", "high", "xhigh"], "0.124.0"],
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
          minCliVersion,
        });
      }

      for (const [id, displayName, minCliVersion, badgeLabel] of [
        ["claude-fable-5-1", "Claude Fable 5.1", "2.1.257", "New"],
        ["claude-fable-5", "Claude Fable 5", "2.1.170", null],
        ["claude-opus-5", "Claude Opus 5", "2.1.219", null],
        ["claude-opus-4-8", "Claude Opus 4.8", "2.1.154", null],
        ["claude-sonnet-5", "Claude Sonnet 5", "2.1.197", null],
      ] as const) {
        expect(
          result.data.agentControllers["claude-code"]?.models.find(
            (model) => model.id === id
          )
        ).toEqual({
          id,
          displayName,
          ...(badgeLabel ? { badgeLabel } : {}),
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high", "xhigh", "max"],
          minCliVersion,
        });
      }

      expect(result.data.agentControllers.opencode?.defaultModelId).toBe(
        "opencode/mimo-v2.6-flash-free"
      );
      expect(
        result.data.agentControllers.opencode?.models.find(
          (model) => model.id === "opencode/mimo-v2.5-free"
        )?.unavailable
      ).toBe(true);
      const opencodeModelIds =
        result.data.agentControllers.opencode?.models.map(
          (model) => model.id
        ) ?? [];
      for (const retiredId of [
        "opencode/north-mini-code-free",
        "opencode/deepseek-v4-flash-free",
        "opencode/x-preview-f-free",
      ]) {
        expect(opencodeModelIds).not.toContain(retiredId);
      }
      expect(
        result.data.agentControllers.opencode?.models.find(
          (model) => model.id === "opencode-go/glm-5.3-flash"
        )
      ).toEqual({
        id: "opencode-go/glm-5.3-flash",
        displayName: "GLM 5.3 Flash",
        unavailable: false,
        supportedReasoningLevels: ["low", "high", "max"],
        minCliVersion: null,
      });
      const openCodeDisplayNames: Record<string, string> = {
        "opencode-go/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
        "opencode-go/hy4-preview": "Hy4 Preview",
        "opencode/ling-3.0-flash-fin-free": "OpenCode Ling 3.0 Flash Fin Free",
      };
      for (const observedModel of openCodeModelCatalogCapture.models) {
        const id = `${observedModel.providerID}/${observedModel.id}`;
        expect(
          result.data.agentControllers.opencode?.models.find(
            (model) => model.id === id
          )
        ).toEqual({
          id,
          displayName: openCodeDisplayNames[id],
          badgeLabel: "New",
          unavailable: observedModel.status !== "active",
          supportedReasoningLevels: Object.keys(observedModel.variants),
          minCliVersion: null,
        });
      }
      for (const preservedRoute of [
        "openai/gpt-6-astra",
        "openai/gpt-6-astra-fast",
        "opencode/muse-spark-1.3-contributor-free",
        "opencode-go/muse-spark-1.3-contributor",
      ]) {
        expect(opencodeModelIds).toContain(preservedRoute);
      }
      expect(
        result.data.agentControllers.opencode?.models.find(
          (model) =>
            model.id ===
            `${openCodeGoQwen38Flash.providerID}/${openCodeGoQwen38Flash.id}`
        )
      ).toEqual({
        id: `${openCodeGoQwen38Flash.providerID}/${openCodeGoQwen38Flash.id}`,
        displayName: openCodeGoQwen38Flash.name,
        unavailable: openCodeGoQwen38Flash.status !== "active",
        supportedReasoningLevels: Object.keys(openCodeGoQwen38Flash.variants),
        minCliVersion: null,
      });
      // Variant keys stay the exact OpenCode `--variant` strings, including
      // vendor-specific ones like MiniMax's "thinking".
      expect(
        result.data.agentControllers.opencode?.models.find(
          (model) => model.id === "opencode-go/minimax-m3"
        )?.supportedReasoningLevels
      ).toEqual(["none", "thinking"]);
      expect(
        result.data.agentControllers.opencode?.models.find(
          (model) => model.id === "opencode/hy3-free"
        )?.supportedReasoningLevels
      ).toEqual(["low", "medium", "high"]);

      expect(result.data.agentControllers.cursor?.defaultModelId).toBe(
        "default[]"
      );
      const cursorConfigOptions =
        cursorModelCatalogCapture.sources.configOption.options;
      const cursorLegacyModels =
        cursorModelCatalogCapture.sources.legacyModels.availableModels;
      expect(cursorConfigOptions.map((option) => option.value)).toEqual(
        cursorLegacyModels.map((model) => model.modelId)
      );
      const cursorDisplayNamesByUpstreamName: Record<string, string> = {
        "claude-opus-5": "Claude Opus 5",
        "grok-4.6": "Grok 4.6 — High Fast",
        "muse-spark-1.3": "Muse Spark 1.3",
      };
      for (const observedOption of cursorConfigOptions) {
        const id = observedOption.value;
        expect(
          cursorLegacyModels.find((model) => model.modelId === id)
        ).toEqual({
          modelId: id,
          name: observedOption.name,
        });
        expect(
          result.data.agentControllers.cursor?.models.find(
            (model) => model.id === id
          )
        ).toEqual({
          id,
          displayName: cursorDisplayNamesByUpstreamName[observedOption.name],
          badgeLabel: "New",
          unavailable: false,
          supportedReasoningLevels: [],
          minCliVersion: null,
        });
      }
      for (const preservedCursorId of [
        "claude-fable-5-1[thinking=true,context=300k,effort=high]",
        "gemini-3.8-flash[reasoning_effort=high]",
      ]) {
        expect(
          result.data.agentControllers.cursor?.models.some(
            (model) => model.id === preservedCursorId
          )
        ).toBe(true);
      }
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
        defaultModelId: "z-ai/glm-5.3-flash",
        hostedRuntimePolicy: {
          automaticModelFallback: false,
          imageUnderstandingModelId: "x-ai/grok-4.6",
        },
        models: expect.arrayContaining([
          expect.objectContaining({
            id: "z-ai/glm-5.3-flash",
            displayName: "GLM 5.3 Flash",
            badgeLabel: "New",
            hostedRuntime: {
              contextWindow: 1_048_576,
              inputModalities: ["text", "image"],
              maxOutputTokens: 16_384,
              provider: "openrouter",
              reasoningLevel: "high",
            },
          }),
          expect.objectContaining({
            id: "x-ai/grok-4.6",
            displayName: "Grok 4.6",
            hostedRuntime: {
              contextWindow: 500_000,
              inputModalities: ["text", "image"],
              maxOutputTokens: 16_384,
              provider: "openrouter",
              reasoningLevel: "high",
            },
          }),
          expect.objectContaining({
            id: "x-ai/grok-4.5",
            displayName: "Grok 4.5",
            hostedRuntime: {
              contextWindow: 500_000,
              inputModalities: ["text", "image"],
              maxOutputTokens: 16_384,
              provider: "openrouter",
              reasoningLevel: "high",
            },
          }),
          expect.objectContaining({
            id: "deepseek/deepseek-v4-flash",
            displayName: "DeepSeek V4 Flash",
            hostedRuntime: {
              contextWindow: 1_000_000,
              inputModalities: ["text"],
              maxOutputTokens: 16_384,
              provider: "openrouter",
              reasoningLevel: "high",
            },
          }),
        ]),
      });

      for (const controller of Object.values(result.data.agentControllers)) {
        const modelIds = controller.models.map((model) => model.id);
        expect(new Set(modelIds).size).toBe(modelIds.length);
      }
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

  it("rejects badge labels that are too long for compact selectors", () => {
    const result = modelCatalogSchema.safeParse({
      schemaVersion: 1,
      updatedAt: "2026-08-13T00:00:00.000Z",
      agentControllers: {
        codex: {
          defaultModelId: "gpt-5.5",
          models: [createModel({ id: "gpt-5.5", badgeLabel: "x".repeat(33) })],
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
  badgeLabel?: string;
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
    ...(input.badgeLabel ? { badgeLabel: input.badgeLabel } : {}),
    ...(input.hostedRuntime ? { hostedRuntime: input.hostedRuntime } : {}),
    unavailable: input.unavailable ?? false,
    supportedReasoningLevels: input.supportedReasoningLevels ?? ["high"],
    minCliVersion: null,
  };
}
