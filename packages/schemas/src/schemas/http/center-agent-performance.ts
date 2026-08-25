import { z } from "zod/v4";

export const CENTER_AGENT_PERFORMANCE_MODEL_VERSION =
  "openmeld.center_agent.performance.v1" as const;

export const CENTER_AGENT_PERFORMANCE_ANALYTICS_BLOBS = [
  "milestone",
  "triggerSource",
  "modelId",
  "status",
  "reasonCode",
  "organizationId",
  "spaceId",
  "submissionId",
  "dispatchId",
  "sourceClientMessageId",
  "agentProfileId",
  "bindingId",
  "workerEnvironment",
] as const;

export const CENTER_AGENT_PERFORMANCE_ANALYTICS_DOUBLES = [
  "count",
  "elapsedFromAdmissionMs",
  "stageDurationMs",
  "availableToolCount",
  "exposedToolCount",
  "deferredToolCount",
  "statusCode",
] as const;

export const centerAgentPerformanceMilestoneSchema = z.enum([
  "provider_request_prepared",
  "provider_response_headers",
  "first_model_event",
  "first_assistant_text",
  "first_visible_content",
  "model_completed",
]);

export const centerAgentPerformanceTriggerSourceSchema = z.enum([
  "member_research",
  "message_channel",
  "routine",
  "slack",
  "space_wake",
  "task_continuation",
  "task_watch_continuation",
  "web_dm",
]);

const identifierSchema = z.string().trim().min(1).max(512);
const nullableIdentifierSchema = identifierSchema.nullable();

export const centerAgentPerformanceEventSchema = z.strictObject({
  agentProfileId: identifierSchema,
  availableToolCount: z.number().int().nonnegative().nullable(),
  bindingId: identifierSchema,
  deferredToolCount: z.number().int().nonnegative().nullable(),
  dispatchId: identifierSchema,
  elapsedFromAdmissionMs: z.number().finite().nonnegative(),
  exposedToolCount: z.number().int().nonnegative().nullable(),
  milestone: centerAgentPerformanceMilestoneSchema,
  modelId: nullableIdentifierSchema,
  modelVersion: z.literal(CENTER_AGENT_PERFORMANCE_MODEL_VERSION),
  organizationId: identifierSchema,
  reasonCode: z.string().trim().min(1).max(160).nullable(),
  sourceClientMessageId: nullableIdentifierSchema,
  spaceId: identifierSchema,
  stageDurationMs: z.number().finite().nonnegative().nullable(),
  status: z.enum(["failed", "succeeded"]),
  statusCode: z.number().int().min(100).max(599).nullable(),
  submissionId: identifierSchema,
  triggerSource: centerAgentPerformanceTriggerSourceSchema,
  workerEnvironment: z.string().trim().min(1).max(160).nullable(),
});

export const centerAgentPerformanceAnalyticsDataPointSchema = z.strictObject({
  blobs: z
    .array(z.string())
    .length(CENTER_AGENT_PERFORMANCE_ANALYTICS_BLOBS.length),
  doubles: z
    .array(z.number().finite())
    .length(CENTER_AGENT_PERFORMANCE_ANALYTICS_DOUBLES.length),
  indexes: z.array(z.string().trim().min(1).max(96)).length(1),
});

export type CenterAgentPerformanceEvent = z.infer<
  typeof centerAgentPerformanceEventSchema
>;

export function projectCenterAgentPerformanceAnalyticsDataPoint(
  event: CenterAgentPerformanceEvent
): z.infer<typeof centerAgentPerformanceAnalyticsDataPointSchema> {
  const parsed = centerAgentPerformanceEventSchema.parse(event);
  return centerAgentPerformanceAnalyticsDataPointSchema.parse({
    blobs: [
      parsed.milestone,
      parsed.triggerSource,
      parsed.modelId ?? "",
      parsed.status,
      parsed.reasonCode ?? "",
      parsed.organizationId,
      parsed.spaceId,
      parsed.submissionId,
      parsed.dispatchId,
      parsed.sourceClientMessageId ?? "",
      parsed.agentProfileId,
      parsed.bindingId,
      parsed.workerEnvironment ?? "",
    ],
    doubles: [
      1,
      parsed.elapsedFromAdmissionMs,
      parsed.stageDurationMs ?? 0,
      parsed.availableToolCount ?? 0,
      parsed.exposedToolCount ?? 0,
      parsed.deferredToolCount ?? 0,
      parsed.statusCode ?? 0,
    ],
    // Aggregate queries are organization-scoped; exact-turn diagnosis remains
    // in the durable runtime evidence model, not this sampled dataset.
    indexes: [parsed.organizationId],
  });
}
