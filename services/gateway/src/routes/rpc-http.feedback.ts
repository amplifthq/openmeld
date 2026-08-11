import {
  FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
  FEEDBACK_SUBMIT_RATE_LIMITED_ERROR_CODE,
  feedbackIssueSubmitRpcRequestSchema,
  submitFeedbackIssueRequestSchema,
  submitFeedbackIssueResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import {
  createCloudflareFeedbackSubmitRateLimiter,
  type FeedbackSubmitRateLimitDimension,
} from "../feedback/feedback-submit-rate-limiter";
import { FEEDBACK_SUBMIT_ROUTE } from "../lib/anonymous-feedback-submit-route";
import type { HonoBindings } from "../lib/bindings";
import {
  executePublicRpcRoute,
  respondPublicBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

export function registerFeedbackRoutes(app: Hono<HonoBindings>): void {
  app.post(FEEDBACK_SUBMIT_ROUTE, async (c) => {
    const inboxKeyResult =
      feedbackIssueSubmitRpcRequestSchema.shape.inboxKey.safeParse(
        c.req.param("inboxKey")
      );
    if (!inboxKeyResult.success) {
      return respondPublicBadRequest({
        c,
        route: FEEDBACK_SUBMIT_ROUTE,
        method: "POST",
        code: FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
        message: "feedback inbox key is invalid",
        reason: "feedback_inbox_key_invalid",
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondPublicBadRequest({
        c,
        route: FEEDBACK_SUBMIT_ROUTE,
        method: "POST",
        code: FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
        message: "feedback submission must be valid JSON",
        reason: "feedback_json_invalid",
      });
    }

    const parsedBody = submitFeedbackIssueRequestSchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondPublicBadRequest({
        c,
        route: FEEDBACK_SUBMIT_ROUTE,
        method: "POST",
        code: FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
        message: "feedback submission is invalid",
        reason: "feedback_payload_invalid",
      });
    }

    const inboxKey = inboxKeyResult.data;
    const request = parsedBody.data;
    return executePublicRpcRoute({
      c,
      route: FEEDBACK_SUBMIT_ROUTE,
      method: "POST",
      retryMode: "none",
      responseSchema: submitFeedbackIssueResponseSchema,
      execute: async () => {
        const rateLimiter = createCloudflareFeedbackSubmitRateLimiter({
          ip: c.env.OPENMELD_FEEDBACK_IP_RATE_LIMITER,
          inbox: c.env.OPENMELD_FEEDBACK_INBOX_RATE_LIMITER,
        });
        const rateLimitResult = await rateLimiter.check({
          ipAddress: readFeedbackSubmitIpAddress(c.req.raw.headers),
          inboxKey,
        });
        if (!rateLimitResult.allowed) {
          logFeedbackRateLimitRejection({
            category: request.category,
            detailsLength: request.details?.length ?? 0,
            dimension: rateLimitResult.rejectedDimension,
            requestId: c.var.ingressOpenMeldContext.requestId,
            submitterKind: request.submitterKind,
            summaryLength: request.summary.length,
          });
          throw createFeedbackRateLimitedError();
        }

        return await c.var.coreRpc.submitFeedbackIssue({
          inboxKey,
          request,
          submitterUserId: c.var.feedbackSubmitterUserId ?? null,
        });
      },
    });
  });
}

function readFeedbackSubmitIpAddress(headers: Headers): string {
  const value = headers.get("CF-Connecting-IP")?.trim();
  return value || "unknown";
}

function createFeedbackRateLimitedError(): Error {
  const message = "feedback submission rate limit exceeded";
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = {
    status: 429,
    code: FEEDBACK_SUBMIT_RATE_LIMITED_ERROR_CODE,
    message,
  };
  return error;
}

function logFeedbackRateLimitRejection(input: {
  category: string;
  detailsLength: number;
  dimension: FeedbackSubmitRateLimitDimension;
  requestId: string;
  submitterKind: string;
  summaryLength: number;
}): void {
  console.warn("[gateway.feedback.submit_rate_limited]", {
    event: "gateway.feedback.submit_rate_limited",
    issueId: null,
    inboxId: null,
    category: input.category,
    submitterKind: input.submitterKind,
    summaryLength: input.summaryLength,
    detailsLength: input.detailsLength,
    reasonCode: FEEDBACK_SUBMIT_RATE_LIMITED_ERROR_CODE,
    rateLimitDimension: input.dimension,
    requestId: input.requestId,
  });
}
