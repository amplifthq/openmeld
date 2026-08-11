import {
  feedbackReportingPolicyResponseSchema,
  submitFeedbackIssueRequestSchema,
  submitFeedbackIssueResponseSchema,
  updateFeedbackReportingPolicyBodySchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildCurrentOrganizationFeedbackReportingPolicyPath,
  buildFeedbackIssueSubmissionPath,
} from "./routes";
import type { CreateFeedbackApi } from "./types";

export const createFeedbackApi: CreateFeedbackApi = (
  client: OpenMeldApiClientFoundation
) => ({
  submitFeedbackIssue: async (input) => {
    const request = submitFeedbackIssueRequestSchema.parse(input.request);
    return await client.requestJson({
      url: buildFeedbackIssueSubmissionPath(input.inboxKey),
      operation: "feedback.issue.submit",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      schema: submitFeedbackIssueResponseSchema,
      invalidMessage: "invalid Feedback Issue submission response",
    });
  },
  readCurrentOrganizationFeedbackReportingPolicy: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationFeedbackReportingPolicyPath(),
      operation: "feedback.reporting_policy.read",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: feedbackReportingPolicyResponseSchema,
      invalidMessage: "invalid feedback reporting policy response",
    }),
  setCurrentOrganizationFeedbackReportingPolicy: async (input) => {
    const body = updateFeedbackReportingPolicyBodySchema.parse({
      reportingEnabled: input.reportingEnabled,
    });
    return await client.requestJson({
      url: buildCurrentOrganizationFeedbackReportingPolicyPath(),
      operation: "feedback.reporting_policy.write",
      method: "PUT",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      schema: feedbackReportingPolicyResponseSchema,
      invalidMessage: "invalid feedback reporting policy response",
    });
  },
});
