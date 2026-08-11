import {
  FEEDBACK_SUBMIT_DISABLED_ERROR_CODE,
  FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE,
  FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
  feedbackIssueSubmitRpcRequestSchema,
} from "@openmeld/schemas";
import type {
  FeedbackIssueSubmitRpcRequest,
  SubmitFeedbackIssueResponse,
} from "@openmeld/schemas/types";
import { type CoreBindings, feedbackDb } from "../../../lib/bindings";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import {
  createFeedbackIssueService,
  FeedbackIssueServiceError,
} from "../../application/feedback-issue-service";
import { createD1FeedbackIssueRepository } from "../../infrastructure/d1/feedback-issue-repo";

export async function rpcSubmitFeedbackIssue(
  env: CoreBindings,
  input: FeedbackIssueSubmitRpcRequest
): Promise<SubmitFeedbackIssueResponse> {
  const parsed = feedbackIssueSubmitRpcRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "feedback submission is invalid",
      code: FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
    });
  }

  const db = feedbackDb(env);
  if (!db) {
    throw new Error("Feedback D1 binding is unavailable");
  }

  const service = createFeedbackIssueService({
    repository: createD1FeedbackIssueRepository({ db }),
    generateIssueId: () => `feedback_issue_${crypto.randomUUID()}`,
  });

  try {
    return await service.submitFeedbackIssue(parsed.data);
  } catch (error) {
    if (!(error instanceof FeedbackIssueServiceError)) {
      throw error;
    }

    switch (error.code) {
      case FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE:
        throw createCoreRpcHttpError({
          status: 400,
          reason: error.message,
          code: error.code,
        });
      case FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE:
        throw createCoreRpcHttpError({
          status: 404,
          reason: error.message,
          code: error.code,
        });
      case FEEDBACK_SUBMIT_DISABLED_ERROR_CODE:
        throw createCoreRpcHttpError({
          status: 403,
          reason: error.message,
          code: error.code,
        });
      default:
        throw error;
    }
  }
}
