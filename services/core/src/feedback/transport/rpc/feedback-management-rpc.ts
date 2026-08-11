import {
  FEEDBACK_ISSUE_INVALID_INPUT_ERROR_CODE,
  FEEDBACK_ISSUE_INVALID_TRANSITION_ERROR_CODE,
  FEEDBACK_ISSUE_NOT_FOUND_ERROR_CODE,
  feedbackIssueRecordSchema,
  feedbackReportingPolicyResponseSchema,
  listFeedbackIssuesForOrganizationRequestSchema,
  listFeedbackIssuesForOrganizationResponseSchema,
  readFeedbackReportingPolicyRequestSchema,
  updateFeedbackIssueStatusForOrganizationRequestSchema,
  updateFeedbackReportingPolicyBodySchema,
} from "@openmeld/schemas";
import type {
  FeedbackIssueRecord,
  FeedbackReportingPolicyResponse,
  ListFeedbackIssuesForOrganizationRequest,
  ListFeedbackIssuesForOrganizationResponse,
  ReadFeedbackReportingPolicyRequest,
  UpdateFeedbackIssueStatusForOrganizationRequest,
} from "@openmeld/schemas/types";
import { type CoreBindings, feedbackDb } from "../../../lib/bindings";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import {
  createFeedbackIssueService,
  FeedbackIssueServiceError,
} from "../../application/feedback-issue-service";
import { createFeedbackReportingPolicyService } from "../../application/feedback-reporting-policy-service";
import { createD1FeedbackIssueRepository } from "../../infrastructure/d1/feedback-issue-repo";
import { createD1FeedbackReportingPolicyRepository } from "../../infrastructure/d1/feedback-reporting-policy-repo";

export type SetFeedbackReportingPolicyForOrganizationInput = {
  organizationId: string;
  reportingEnabled: boolean;
  updatedByUserId: string | null;
};

export async function rpcListFeedbackIssuesForOrganization(
  env: CoreBindings,
  input: ListFeedbackIssuesForOrganizationRequest
): Promise<ListFeedbackIssuesForOrganizationResponse> {
  const request =
    listFeedbackIssuesForOrganizationRequestSchema.safeParse(input);
  if (!request.success) {
    throw invalidFeedbackIssueInputError("feedback issue query is invalid");
  }
  try {
    return listFeedbackIssuesForOrganizationResponseSchema.parse(
      await createCoreFeedbackIssueService(env).listFeedbackIssues(request.data)
    );
  } catch (error) {
    throwFeedbackIssueServiceError(error);
  }
}

export async function rpcUpdateFeedbackIssueStatusForOrganization(
  env: CoreBindings,
  input: UpdateFeedbackIssueStatusForOrganizationRequest
): Promise<FeedbackIssueRecord> {
  const request =
    updateFeedbackIssueStatusForOrganizationRequestSchema.safeParse(input);
  if (!request.success) {
    throw invalidFeedbackIssueInputError("feedback issue update is invalid");
  }
  try {
    return feedbackIssueRecordSchema.parse(
      await createCoreFeedbackIssueService(env).updateFeedbackIssueStatus(
        request.data
      )
    );
  } catch (error) {
    throwFeedbackIssueServiceError(error);
  }
}

export async function rpcReadFeedbackReportingPolicy(
  env: CoreBindings,
  input: ReadFeedbackReportingPolicyRequest
): Promise<FeedbackReportingPolicyResponse> {
  const request = readFeedbackReportingPolicyRequestSchema.safeParse(input);
  if (!request.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "feedback reporting policy query is invalid",
      code: "invalid_payload",
    });
  }
  return feedbackReportingPolicyResponseSchema.parse(
    await createCoreFeedbackReportingPolicyService(
      env
    ).readFeedbackReportingPolicy(request.data)
  );
}

export async function rpcSetFeedbackReportingPolicy(
  env: CoreBindings,
  input: SetFeedbackReportingPolicyForOrganizationInput
): Promise<FeedbackReportingPolicyResponse> {
  const organization = readFeedbackReportingPolicyRequestSchema.safeParse({
    organizationId: input.organizationId,
  });
  const body = updateFeedbackReportingPolicyBodySchema.safeParse({
    reportingEnabled: input.reportingEnabled,
  });
  if (!(organization.success && body.success)) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "feedback reporting policy update is invalid",
      code: "invalid_payload",
    });
  }
  return feedbackReportingPolicyResponseSchema.parse(
    await createCoreFeedbackReportingPolicyService(
      env
    ).setFeedbackReportingPolicy({
      organizationId: organization.data.organizationId,
      reportingEnabled: body.data.reportingEnabled,
      updatedByUserId: input.updatedByUserId,
    })
  );
}

function createCoreFeedbackIssueService(env: CoreBindings) {
  const db = requireFeedbackDb(env);
  return createFeedbackIssueService({
    generateIssueId: () => `feedback_issue_${crypto.randomUUID()}`,
    repository: createD1FeedbackIssueRepository({ db }),
  });
}

function createCoreFeedbackReportingPolicyService(env: CoreBindings) {
  return createFeedbackReportingPolicyService({
    repository: createD1FeedbackReportingPolicyRepository({
      db: requireFeedbackDb(env),
    }),
  });
}

function requireFeedbackDb(env: CoreBindings): D1Database {
  const db = feedbackDb(env);
  if (!db) {
    throw new Error("Feedback D1 binding is unavailable");
  }
  return db;
}

function invalidFeedbackIssueInputError(reason: string): Error {
  return createCoreRpcHttpError({
    status: 400,
    reason,
    code: FEEDBACK_ISSUE_INVALID_INPUT_ERROR_CODE,
  });
}

function throwFeedbackIssueServiceError(error: unknown): never {
  if (!(error instanceof FeedbackIssueServiceError)) {
    throw error;
  }
  switch (error.code) {
    case FEEDBACK_ISSUE_INVALID_INPUT_ERROR_CODE:
      throw createCoreRpcHttpError({
        status: 400,
        reason: error.message,
        code: error.code,
      });
    case FEEDBACK_ISSUE_NOT_FOUND_ERROR_CODE:
      throw createCoreRpcHttpError({
        status: 404,
        reason: error.message,
        code: error.code,
      });
    case FEEDBACK_ISSUE_INVALID_TRANSITION_ERROR_CODE:
      throw createCoreRpcHttpError({
        status: 409,
        reason: error.message,
        code: error.code,
      });
    default:
      throw error;
  }
}
