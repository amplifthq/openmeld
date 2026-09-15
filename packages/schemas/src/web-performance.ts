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
  kind: z.enum(["navigation", "interaction", "space_open"]),
  // Application route templates only; never concrete URLs, query strings or labels.
  routeId: z
    .string()
    .max(240)
    .regex(/^[A-Za-z0-9_/$().{}-]+$/)
    .nullable(),
  durationMs: duration,
  thresholdMs: duration,
  outcome: z.enum([
    "resolved",
    "superseded",
    "still_pending",
    "interaction",
    "failed",
    "denied",
  ]),
  loadMs: duration.nullable(),
  longTaskCount: z.number().int().min(0).max(100_000).nullable(),
  longTaskTotalMs: duration.nullable(),
  longestTaskMs: duration.nullable(),
  requestCount: z.number().int().min(0).max(100_000).nullable(),
  longestRequestMs: duration.nullable(),
  spaceOpen: z
    .strictObject({
      attemptId: z.uuid(),
      trigger: z.enum(["initial", "navigation"]),
      sampling: z.enum(["normal", "slow", "failure", "user"]),
      sampleRate: z.number().min(0).max(1),
      stage: z.enum(["route", "access", "content", "composer", "ready"]),
      accessMs: duration.nullable(),
      contentMs: duration.nullable(),
      composerMs: duration.nullable(),
      content: z.enum(["unknown", "messages", "empty"]),
      composer: z.enum(["unknown", "editable", "read_only"]),
      cache: z.enum(["unknown", "memory", "restored", "cold"]),
      prefetch: z.enum(["unknown", "in_flight", "complete"]),
      visibility: z.enum(["visible", "hidden"]),
      wasHidden: z.boolean(),
      online: z.boolean(),
      queryStatus: z.enum(["unknown", "pending", "error", "success"]),
      fetchStatus: z.enum(["unknown", "fetching", "paused", "idle"]),
      failureCount: z.number().int().min(0).max(1000),
      requests: z
        .array(
          z.strictObject({
            operation: z.enum([
              "entry",
              "bootstrap",
              "history",
              "status",
              "members",
            ]),
            phase: z.enum([
              "preparing",
              "sent",
              "headers",
              "validating",
              "complete",
              "failed",
            ]),
            elapsedMs: duration,
            sentMs: duration.nullable(),
            headersMs: duration.nullable(),
            validatedMs: duration.nullable(),
            failedAt: z
              .enum(["preparing", "sent", "headers", "validating"])
              .nullable(),
            requestId: z
              .string()
              .max(128)
              .regex(/^[A-Za-z0-9_-]+$/)
              .nullable(),
            status: z.number().int().min(100).max(599).nullable(),
          })
        )
        .max(8),
    })
    .optional(),
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
