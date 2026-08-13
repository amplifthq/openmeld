import { z } from "zod/v4";

export const MODEL_CATALOG_SCHEMA_VERSION = 1 as const;

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const boundedDisplayNameSchema = z.string().trim().min(1).max(256);
const nullableBoundedIdentifierSchema = boundedIdentifierSchema.nullable();

export const modelCatalogBadgeLabelSchema = z.string().trim().min(1).max(32);

export const hostedModelInputModalitySchema = z.enum(["text", "image"]);
export const hostedModelReasoningLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export const modelCatalogHostedRuntimeSchema = z.strictObject({
  provider: z.literal("openrouter"),
  inputModalities: z.array(hostedModelInputModalitySchema).min(1),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  reasoningLevel: hostedModelReasoningLevelSchema,
});

export const modelCatalogModelSchema = z.strictObject({
  id: boundedIdentifierSchema,
  displayName: boundedDisplayNameSchema,
  badgeLabel: modelCatalogBadgeLabelSchema.optional(),
  hostedRuntime: modelCatalogHostedRuntimeSchema.optional(),
  unavailable: z.boolean(),
  supportedReasoningLevels: z.array(boundedIdentifierSchema),
  minCliVersion: nullableBoundedIdentifierSchema,
});

export const modelCatalogHostedRuntimePolicySchema = z.strictObject({
  automaticModelFallback: z.literal(false),
  imageUnderstandingModelId: boundedIdentifierSchema,
});

export const modelCatalogAgentControllerSchema = z
  .strictObject({
    defaultModelId: boundedIdentifierSchema,
    hostedRuntimePolicy: modelCatalogHostedRuntimePolicySchema.optional(),
    models: z.array(modelCatalogModelSchema).min(1),
  })
  .superRefine((value, context) => {
    const modelIds = new Set<string>();
    for (const [index, model] of value.models.entries()) {
      if (modelIds.has(model.id)) {
        context.addIssue({
          code: "custom",
          message: "model ids must be unique per agent controller",
          path: ["models", index, "id"],
        });
      }
      modelIds.add(model.id);

      const reasoningLevels = new Set<string>();
      for (const [
        reasoningLevelIndex,
        reasoningLevel,
      ] of model.supportedReasoningLevels.entries()) {
        if (!reasoningLevels.has(reasoningLevel)) {
          reasoningLevels.add(reasoningLevel);
          continue;
        }
        context.addIssue({
          code: "custom",
          message: "reasoning levels must be unique per model",
          path: [
            "models",
            index,
            "supportedReasoningLevels",
            reasoningLevelIndex,
          ],
        });
      }
    }

    if (!modelIds.has(value.defaultModelId)) {
      context.addIssue({
        code: "custom",
        message: "defaultModelId must reference a listed model",
        path: ["defaultModelId"],
      });
    }

    const defaultModel = value.models.find(
      (model) => model.id === value.defaultModelId
    );
    if (defaultModel?.unavailable) {
      context.addIssue({
        code: "custom",
        message: "defaultModelId must reference an available model",
        path: ["defaultModelId"],
      });
    }

    if (!value.hostedRuntimePolicy) {
      return;
    }

    for (const [index, model] of value.models.entries()) {
      if (model.hostedRuntime) {
        continue;
      }
      context.addIssue({
        code: "custom",
        message: "hosted controller models must define hostedRuntime",
        path: ["models", index, "hostedRuntime"],
      });
    }

    const imageUnderstandingModel = value.models.find(
      (model) =>
        model.id === value.hostedRuntimePolicy?.imageUnderstandingModelId
    );
    if (!imageUnderstandingModel) {
      context.addIssue({
        code: "custom",
        message:
          "imageUnderstandingModelId must reference a listed hosted model",
        path: ["hostedRuntimePolicy", "imageUnderstandingModelId"],
      });
      return;
    }
    if (imageUnderstandingModel.unavailable) {
      context.addIssue({
        code: "custom",
        message:
          "imageUnderstandingModelId must reference an available hosted model",
        path: ["hostedRuntimePolicy", "imageUnderstandingModelId"],
      });
    }
    if (
      !imageUnderstandingModel.hostedRuntime?.inputModalities.includes("image")
    ) {
      context.addIssue({
        code: "custom",
        message: "imageUnderstandingModelId must support image input",
        path: ["hostedRuntimePolicy", "imageUnderstandingModelId"],
      });
    }
  });

export const modelCatalogSchema = z.strictObject({
  schemaVersion: z.literal(MODEL_CATALOG_SCHEMA_VERSION),
  updatedAt: z.iso.datetime({ offset: true }),
  agentControllers: z.record(
    boundedIdentifierSchema,
    modelCatalogAgentControllerSchema
  ),
});

export const getModelCatalogResponseSchema = modelCatalogSchema;
