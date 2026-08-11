import type {
  FeedbackReportingPolicyResponse,
  OpenMeldRequestContext,
  SubmitFeedbackIssueRequest,
  SubmitFeedbackIssueResponse,
  UpdateFeedbackReportingPolicyBody,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type SubmitFeedbackIssueInput = {
  inboxKey: string;
  request: SubmitFeedbackIssueRequest;
};

export type FeedbackRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type SetCurrentOrganizationFeedbackReportingPolicyInput =
  FeedbackRequestInput & UpdateFeedbackReportingPolicyBody;

export type FeedbackApi = {
  submitFeedbackIssue: (
    input: SubmitFeedbackIssueInput
  ) => Promise<SubmitFeedbackIssueResponse>;
  readCurrentOrganizationFeedbackReportingPolicy: (
    input?: FeedbackRequestInput
  ) => Promise<FeedbackReportingPolicyResponse>;
  setCurrentOrganizationFeedbackReportingPolicy: (
    input: SetCurrentOrganizationFeedbackReportingPolicyInput
  ) => Promise<FeedbackReportingPolicyResponse>;
};

export type CreateFeedbackApi = (
  client: OpenMeldApiClientFoundation
) => FeedbackApi;
