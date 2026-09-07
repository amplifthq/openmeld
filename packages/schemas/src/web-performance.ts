import * as z from "zod/v4";

export const WEB_PERFORMANCE_PATH = "/v1/observability/performance";
export const webPerformancePolicySchema = z.strictObject({
  version: z.number().int().positive(),
  enabled: z.boolean(),
  navigationThresholdMs: z.number().int().min(100).max(60_000),
  interactionThresholdMs: z.number().int().min(100).max(10_000),
  maxReportsPerHour: z.number().int().min(0).max(100),
});
const duration = z.number().min(0).max(3_600_000);
export const webPerformanceReportSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  pageSessionId: z.uuid(),
  buildId: z.uuid().nullable(),
  sourceSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  policyVersion: z.number().int().positive(),
  kind: z.enum(["navigation", "interaction"]),
  // Application route templates only; never concrete URLs, query strings or labels.
  routeId: z
    .string()
    .max(240)
    .regex(/^[A-Za-z0-9_/$().{}-]+$/)
    .nullable(),
  durationMs: duration,
  thresholdMs: duration,
  outcome: z.enum(["resolved", "superseded", "still_pending", "interaction"]),
  loadMs: duration.nullable(),
  longTaskCount: z.number().int().min(0).max(100_000),
  longTaskTotalMs: duration,
  longestTaskMs: duration,
  requestCount: z.number().int().min(0).max(100_000),
  longestRequestMs: duration,
  requestGroups: z
    .array(
      z.strictObject({
        group: z.enum([
          "server_function",
          "space",
          "organization",
          "account",
          "inbox",
          "asset",
          "other",
        ]),
        count: z.number().int().min(0).max(100_000),
        maxMs: duration,
      })
    )
    .max(7),
});
export type WebPerformanceReport = z.infer<typeof webPerformanceReportSchema>;
export type WebPerformancePolicy = z.infer<typeof webPerformancePolicySchema>;
