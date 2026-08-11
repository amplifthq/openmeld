import type { z } from "zod/v4";

type ObservabilityCloudflareAnalyticsDataPointSchema =
  typeof import("../../schemas/http/observability-runtime-event")["observabilityCloudflareAnalyticsDataPointSchema"];
type ObservabilityCloudflareRuntimeEventSchema =
  typeof import("../../schemas/http/observability-runtime-event")["observabilityCloudflareRuntimeEventSchema"];
type ObservabilityCloudflareRuntimeKindSchema =
  typeof import("../../schemas/http/observability-runtime-event")["observabilityCloudflareRuntimeKindSchema"];
type ObservabilityCloudflareWorkerNameSchema =
  typeof import("../../schemas/http/observability-runtime-event")["observabilityCloudflareWorkerNameSchema"];
type ObservabilityRuntimeEvidenceStatusSchema =
  typeof import("../../schemas/http/observability-runtime-event")["observabilityRuntimeEvidenceStatusSchema"];

export type ObservabilityCloudflareAnalyticsDataPoint =
  z.infer<ObservabilityCloudflareAnalyticsDataPointSchema>;
export type ObservabilityCloudflareRuntimeEvent =
  z.infer<ObservabilityCloudflareRuntimeEventSchema>;
export type ObservabilityCloudflareRuntimeKind =
  z.infer<ObservabilityCloudflareRuntimeKindSchema>;
export type ObservabilityCloudflareWorkerName =
  z.infer<ObservabilityCloudflareWorkerNameSchema>;
export type ObservabilityRuntimeEvidenceStatus =
  z.infer<ObservabilityRuntimeEvidenceStatusSchema>;
