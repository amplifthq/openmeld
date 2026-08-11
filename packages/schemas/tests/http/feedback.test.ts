import { describe, expect, it } from "vitest";
import {
  FEEDBACK_SUBMIT_DISABLED_ERROR_CODE,
  FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE,
  FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
  FEEDBACK_SUBMIT_RATE_LIMITED_ERROR_CODE,
  feedbackIssueCursorSchema,
  feedbackIssueRecordSchema,
  feedbackIssueStatusSchema,
  feedbackIssueSubmitRpcRequestSchema,
  feedbackReportingPolicyResponseSchema,
  feedbackSubmitErrorCodeSchema,
  gatewayErrorCodeSchema,
  listFeedbackIssuesForOrganizationRequestSchema,
  listFeedbackIssuesForOrganizationResponseSchema,
  readFeedbackReportingPolicyRequestSchema,
  submitFeedbackIssueRequestSchema,
  submitFeedbackIssueResponseSchema,
  updateFeedbackIssueStatusForOrganizationRequestSchema,
  updateFeedbackReportingPolicyBodySchema,
} from "../../src/index";

describe("feedback HTTP contracts", () => {
  it("accepts the complete bounded Feedback Issue submission contract", () => {
    const request = submitFeedbackIssueRequestSchema.safeParse({
      category: "experience",
      summary: "The setup progress stopped without a next action.",
      details: "The page stayed on the same step after the service connected.",
      submitterKind: "local_agent",
      sourceOrganizationId: "org_source",
      contactEmail: "feedback@example.com",
      clientContext: {
        clientKind: "cli",
        clientVersion: "0.1.0",
        os: "macOS 15.5",
      },
    });

    expect(request.success).toBe(true);
    expect(
      submitFeedbackIssueResponseSchema.safeParse({
        ok: true,
        issueId: "feedback_issue_1",
      }).success
    ).toBe(true);
    expect(feedbackIssueStatusSchema.options).toEqual([
      "new",
      "dismissed",
      "investigating",
      "ticketed",
      "needs_human",
      "resolved",
    ]);
    expect(feedbackSubmitErrorCodeSchema.options).toEqual([
      FEEDBACK_SUBMIT_INVALID_INPUT_ERROR_CODE,
      FEEDBACK_SUBMIT_INBOX_NOT_FOUND_ERROR_CODE,
      FEEDBACK_SUBMIT_RATE_LIMITED_ERROR_CODE,
      FEEDBACK_SUBMIT_DISABLED_ERROR_CODE,
    ]);
  });

  it("publishes every Feedback submit error through the Gateway envelope code set", () => {
    for (const code of feedbackSubmitErrorCodeSchema.options) {
      expect(gatewayErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("defines a strict Gateway-to-Core Feedback submit RPC request", () => {
    expect(
      feedbackIssueSubmitRpcRequestSchema.safeParse({
        inboxKey: "feedback_key_1",
        request: {
          category: "question",
          summary: "Where can I see service diagnostics?",
          submitterKind: "center_agent",
        },
        submitterUserId: null,
      }).success
    ).toBe(true);
    expect(
      feedbackIssueSubmitRpcRequestSchema.safeParse({
        inboxKey: "feedback_key_1",
        request: {
          category: "question",
          summary: "Where can I see service diagnostics?",
          submitterKind: "center_agent",
        },
        submitterUserId: null,
        extra: true,
      }).success
    ).toBe(false);
  });

  it("rejects unbounded, unknown, and semantically invalid submission fields", () => {
    const validRequest = {
      category: "bug",
      summary: "The submit button did not respond.",
      submitterKind: "human",
    } as const;

    expect(
      submitFeedbackIssueRequestSchema.safeParse({
        ...validRequest,
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      submitFeedbackIssueRequestSchema.safeParse({
        ...validRequest,
        summary: "x".repeat(201),
      }).success
    ).toBe(false);
    expect(
      submitFeedbackIssueRequestSchema.safeParse({
        ...validRequest,
        category: "support",
      }).success
    ).toBe(false);
    expect(
      submitFeedbackIssueRequestSchema.safeParse({
        ...validRequest,
        details: "x".repeat(4001),
      }).success
    ).toBe(false);
    expect(
      submitFeedbackIssueRequestSchema.safeParse({
        ...validRequest,
        clientContext: { extra: "not allowed" },
      }).success
    ).toBe(false);
    expect(
      submitFeedbackIssueResponseSchema.safeParse({
        ok: true,
        issueId: "feedback_issue_1",
        internal: true,
      }).success
    ).toBe(false);
  });

  it("defines strict organization-scoped Feedback handling RPC contracts", () => {
    const issue = {
      issueId: "feedback_issue_1",
      inboxId: "feedback_inbox_1",
      organizationId: "org_receiving",
      category: "bug",
      summary: "The submit button did not respond.",
      details: null,
      submitterKind: "center_agent",
      submitterUserId: null,
      sourceOrganizationId: "org_source",
      contactEmail: null,
      clientContext: { clientKind: "center_agent" },
      status: "new",
      triageNote: null,
      createdAtMs: 1000,
      updatedAtMs: 1000,
    } as const;
    const cursor = { createdAtMs: 1000, issueId: "feedback_issue_1" };

    expect(feedbackIssueRecordSchema.parse(issue)).toEqual(issue);
    expect(feedbackIssueCursorSchema.parse(cursor)).toEqual(cursor);
    expect(
      listFeedbackIssuesForOrganizationRequestSchema.parse({
        organizationId: "org_receiving",
        status: "new",
        cursor,
        limit: 100,
      })
    ).toEqual({
      organizationId: "org_receiving",
      status: "new",
      cursor,
      limit: 100,
    });
    expect(
      listFeedbackIssuesForOrganizationResponseSchema.parse({
        items: [issue],
        nextCursor: cursor,
      })
    ).toEqual({ items: [issue], nextCursor: cursor });
    expect(
      updateFeedbackIssueStatusForOrganizationRequestSchema.parse({
        organizationId: "org_receiving",
        issueId: "feedback_issue_1",
        status: "investigating",
        triageNote: "Reproduced locally.",
      })
    ).toEqual({
      organizationId: "org_receiving",
      issueId: "feedback_issue_1",
      status: "investigating",
      triageNote: "Reproduced locally.",
    });
  });

  it("keeps Feedback handling organization identity required and triage notes bounded", () => {
    expect(
      listFeedbackIssuesForOrganizationRequestSchema.safeParse({ limit: 10 })
        .success
    ).toBe(false);
    expect(
      listFeedbackIssuesForOrganizationRequestSchema.safeParse({
        organizationId: "org_receiving",
        organizationIdOverride: "org_other",
      }).success
    ).toBe(false);
    expect(
      updateFeedbackIssueStatusForOrganizationRequestSchema.safeParse({
        organizationId: "org_receiving",
        issueId: "feedback_issue_1",
        status: "investigating",
        triageNote: "x".repeat(2001),
      }).success
    ).toBe(false);
  });

  it("defines the opt-out Feedback reporting policy contract", () => {
    expect(
      feedbackReportingPolicyResponseSchema.parse({
        organizationId: "org_receiving",
        reportingEnabled: true,
        updatedByUserId: null,
      })
    ).toEqual({
      organizationId: "org_receiving",
      reportingEnabled: true,
      updatedByUserId: null,
    });
    expect(
      readFeedbackReportingPolicyRequestSchema.parse({
        organizationId: "org_receiving",
      })
    ).toEqual({ organizationId: "org_receiving" });
    expect(
      updateFeedbackReportingPolicyBodySchema.parse({
        reportingEnabled: false,
      })
    ).toEqual({ reportingEnabled: false });
    expect(
      updateFeedbackReportingPolicyBodySchema.safeParse({
        reportingEnabled: true,
        organizationId: "org_other",
      }).success
    ).toBe(false);
  });
});
