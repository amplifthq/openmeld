import * as z from "zod/v4";

export const RUNTIME_REPORTING_HEALTH_SCHEMA_VERSION = 1 as const;
export const RUNTIME_REPORTING_HEALTH_SCHEMA_NAME =
  "openmeld-runtime-reporting-health-v1" as const;
export const RUNTIME_REPORTING_FAILURE_REASON_CODE_MAX_LENGTH = 160;
export const RUNTIME_REPORTING_FAILURE_MESSAGE_MAX_LENGTH = 500;
export const RUNTIME_REPORTING_CHANNELS = [
  "runtimeAgentController",
  "providerConversationProof",
] as const;

export const runtimeReportingChannelSchema = z.enum(RUNTIME_REPORTING_CHANNELS);

export const runtimeReportingHealthFailureSchema = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  reasonCode: z
    .string()
    .min(1)
    .max(RUNTIME_REPORTING_FAILURE_REASON_CODE_MAX_LENGTH),
  message: z.string().min(1).max(RUNTIME_REPORTING_FAILURE_MESSAGE_MAX_LENGTH),
});

export const runtimeReportingApplicabilitySchema = z.strictObject({
  status: z.enum(["applicable", "not_applicable"]),
  observedAt: z.iso.datetime({ offset: true }),
});

export const runtimeReportingServiceIdentitySchema = z.strictObject({
  deviceId: z.string().trim().min(1),
  contractGeneration: z.int().nonnegative(),
});

export const runtimeReportingChannelHealthSchema = z.strictObject({
  applicability: runtimeReportingApplicabilitySchema.optional(),
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  consecutiveFailures: z.int().nonnegative(),
  lastFailure: runtimeReportingHealthFailureSchema.nullable(),
});

export const runtimeReportingHealthStateSchema = z.strictObject({
  schema: z.literal(RUNTIME_REPORTING_HEALTH_SCHEMA_NAME),
  v: z.literal(RUNTIME_REPORTING_HEALTH_SCHEMA_VERSION),
  serviceIdentity: runtimeReportingServiceIdentitySchema.optional(),
  serviceIdentityObservedAt: z.iso.datetime({ offset: true }).optional(),
  runtimeAgentController: runtimeReportingChannelHealthSchema,
  providerConversationProof: runtimeReportingChannelHealthSchema,
});
