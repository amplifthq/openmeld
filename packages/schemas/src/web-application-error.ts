import * as z from "zod/v4";
import { gatewayErrorCodeSchema } from "./schemas/http/gateway-error";
import { wakeProgressPhaseSchema } from "./schemas/http/space-wake-progress";

export const WEB_APPLICATION_ERROR_PATH =
  "/v1/observability/application-errors";
export const WEB_APPLICATION_ERROR_MAX_BYTES = 8192;
export const WEB_APPLICATION_REACT_UPDATE_TRACE_MAX_EVENTS = 40;

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
  "wake_progress_presentation",
]);

export const webApplicationErrorQueryCategorySchema = z.enum([
  "account_organization_context",
  "account_session",
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
  stage: z.enum(["prepare", "navigate", "persist", "refresh"]).optional(),
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

export const webApplicationErrorRouteIdSchema = z
  .string()
  .max(240)
  .regex(/^[A-Za-z0-9_/$().{}-]+$/);

export const webApplicationErrorBoundarySchema = z.enum([
  "space_conversation",
  "space_composer_editor",
  "markdown_editor",
]);

// Static code-path labels only. Never accept component props, draft content,
// stack text, account identity, or browser URLs in this diagnostic trace.
export const webApplicationReactUpdateEventSchema = z.enum([
  "composer_draft_set",
  "composer_draft_restore",
  "composer_editor_external_value",
  "composer_editor_change_equal",
  "composer_editor_change_different",
  "conversation_position_restore",
  "conversation_position_ready",
  "conversation_position_follow",
  "center_agent_pending_scope_write",
  "space_history_cache_write",
  "space_timeline_write",
  "space_timeline_agent_controller_changed",
  "space_wake_visible_publish",
]);

export type WebApplicationReactUpdateEvent = z.infer<
  typeof webApplicationReactUpdateEventSchema
>;

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
    "unconfirmed_wake_progress_displayed",
    "react_update_depth",
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

const wakeDiagnosticPointerSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);

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
  routeId: webApplicationErrorRouteIdSchema.nullable(),
  navigation: z
    .object({
      fromRouteId: webApplicationErrorRouteIdSchema,
      elapsedMs: z.number().int().nonnegative().max(600_000),
    })
    .optional(),
  reactBoundary: webApplicationErrorBoundarySchema.optional(),
  reactUpdateTrace: z
    .array(
      z.strictObject({
        event: webApplicationReactUpdateEventSchema,
        ageMs: z.number().int().nonnegative().max(5000),
      })
    )
    .max(WEB_APPLICATION_REACT_UPDATE_TRACE_MAX_EVENTS)
    .optional(),
  query: webApplicationErrorQueryDiagnosticSchema.optional(),
  wakeProgress: z
    .strictObject({
      spaceId: wakeDiagnosticPointerSchema,
      clientMessageId: wakeDiagnosticPointerSchema.nullable(),
      dispatchId: wakeDiagnosticPointerSchema.nullable(),
      sourceSignalId: wakeDiagnosticPointerSchema.nullable(),
      streamId: wakeDiagnosticPointerSchema.nullable(),
      sourceThreadId: wakeDiagnosticPointerSchema.nullable(),
      replyThreadRootSignalId: wakeDiagnosticPointerSchema.nullable(),
      targetProfileId: wakeDiagnosticPointerSchema,
      phase: wakeProgressPhaseSchema,
      updatedAtMs: z.number().int().nonnegative(),
      fromRestoredPresentation: z.boolean(),
      fromCachedSpaceSummary: z.boolean(),
      fromCachedOwnSummary: z.boolean(),
      fromBootstrapStream: z.boolean(),
      fromHistoricalSignal: z.boolean().optional(),
      spaceSummaryFetchedAfterMount: z.boolean(),
      ownSummaryFetchedAfterMount: z.boolean(),
      bootstrapFetchedAfterMount: z.boolean(),
    })
    .optional(),
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
export type WebApplicationErrorBoundary = z.infer<
  typeof webApplicationErrorBoundarySchema
>;
