import { getPostgresDatabase } from "@openmeld/db/postgresql";
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
import type { CoreBindings } from "../../../lib/bindings";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import {
  createFeedbackIssueService,
  FeedbackIssueServiceError,
} from "../../application/feedback-issue-service";
import { createPostgresFeedbackIssueRepository } from "../../infrastructure/postgresql/feedback-issue-repo";

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

  const db = getPostgresDatabase(env);
  if (!db) {
    throw new Error("Feedback D1 binding is unavailable");
  }

  const service = createFeedbackIssueService({
    repository: createPostgresFeedbackIssueRepository({ db }),
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
