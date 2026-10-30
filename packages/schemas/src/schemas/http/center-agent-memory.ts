import * as z from "zod/v4";
import { spaceEvidenceReferenceSchema } from "../../space-evidence";

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
export const CENTER_AGENT_ORGANIZATION_MEMORY_FACT_MAX_CHARS = 1200;

export const centerAgentMemoryProviderSchema = z.enum(["zep_cloud"]);

export const centerAgentMemoryWipeStatusSchema = z.enum([
  "deleted",
  "not_found",
]);

export const centerAgentWipeMemberMemoryResponseSchema = z.strictObject({
  organizationId: boundedIdentifierSchema,
  provider: centerAgentMemoryProviderSchema,
  status: centerAgentMemoryWipeStatusSchema,
  userId: boundedIdentifierSchema,
});

export const centerAgentOrganizationMemoryPolicyResponseSchema = z.strictObject(
  {
    organizationId: boundedIdentifierSchema,
    organizationMemoryOptIn: z.boolean(),
    provider: centerAgentMemoryProviderSchema,
    updatedByUserId: boundedIdentifierSchema.nullable(),
    availability: z
      .enum(["available", "unavailable", "not_checked", "disabled"])
      .optional(),
  }
);

export const updateCenterAgentOrganizationMemoryPolicyBodySchema =
  z.strictObject({
    organizationMemoryOptIn: z.boolean(),
  });

export const centerAgentRememberForOrganizationBodySchema = z.strictObject({
  fact: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ORGANIZATION_MEMORY_FACT_MAX_CHARS),
  sourceRef: spaceEvidenceReferenceSchema.options[0].optional(),
});

export const centerAgentRememberForOrganizationResponseSchema = z.strictObject({
  fact: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_ORGANIZATION_MEMORY_FACT_MAX_CHARS),
  organizationId: boundedIdentifierSchema,
  saved: z.literal(true),
  status: z.enum(["processing", "processed"]).optional(),
  source: z.literal("explicit_tool"),
});
