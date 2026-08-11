import type { z } from "zod/v4";

type FeedbackIssueStatusSchema =
  typeof import("../../schemas/http/feedback")["feedbackIssueStatusSchema"];
type FeedbackIssueErrorCodeSchema =
  typeof import("../../schemas/http/feedback")["feedbackIssueErrorCodeSchema"];
type FeedbackSubmitErrorCodeSchema =
  typeof import("../../schemas/http/feedback")["feedbackSubmitErrorCodeSchema"];
type FeedbackClientContextSchema =
  typeof import("../../schemas/http/feedback")["feedbackClientContextSchema"];
type FeedbackIssueSubmitRpcRequestSchema =
  typeof import("../../schemas/http/feedback")["feedbackIssueSubmitRpcRequestSchema"];
type SubmitFeedbackIssueRequestSchema =
  typeof import("../../schemas/http/feedback")["submitFeedbackIssueRequestSchema"];
type SubmitFeedbackIssueResponseSchema =
  typeof import("../../schemas/http/feedback")["submitFeedbackIssueResponseSchema"];
type FeedbackIssueCursorSchema =
  typeof import("../../schemas/http/feedback")["feedbackIssueCursorSchema"];
type FeedbackIssueRecordSchema =
  typeof import("../../schemas/http/feedback")["feedbackIssueRecordSchema"];
type ListFeedbackIssuesForOrganizationRequestSchema =
  typeof import("../../schemas/http/feedback")["listFeedbackIssuesForOrganizationRequestSchema"];
type ListFeedbackIssuesForOrganizationResponseSchema =
  typeof import("../../schemas/http/feedback")["listFeedbackIssuesForOrganizationResponseSchema"];
type UpdateFeedbackIssueStatusForOrganizationRequestSchema =
  typeof import("../../schemas/http/feedback")["updateFeedbackIssueStatusForOrganizationRequestSchema"];
type FeedbackReportingPolicyResponseSchema =
  typeof import("../../schemas/http/feedback")["feedbackReportingPolicyResponseSchema"];
type ReadFeedbackReportingPolicyRequestSchema =
  typeof import("../../schemas/http/feedback")["readFeedbackReportingPolicyRequestSchema"];
type UpdateFeedbackReportingPolicyBodySchema =
  typeof import("../../schemas/http/feedback")["updateFeedbackReportingPolicyBodySchema"];

export type FeedbackIssueStatus = z.infer<FeedbackIssueStatusSchema>;
export type FeedbackIssueErrorCode = z.infer<FeedbackIssueErrorCodeSchema>;
export type FeedbackSubmitErrorCode = z.infer<FeedbackSubmitErrorCodeSchema>;
export type FeedbackClientContext = z.infer<FeedbackClientContextSchema>;
export type FeedbackIssueSubmitRpcRequest =
  z.infer<FeedbackIssueSubmitRpcRequestSchema>;
export type SubmitFeedbackIssueRequest =
  z.infer<SubmitFeedbackIssueRequestSchema>;
export type SubmitFeedbackIssueResponse =
  z.infer<SubmitFeedbackIssueResponseSchema>;
export type FeedbackIssueCursor = z.infer<FeedbackIssueCursorSchema>;
export type FeedbackIssueRecord = z.infer<FeedbackIssueRecordSchema>;
export type ListFeedbackIssuesForOrganizationRequest =
  z.infer<ListFeedbackIssuesForOrganizationRequestSchema>;
export type ListFeedbackIssuesForOrganizationResponse =
  z.infer<ListFeedbackIssuesForOrganizationResponseSchema>;
export type UpdateFeedbackIssueStatusForOrganizationRequest =
  z.infer<UpdateFeedbackIssueStatusForOrganizationRequestSchema>;
export type FeedbackReportingPolicyResponse =
  z.infer<FeedbackReportingPolicyResponseSchema>;
export type ReadFeedbackReportingPolicyRequest =
  z.infer<ReadFeedbackReportingPolicyRequestSchema>;
export type UpdateFeedbackReportingPolicyBody =
  z.infer<UpdateFeedbackReportingPolicyBodySchema>;
