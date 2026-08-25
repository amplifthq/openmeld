import * as z from "zod/v4";

export const daemonBootstrapAutoInstallModeSchema = z.enum([
  "always",
  "ask",
  "never",
]);

export const daemonBootstrapRecommendationPayloadSchema = z.strictObject({
  recommended: z.boolean(),
  reason: z.literal("service_missing"),
  autoInstallMode: daemonBootstrapAutoInstallModeSchema,
  installCommand: z.string().min(1),
  configureAlwaysFlag: z.string().min(1),
  configureSkipFlag: z.string().min(1),
  note: z.string().min(1),
});

export const daemonBootstrapRecommendationResultSchema = z.strictObject({
  type: z.literal("result"),
  code: z.literal("daemon.bootstrap.recommended"),
  payload: daemonBootstrapRecommendationPayloadSchema,
});
