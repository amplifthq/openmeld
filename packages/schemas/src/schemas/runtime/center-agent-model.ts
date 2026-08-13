import { z } from "zod/v4";
import {
  hostedModelReasoningLevelSchema,
  modelCatalogBadgeLabelSchema,
} from "../config/model-catalog";

const boundedIdentifierSchema = z.string().trim().min(1).max(256);

export const centerAgentModelPreferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("system_default"),
  }),
  z.strictObject({
    kind: z.literal("selected_model"),
    modelId: boundedIdentifierSchema,
  }),
]);

export const centerAgentModelSummarySchema = z.strictObject({
  availability: z.enum(["available", "unavailable", "unknown"]),
  displayName: boundedIdentifierSchema,
  modelId: boundedIdentifierSchema,
  supportsImageInput: z.boolean(),
});

export const centerAgentModelChoiceSchema = z.strictObject({
  badgeLabel: modelCatalogBadgeLabelSchema.nullable().optional(),
  displayName: boundedIdentifierSchema,
  effectiveModelDisplayName: boundedIdentifierSchema,
  preference: centerAgentModelPreferenceSchema,
  supportsImageInput: z.boolean(),
});

const centerAgentHostedModelRouteSchema = z.strictObject({
  contextWindow: z.number().int().positive(),
  displayName: boundedIdentifierSchema,
  inputModalities: z.array(z.enum(["text", "image"])).min(1),
  maxOutputTokens: z.number().int().positive(),
  modelId: boundedIdentifierSchema,
  provider: z.literal("openrouter"),
  reasoningLevel: hostedModelReasoningLevelSchema,
});

export const centerAgentModelRouteSchema = z.strictObject({
  automaticModelFallback: z.literal(false),
  catalogUpdatedAt: z.iso.datetime({ offset: true }),
  contextWindow: z.number().int().positive(),
  displayName: boundedIdentifierSchema,
  imageUnderstandingModel: centerAgentHostedModelRouteSchema,
  inputModalities: z.array(z.enum(["text", "image"])).min(1),
  maxOutputTokens: z.number().int().positive(),
  modelId: boundedIdentifierSchema,
  preference: centerAgentModelPreferenceSchema,
  provider: z.literal("openrouter"),
  reasoningLevel: hostedModelReasoningLevelSchema,
});
