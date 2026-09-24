import * as z from "zod/v4";

export const MODEL_CATALOG_SCHEMA_VERSION = 1 as const;

/** Older callers receive the unchanged strict version-1 projection. */
export const modelCatalogReadOptionsSchema = z.strictObject({
  retirement: z.boolean().optional(),
  personalRemoteAgentDefault: z.boolean().optional(),
});
export type ModelCatalogReadOptions = z.infer<
  typeof modelCatalogReadOptionsSchema
>;

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
  "max",
]);

export const modelCatalogHostedRuntimeSchema = z.strictObject({
  provider: z.literal("openrouter"),
  inputModalities: z.array(hostedModelInputModalitySchema).min(1),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  reasoningLevel: hostedModelReasoningLevelSchema,
});

/** Reviewed facts only. A date never changes model availability. */
export const modelRetirementNoticeSchema = z.strictObject({
  status: z.enum(["announced", "withdrawn"]),
  date: z
    .strictObject({ value: z.iso.date(), kind: z.enum(["on", "not_before"]) })
    .nullable(),
  scope: z.strictObject({
    controllerRef: boundedIdentifierSchema,
    providerId: boundedIdentifierSchema.optional(),
    authType: boundedIdentifierSchema.optional(),
  }),
  sourceUrl: z.url().refine((url) => url.startsWith("https://"), {
    message: "retirement sources must use HTTPS",
  }),
  verifiedAt: z.iso.datetime({ offset: true }),
});

export const modelCatalogModelSchema = z.strictObject({
  id: boundedIdentifierSchema,
  displayName: boundedDisplayNameSchema,
  badgeLabel: modelCatalogBadgeLabelSchema.optional(),
  retirement: modelRetirementNoticeSchema.optional(),
  hostedRuntime: modelCatalogHostedRuntimeSchema.optional(),
  unavailable: z.boolean(),
  supportedReasoningLevels: z.array(boundedIdentifierSchema),
  minCliVersion: nullableBoundedIdentifierSchema,
});

export const modelCatalogHostedRuntimePolicySchema = z.strictObject({
  automaticModelFallback: z.literal(false),
  imageUnderstandingModelId: boundedIdentifierSchema,
  personalRemoteAgentDefaultModelId: boundedIdentifierSchema.optional(),
});

export const modelCatalogAgentControllerSchema = z
  .strictObject({
    defaultModelId: boundedIdentifierSchema,
    creationDefaults: z
      .strictObject({
        modelId: boundedIdentifierSchema,
        reasoningLevel: nullableBoundedIdentifierSchema,
      })
      .optional(),
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

      for (const issue of hostedReasoningIssues(model, index)) {
        context.addIssue({ code: "custom", ...issue });
      }

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
  })
  .superRefine((value, context) => {
    if (value.creationDefaults) {
      const selected = value.models.find(
        (model) => model.id === value.creationDefaults?.modelId
      );
      if (!selected || selected.unavailable) {
        context.addIssue({
          code: "custom",
          message: "creationDefaults must select an available model",
          path: ["creationDefaults", "modelId"],
        });
      } else if (
        value.creationDefaults.reasoningLevel !== null &&
        !selected.supportedReasoningLevels.includes(
          value.creationDefaults.reasoningLevel
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "creationDefaults reasoning must be supported by its model",
          path: ["creationDefaults", "reasoningLevel"],
        });
      }
      if (value.hostedRuntimePolicy) {
        context.addIssue({
          code: "custom",
          message:
            "hosted controllers do not have local profile creation defaults",
          path: ["creationDefaults"],
        });
      }
    }

    if (!value.hostedRuntimePolicy) {
      return;
    }

    if (value.hostedRuntimePolicy.personalRemoteAgentDefaultModelId) {
      const remoteDefaultModel = value.models.find(
        (model) =>
          model.id ===
          value.hostedRuntimePolicy?.personalRemoteAgentDefaultModelId
      );
      if (
        !remoteDefaultModel?.hostedRuntime ||
        remoteDefaultModel.unavailable
      ) {
        context.addIssue({
          code: "custom",
          message:
            "personalRemoteAgentDefaultModelId must reference an available hosted model",
          path: ["hostedRuntimePolicy", "personalRemoteAgentDefaultModelId"],
        });
      }
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

function hostedReasoningIssues(
  model: z.infer<typeof modelCatalogModelSchema>,
  index: number
): Array<{ message: string; path: (string | number)[] }> {
  if (!model.hostedRuntime) {
    return [];
  }
  const issues: Array<{ message: string; path: (string | number)[] }> = [];
  for (const [levelIndex, level] of model.supportedReasoningLevels.entries()) {
    if (!hostedModelReasoningLevelSchema.safeParse(level).success) {
      issues.push({
        message: "hosted reasoning levels must be valid efforts",
        path: ["models", index, "supportedReasoningLevels", levelIndex],
      });
    }
  }
  if (
    !model.supportedReasoningLevels.includes(model.hostedRuntime.reasoningLevel)
  ) {
    issues.push({
      message: "hosted default reasoning must be supported by its model",
      path: ["models", index, "hostedRuntime", "reasoningLevel"],
    });
  }
  return issues;
}

export const modelCatalogSchema = z.strictObject({
  schemaVersion: z.literal(MODEL_CATALOG_SCHEMA_VERSION),
  updatedAt: z.iso.datetime({ offset: true }),
  agentControllers: z.record(
    boundedIdentifierSchema,
    modelCatalogAgentControllerSchema
  ),
});

export const getModelCatalogResponseSchema = modelCatalogSchema;

/** Git-backed collector handoff; never execution or account-availability authority. */
export const modelCatalogUpdateEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  controller: boundedIdentifierSchema,
  observedAt: z.iso.datetime({ offset: true }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sources: z
    .array(
      z.strictObject({
        url: z.url(),
        kind: z.enum([
          "official-release",
          "official-harness-catalog",
          "official-document",
          "discovery-only",
        ]),
        data: z.json(),
      })
    )
    .min(1),
  changes: z.array(
    z.strictObject({
      modelId: boundedIdentifierSchema,
      before: modelCatalogModelSchema.nullable(),
      after: modelCatalogModelSchema,
    })
  ),
  manual: z.array(z.string()),
});
