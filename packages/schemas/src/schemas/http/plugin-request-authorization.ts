import type { z as Zod } from "zod/v4";
import * as z from "../../lazy-zod";

export const pluginRequestVerificationSchema = z.strictObject({
  requestId: z.string().uuid(),
  organizationId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAtMs: z.number().int().positive(),
});
export const pluginRequestVerificationCheckSchema =
  pluginRequestVerificationSchema.extend({
    code: z.string().trim().min(1).max(128),
  });
export const pluginRequestVerificationResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("sent") }),
    z.strictObject({ status: z.literal("verified") }),
    z.strictObject({
      status: z.literal("denied"),
      reason: z.enum([
        "invalid_request",
        "expired",
        "recipient_unavailable",
        "verification_invalid",
        "delivery_unavailable",
      ]),
    }),
  ]
);
export type PluginRequestVerification = Zod.infer<
  typeof pluginRequestVerificationSchema
>;
export type PluginRequestVerificationCheck = Zod.infer<
  typeof pluginRequestVerificationCheckSchema
>;
export type PluginRequestVerificationResult = Zod.infer<
  typeof pluginRequestVerificationResultSchema
>;
