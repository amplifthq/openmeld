import { z } from "zod/v4";

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
  "server_request",
  "server_function",
]);

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
  buildId: z.uuid().nullable(),
  sourceSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  source: webApplicationErrorSourceSchema,
  routeId: z
    .string()
    .max(240)
    .regex(/^[A-Za-z0-9_/$().{}-]+$/)
    .nullable(),
  error: webApplicationErrorSummarySchema,
});

export type WebApplicationErrorReport = z.infer<
  typeof webApplicationErrorReportSchema
>;
export type WebApplicationErrorSource = z.infer<
  typeof webApplicationErrorSourceSchema
>;
