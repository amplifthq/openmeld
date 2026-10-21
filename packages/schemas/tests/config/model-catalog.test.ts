import { describe, expect, it } from "vitest";
import vendorModelCatalog from "../../../../release/vendor-models.json";
import {
  MODEL_CATALOG_SCHEMA_VERSION,
  modelCatalogSchema,
} from "../../src/index";
import { modelRetirementNoticeSchema } from "../../src/schemas/config/model-catalog";
import codexGpt6Capture from "../fixtures/codex-gpt-6-sol-luna-2026.09.23.json";
import gpt55Withdrawal from "../fixtures/codex-gpt55-withdrawal-2026.10.18.json";
import sparkWithdrawal from "../fixtures/codex-spark-withdrawal-2026.10.09.json";
import cursorModelCatalogCapture from "../fixtures/cursor-model-catalog-2026.09.10.json";
import cursorOctoberReviewCapture from "../fixtures/cursor-model-catalog-2026.10.07.json";
import gemini4Capture from "../fixtures/gemini-4-native-models-2026.10.14.json";
import haikuCapture from "../fixtures/haiku-5.5-local-model-catalog-2026.10.08.json";
import localModelCatalogCapture from "../fixtures/local-model-catalog-2026.09.22.json";
import octoberModelCatalogCapture from "../fixtures/local-model-catalog-2026.10.01.json";
import openCodeGoQwen38Flash from "../fixtures/opencode-go-qwen3.8-flash-1.18.25.json";
import openCodeModelCatalogCapture from "../fixtures/opencode-model-catalog-1.18.31.json";
import openCodeOctoberCapture from "../fixtures/opencode-model-catalog-1.18.34.json";
import openCodeReviewCapture from "../fixtures/opencode-model-catalog-2026.10.06.json";
import openCodeLatestReviewCapture from "../fixtures/opencode-model-catalog-2026.10.07.json";
import openCodeAlignmentCapture from "../fixtures/opencode-model-catalog-2026.10.09.json";
import openCodeOctober14Capture from "../fixtures/opencode-model-catalog-2026.10.14.json";
import openCodeOctober18Capture from "../fixtures/opencode-model-catalog-2026.10.18.json";
import openCodeOctober21Capture from "../fixtures/opencode-model-catalog-2026.10.21.json";
import museWonderCapture from "../fixtures/opencode-muse-wonder-2026.10.13.json";

describe("model catalog schema", () => {
  it("preserves Gemini 4 native IDs and channel reasoning contracts", () => {
    const { agentControllers } = modelCatalogSchema.parse(vendorModelCatalog);
    for (const controller of ["antigravity", "cursor"] as const) {
      for (const model of gemini4Capture[controller].availableModels) {
        expect(gemini4Capture[controller].configOptions).toContainEqual({
          value: model.modelId,
          name: model.name,
          ...(controller === "antigravity"
            ? { description: model.modelId }
            : {}),
        });
        expect(agentControllers[controller]?.models).toContainEqual(
          expect.objectContaining({
            id: model.modelId,
            supportedReasoningLevels: [],
            unavailable: false,
          })
        );
      }
    }
    for (const model of gemini4Capture.opencode.models) {
      expect(agentControllers.opencode?.models).toContainEqual(
        expect.objectContaining({
          id: `${model.providerID}/${model.id}`,
          supportedReasoningLevels: Object.keys(model.variants),
          unavailable: false,
        })
      );
    }
  });
  it.each([
    "gpt-5.4",
    "gpt-5.4-mini",
  ])("keeps %s withdrawal scoped without disabling API-key access", (modelId) => {
    const catalog = modelCatalogSchema.parse(vendorModelCatalog);
    const model = catalog.agentControllers.codex?.models.find(
      (entry) => entry.id === modelId
    );
    expect(model?.unavailable).toBe(false);
    expect(model?.retirement).toEqual({
      status: "withdrawn",
      date: { value: "2026-08-31", kind: "on" },
      scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
      sourceUrl:
        "https://learn.chatgpt.com/docs/models#deprecated-codex-models",
      verifiedAt: "2026-09-23T14:09:57Z",
    });
  });

  it("keeps lower-bound dates distinct and rejects unsafe or malformed notices", () => {
    const notice = {
      status: "announced",
      date: { value: "2026-10-15", kind: "not_before" },
      scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
      sourceUrl: "https://example.com/official-notice",
      verifiedAt: "2026-09-23T00:00:00Z",
    };
    expect(modelRetirementNoticeSchema.parse(notice).date?.kind).toBe(
      "not_before"
    );
    expect(
      modelRetirementNoticeSchema.safeParse({
        ...notice,
        sourceUrl: "javascript:alert(1)",
      }).success
    ).toBe(false);
    expect(
      modelRetirementNoticeSchema.safeParse({
        ...notice,
        date: { value: "2026-02-30", kind: "on" },
      }).success
    ).toBe(false);
  });

  it.each([
    sparkWithdrawal,
    gpt55Withdrawal,
  ])("scopes $modelId withdrawal to the rejected native login method", (withdrawal) => {
    const model = modelCatalogSchema
      .parse(vendorModelCatalog)
      .agentControllers.codex?.models.find(
        (entry) => entry.id === withdrawal.modelId
      );
    expect(model?.unavailable).toBe(false);
    expect(model?.retirement).toEqual({
      status: "withdrawn",
      date: { value: withdrawal.retirementDate, kind: "on" },
      scope: {
        controllerRef: "builtin:codex",
        authType: withdrawal.capture.authType,
      },
      sourceUrl: withdrawal.sourceUrl,
      verifiedAt: withdrawal.capture.observedAt,
    });
  });

  it("preserves reviewed local model IDs and reasoning options", () => {
    const { agentControllers } = modelCatalogSchema.parse(vendorModelCatalog);
    for (const model of codexGpt6Capture.data) {
      expect(agentControllers.codex?.models).toContainEqual(
        expect.objectContaining({
          id: model.model,
          unavailable: false,
          supportedReasoningLevels: model.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort
          ),
          minCliVersion: codexGpt6Capture.version,
        })
      );
    }
    const { cursor, grokBuild, opencode } = localModelCatalogCapture;
    expect(agentControllers["claude-code"]?.models).toContainEqual(
      expect.objectContaining({
        id: haikuCapture.claudeCode.modelId,
        unavailable: false,
        minCliVersion: haikuCapture.claudeCode.minCliVersion,
        supportedReasoningLevels:
          haikuCapture.claudeCode.supportedReasoningLevels,
      })
    );
    for (const model of [
      ...cursor.availableModels,
      ...octoberModelCatalogCapture.cursor.availableModels,
      ...haikuCapture.cursor.availableModels,
    ]) {
      expect([
        ...cursor.configOptions,
        ...octoberModelCatalogCapture.cursor.configOptions,
        ...haikuCapture.cursor.configOptions,
      ]).toContainEqual({
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
    for (const model of [
      ...opencode,
      ...octoberModelCatalogCapture.opencode,
      ...openCodeOctoberCapture.models,
      ...openCodeReviewCapture.models,
      ...haikuCapture.opencode.models,
      ...openCodeAlignmentCapture.models,
      ...museWonderCapture.models,
      ...openCodeOctober14Capture.models,
      ...openCodeOctober18Capture.models,
      ...openCodeOctober21Capture.models,
    ]) {
      expect(agentControllers.opencode?.models).toContainEqual(
        expect.objectContaining({
          id: `${model.providerID}/${model.id}`,
          unavailable:
            model.status !== "active" ||
            openCodeReviewCapture.rejectedModels.some(
              (rejected) =>
                rejected.providerID === model.providerID &&
                rejected.id === model.id
            ),
          supportedReasoningLevels: Object.keys(model.variants),
        })
      );
    }
    for (const model of openCodeReviewCapture.models) {
      expect(
        agentControllers.opencode?.models.find(
          (entry) => entry.id === `${model.providerID}/${model.id}`
        )?.minCliVersion
      ).toBe(openCodeReviewCapture.capture.harnessVersion);
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
  it("preserves reviewed native model choices and freshness labels", () => {
    const { agentControllers } = modelCatalogSchema.parse(vendorModelCatalog);
    for (const model of openCodeLatestReviewCapture.models) {
      expect(agentControllers.opencode?.models).toContainEqual(
        expect.objectContaining({
          id: `${model.providerID}/${model.id}`,
          unavailable: false,
          supportedReasoningLevels: Object.keys(model.variants),
        })
      );
    }
    for (const model of cursorOctoberReviewCapture.availableModels) {
      expect(cursorOctoberReviewCapture.configOptions).toContainEqual({
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
    expect(
      Object.values(agentControllers)
        .flatMap((controller) =>
          controller.models
            .filter((model) => model.badgeLabel)
            .map((model) => model.id)
        )
        .toSorted()
    ).toEqual(
      [
        "anthropic/claude-haiku-5.5",
        ...openCodeOctober14Capture.models.map(
          (model) => `${model.providerID}/${model.id}`
        ),
        ...openCodeOctober18Capture.models.map(
          (model) => `${model.providerID}/${model.id}`
        ),
        ...openCodeOctober21Capture.models.map(
          (model) => `${model.providerID}/${model.id}`
        ),
        "gemini-4-argon-medium",
        "gemini-4-argon[reasoning_effort=medium]",
        "google/gemini-4-argon",
        "openrouter/google/gemini-4-argon",
        "meta/muse-wonder",
        "openrouter/meta/muse-wonder",
        haikuCapture.claudeCode.modelId,
        ...haikuCapture.cursor.availableModels.map((model) => model.modelId),
        ...haikuCapture.opencode.models.map(
          (model) => `${model.providerID}/${model.id}`
        ),
        "opencode/mistral-large-4",
      ].toSorted()
    );
  });
  it("accepts the release vendor model catalog", () => {
    const result = modelCatalogSchema.safeParse(vendorModelCatalog);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(MODEL_CATALOG_SCHEMA_VERSION);
      expect(result.data.agentControllers.codex?.defaultModelId).toBe(
        "gpt-6.1-sol"
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
          ...(id === "gpt-5.5"
            ? {
                retirement: {
                  status: "withdrawn",
                  date: { value: "2026-10-14", kind: "on" },
                  scope: {
                    controllerRef: "builtin:codex",
                    authType: "chatgpt",
                  },
                  sourceUrl:
                    "https://learn.chatgpt.com/docs/models#gpt-55-retirement",
                  verifiedAt: gpt55Withdrawal.capture.observedAt,
                },
              }
            : {}),
        });
      }

      for (const [id, displayName, minCliVersion, badgeLabel] of [
        ["claude-sonnet-5-5", "Claude Sonnet 5.5", "2.1.284", null],
        ["claude-opus-5-5", "Claude Opus 5.5", "2.1.280", null],
        ["claude-fable-5-1", "Claude Fable 5.1", "2.1.257", null],
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
      for (const [id, displayName, variants, badgeLabel] of [
        [
          "opencode/longcat-2.5-preview-free",
          "OpenCode LongCat 2.5 Preview Free",
          ["low", "medium", "high"],
          null,
        ],
        [
          "opencode/space-bunny-free",
          "OpenCode Space Bunny Free",
          ["low", "medium", "high", "xhigh", "max"],
          null,
        ],
      ] as const) {
        expect(
          result.data.agentControllers.opencode?.models.find(
            (model) => model.id === id
          )
        ).toEqual({
          id,
          displayName,
          ...(badgeLabel ? { badgeLabel } : {}),
          unavailable: false,
          supportedReasoningLevels: [...variants],
          minCliVersion: "1.18.33",
        });
      }

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

      expect(
        result.data.agentControllers["center-agent"]?.models.find(
          (model) => model.id === "z-ai/glm-5.3-flash"
        )?.badgeLabel
      ).toBeUndefined();
      expect(result.data.agentControllers["center-agent"]).toMatchObject({
        defaultModelId: "anthropic/claude-opus-5.5",
        hostedRuntimePolicy: {
          automaticModelFallback: false,
          imageUnderstandingModelId: "openai/gpt-6-luna",
          personalRemoteAgentDefaultModelId: "openai/gpt-6-sol",
        },
        models: expect.arrayContaining([
          expect.objectContaining({
            id: "z-ai/glm-5.3-flash",
            displayName: "GLM 5.3 Flash",
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
              reasoningLevel: "medium",
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
              reasoningLevel: "medium",
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

  it("rejects a personal Remote Agent default outside the available hosted choices", () => {
    const catalog = structuredClone(vendorModelCatalog);
    catalog.agentControllers[
      "center-agent"
    ].hostedRuntimePolicy.personalRemoteAgentDefaultModelId = "missing-model";
    const result = modelCatalogSchema.safeParse(catalog);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: [
              "agentControllers",
              "center-agent",
              "hostedRuntimePolicy",
              "personalRemoteAgentDefaultModelId",
            ],
          }),
        ])
      );
    }
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
