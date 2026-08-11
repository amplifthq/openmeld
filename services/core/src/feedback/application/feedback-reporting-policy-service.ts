import {
  feedbackReportingPolicyResponseSchema,
  readFeedbackReportingPolicyRequestSchema,
  updateFeedbackReportingPolicyBodySchema,
} from "@openmeld/schemas";
import type { FeedbackReportingPolicyResponse } from "@openmeld/schemas/types";

export type FeedbackReportingPolicyRepository = {
  readPolicy(
    organizationId: string
  ): Promise<FeedbackReportingPolicyResponse | null>;
  upsertPolicy(input: {
    nowMs: number;
    organizationId: string;
    reportingEnabled: boolean;
    updatedByUserId: string | null;
  }): Promise<FeedbackReportingPolicyResponse>;
};

export function createFeedbackReportingPolicyService(input: {
  nowMs?: () => number;
  repository: FeedbackReportingPolicyRepository;
}) {
  const nowMs = input.nowMs ?? Date.now;

  return {
    async readFeedbackReportingPolicy(readInput: {
      organizationId: string;
    }): Promise<FeedbackReportingPolicyResponse> {
      const request = readFeedbackReportingPolicyRequestSchema.parse(readInput);
      const policy = await input.repository.readPolicy(request.organizationId);
      return feedbackReportingPolicyResponseSchema.parse(
        policy ?? {
          organizationId: request.organizationId,
          reportingEnabled: true,
          updatedByUserId: null,
        }
      );
    },

    async setFeedbackReportingPolicy(setInput: {
      organizationId: string;
      reportingEnabled: boolean;
      updatedByUserId: string | null;
    }): Promise<FeedbackReportingPolicyResponse> {
      const request = readFeedbackReportingPolicyRequestSchema.parse({
        organizationId: setInput.organizationId,
      });
      const body = updateFeedbackReportingPolicyBodySchema.parse({
        reportingEnabled: setInput.reportingEnabled,
      });
      const updatedByUserId = normalizeNullableIdentifier(
        setInput.updatedByUserId
      );
      return feedbackReportingPolicyResponseSchema.parse(
        await input.repository.upsertPolicy({
          nowMs: nowMs(),
          organizationId: request.organizationId,
          reportingEnabled: body.reportingEnabled,
          updatedByUserId,
        })
      );
    },
  };
}

function normalizeNullableIdentifier(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("updatedByUserId must be a non-empty identifier");
  }
  return normalized;
}
