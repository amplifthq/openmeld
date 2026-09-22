import * as z from "zod/v4";
import { gatewayErrorCodeSchema } from "./schemas/http/gateway-error";

export const WEB_APPLICATION_ERROR_PATH =
  "/v1/observability/application-errors";
export const WEB_APPLICATION_ERROR_MAX_BYTES = 8192;

export const webApplicationErrorSourceSchema = z.enum([
  "window",
  "unhandled_rejection",
  "route",
  "react_caught",
  "react_uncaught",
  "react_recoverable",
  "resource",
  "preload",
  "query",
  "server_request",
  "server_function",
]);

export const webApplicationErrorQueryCategorySchema = z.enum([
  "account_spaces",
  "inbox",
  "space_live",
  "space_members",
]);

export const webApplicationErrorQueryCodeSchema = z.union([
  gatewayErrorCodeSchema,
  z.enum([
    "gateway.http_error",
    "gateway.invalid_response",
    "network.request_failed",
    "network.timeout",
  ]),
]);

export const webApplicationErrorQueryDiagnosticSchema = z.object({
  category: webApplicationErrorQueryCategorySchema,
  failure: z.object({
    code: webApplicationErrorQueryCodeSchema.nullable(),
    requestId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_.:-]+$/)
      .nullable(),
    status: z.number().int().min(100).max(599).nullable(),
  }),
});

export const webApplicationErrorSummarySchema = z.object({
  name: z.enum([
    "Error",
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "RangeError",
    "URIError",
    "Unknown",
  ]),
  code: z.enum([
    "module_load_failed",
    "css_load_failed",
    "undefined_property",
    "not_callable",
    "hydration_failed",
    "http_5xx",
    "unexpected",
  ]),
  // Only build asset locations, never raw messages, URLs, or stack text.
  frames: z
    .array(
      z
        .string()
        .max(240)
        .regex(
          /^(?:assets\/[A-Za-z0-9_$.-]+\.(?:js|css)|server\.js)(?::\d{1,9}:\d{1,9})?$/
        )
    )
    .max(12),
});

export const webApplicationErrorReportSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  pageSessionId: z.uuid().optional(),
  spaceOpenAttemptId: z.uuid().optional(),
  buildId: z.uuid().nullable(),
  sourceSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  source: webApplicationErrorSourceSchema,
  submission: z.enum(["user"]).optional(),
  routeId: z
    .string()
    .max(240)
    .regex(/^[A-Za-z0-9_/$().{}-]+$/)
    .nullable(),
  query: webApplicationErrorQueryDiagnosticSchema.optional(),
  error: webApplicationErrorSummarySchema,
});

export type WebApplicationErrorReport = z.infer<
  typeof webApplicationErrorReportSchema
>;
export type WebApplicationErrorSource = z.infer<
  typeof webApplicationErrorSourceSchema
>;
export type WebApplicationErrorQueryCategory = z.infer<
  typeof webApplicationErrorQueryCategorySchema
>;
export type WebApplicationErrorQueryDiagnostic = z.infer<
  typeof webApplicationErrorQueryDiagnosticSchema
>;
