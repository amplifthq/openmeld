import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "./daemon/profile-identity";

export const AI_FREE_MONTHLY_CREDITS = 5000;
export const AI_CREDITS_PER_USD = 1000;
export const AI_CREDIT_POLICY_VERSION = "2026-10-v1";

export const aiFundingSourceSchema = z.enum(["free", "byok"]);
// Retain retired attribution only for historical usage, never authorization.
export const aiUsageFundingSourceSchema = aiFundingSourceSchema.or(
  z.literal("internal")
);
export const organizationAiBillingSchema = z.strictObject({
  plan: z.literal("free"),
  source: aiFundingSourceSchema,
  policyVersion: z.literal(AI_CREDIT_POLICY_VERSION),
  monthlyCredits: z.number().int().nonnegative().nullable(),
  usedCredits: z.number().nonnegative().nullable(),
  remainingCredits: z.number().nonnegative().nullable(),
  resetsAt: z.iso.datetime().nullable(),
  keySuffix: z.string().max(4).nullable(),
  canManage: z.boolean(),
  status: z.enum(["available", "exhausted", "unavailable"]),
});
export const updateOrganizationAiBillingSchema = z.discriminatedUnion(
  "source",
  [
    z.strictObject({ source: z.literal("free") }),
    z.strictObject({
      source: z.literal("byok"),
      apiKey: z
        .string()
        .trim()
        .min(16)
        .max(512)
        .regex(/^sk-or-[A-Za-z0-9_-]+$/),
    }),
  ]
);
export const organizationAiBillingRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const updateOrganizationAiBillingRpcInputSchema =
  organizationAiBillingRpcInputSchema.extend({
    settings: updateOrganizationAiBillingSchema,
  });

// Private service-binding response. Never expose this on an HTTP route, in
// usage records, model context, or diagnostics.
export const remoteAiProviderAuthorizationSchema = z.strictObject({
  source: aiFundingSourceSchema,
  apiKey: z.string().min(16).max(512),
});
