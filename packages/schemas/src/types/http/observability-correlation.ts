import type { z } from "zod/v4";

type ObservabilityCloudflareRuntimeEvidenceSchema =
  typeof import("../../schemas/http/observability-correlation")["observabilityCloudflareRuntimeEvidenceSchema"];
type ObservabilityWakeCorrelationSchema =
  typeof import("../../schemas/http/observability-correlation")["observabilityWakeCorrelationSchema"];
type ObservabilityWakeTraceSelectorSchema =
  typeof import("../../schemas/http/observability-correlation")["observabilityWakeTraceSelectorSchema"];

export type ObservabilityCloudflareRuntimeEvidence =
  z.infer<ObservabilityCloudflareRuntimeEvidenceSchema>;
export type ObservabilityWakeCorrelation =
  z.infer<ObservabilityWakeCorrelationSchema>;
export type ObservabilityWakeTraceSelector =
  z.infer<ObservabilityWakeTraceSelectorSchema>;
