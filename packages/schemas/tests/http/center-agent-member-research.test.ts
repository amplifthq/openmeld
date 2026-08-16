import { describe, expect, it } from "vitest";
import {
  centerAgentMemberResearchBatchSchema,
  centerAgentMemberResearchReportSchema,
  centerAgentStartSelfMemberResearchToolRpcInputSchema,
} from "../../src/schemas/http/center-agent-member-research";

const CREATED_AT = "2026-07-16T00:00:00.000Z";
const UPDATED_AT = "2026-07-16T00:01:00.000Z";
const COMPLETE_COVERAGE = [
  "organization_directory",
  "approved_profile_report",
  "agent_activity",
  "github",
  "slack_workspace_directory",
  "slack_channel_history",
  "connected_apps",
].map((source) => ({
  evidence: `${source} research result`,
  source,
  status: "checked",
  timeRange: "2026-04-17 to 2026-07-16",
}));
const ACTIVITY_EVIDENCE = {
  date: "2026-07-10",
  source: "agent_activity",
  sourceId: "activity_1",
  text: "Validated the release path.",
};
const GITHUB_EVIDENCE = {
  date: "2026-07-12",
  source: "github",
  sourceId: "acme/repo#42",
  sourceUrl: "https://github.com/acme/repo/pull/42",
  text: "Merged the release guard.",
};
const SLACK_EVIDENCE = {
  date: "2026-07-13",
  source: "slack",
  sourceId: "C_PRODUCT:1720890000.000100",
  sourceName: "#product",
  text: "Shared the rollout plan with the product team.",
};
const CONNECTED_APP_EVIDENCE = {
  date: "2026-07-14",
  source: "connected_app",
  sourceId: "drive:file-42",
  sourceName: "Google Drive",
  sourceUrl: "https://drive.google.com/open?id=file-42",
  text: "Updated the launch brief.",
};

describe("Center Agent member research contracts", () => {
  it("accepts only a verified member speaker for conversational self research", () => {
    const input = {
      context: {
        activeOrganizationId: "organization-1",
        actorContext: {
          callerPrincipalId: "center-agent-owner",
          openMeldProfileId: "agt_00000000-0000-4000-8000-000000000001",
          ownerUserId: "center-agent-owner",
          profileKind: "agent",
          requestId: "request-1",
        },
      },
      speakerMember: {
        memberId: "member-1",
        userId: "user-1",
      },
    };

    expect(
      centerAgentStartSelfMemberResearchToolRpcInputSchema.safeParse(input)
        .success
    ).toBe(true);
    expect(
      centerAgentStartSelfMemberResearchToolRpcInputSchema.safeParse({
        ...input,
        subjectUserId: "user-2",
      }).success
    ).toBe(false);
  });

  it("accepts an ordered batch whose status and counts match its tasks", () => {
    expect(
      centerAgentMemberResearchBatchSchema.safeParse({
        completedCount: 1,
        createdAt: CREATED_AT,
        failedCount: 1,
        id: "batch-1",
        organizationId: "organization-1",
        scope: "all",
        status: "completed",
        tasks: [
          {
            failureCode: null,
            finishedAt: UPDATED_AT,
            id: "task-1",
            position: 1,
            startedAt: CREATED_AT,
            status: "completed",
            subjectDisplayName: "Alex",
            subjectUserId: "user-alex",
          },
          {
            failureCode: "research_failed",
            finishedAt: UPDATED_AT,
            id: "task-2",
            position: 2,
            startedAt: CREATED_AT,
            status: "failed",
            subjectDisplayName: "Morgan",
            subjectUserId: "user-morgan",
          },
        ],
        totalCount: 2,
        updatedAt: UPDATED_AT,
      }).success
    ).toBe(true);
  });

  it("rejects task lifecycle and batch projections that contradict their status", () => {
    const result = centerAgentMemberResearchBatchSchema.safeParse({
      completedCount: 0,
      createdAt: UPDATED_AT,
      failedCount: 0,
      id: "batch-1",
      organizationId: "organization-1",
      scope: "member",
      status: "completed",
      tasks: [
        {
          failureCode: "unexpected_failure",
          finishedAt: null,
          id: "task-1",
          position: 2,
          startedAt: CREATED_AT,
          status: "queued",
          subjectDisplayName: "Alex",
          subjectUserId: "user-alex",
        },
      ],
      totalCount: 1,
      updatedAt: CREATED_AT,
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected an invalid member research projection.");
    }
    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Task timestamps and failureCode must match the task status.",
        "Task positions must be ordered and contiguous.",
        "Batch status must match its task lifecycle.",
        "updatedAt must not be before createdAt.",
      ])
    );
  });

  it("accepts only evidence-backed reports with two distinct attributable work items", () => {
    const report = {
      collaborationGuidance: [ACTIVITY_EVIDENCE],
      coverage: COMPLETE_COVERAGE,
      currentFocus: [ACTIVITY_EVIDENCE],
      observedActivity: [ACTIVITY_EVIDENCE, GITHUB_EVIDENCE],
      recentContributions: [GITHUB_EVIDENCE],
      result: "evidence_backed",
      suggestedAboutAdditions: [],
    };

    expect(
      centerAgentMemberResearchReportSchema.safeParse(report).success
    ).toBe(true);
    expect(
      centerAgentMemberResearchReportSchema.safeParse({
        ...report,
        coverage: COMPLETE_COVERAGE.slice(0, 5),
      }).success
    ).toBe(true);
    expect(
      centerAgentMemberResearchReportSchema.safeParse({
        ...report,
        observedActivity: [
          ACTIVITY_EVIDENCE,
          { ...ACTIVITY_EVIDENCE, text: "The same item restated." },
        ],
      }).success
    ).toBe(false);
    expect(
      centerAgentMemberResearchReportSchema.safeParse({
        ...report,
        currentFocus: [
          { ...ACTIVITY_EVIDENCE, source: "organization_directory" },
        ],
      }).success
    ).toBe(false);
    expect(
      centerAgentMemberResearchReportSchema.safeParse({
        collaborationGuidance: [],
        coverage: COMPLETE_COVERAGE,
        currentFocus: [SLACK_EVIDENCE],
        observedActivity: [
          SLACK_EVIDENCE,
          { ...CONNECTED_APP_EVIDENCE, sourceUrl: "http://example.test/file" },
        ],
        recentContributions: [CONNECTED_APP_EVIDENCE],
        result: "evidence_backed",
        suggestedAboutAdditions: [],
      }).success
    ).toBe(false);
  });

  it("accepts attributable Slack messages and read-only connected App artifacts as work evidence", () => {
    expect(
      centerAgentMemberResearchReportSchema.safeParse({
        collaborationGuidance: [],
        coverage: COMPLETE_COVERAGE,
        currentFocus: [SLACK_EVIDENCE],
        observedActivity: [SLACK_EVIDENCE, CONNECTED_APP_EVIDENCE],
        recentContributions: [CONNECTED_APP_EVIDENCE],
        result: "evidence_backed",
        suggestedAboutAdditions: [],
      }).success
    ).toBe(true);
    expect(
      centerAgentMemberResearchReportSchema.safeParse({
        collaborationGuidance: [],
        coverage: COMPLETE_COVERAGE,
        currentFocus: [{ ...SLACK_EVIDENCE, sourceName: undefined }],
        observedActivity: [SLACK_EVIDENCE, CONNECTED_APP_EVIDENCE],
        recentContributions: [CONNECTED_APP_EVIDENCE],
        result: "evidence_backed",
        suggestedAboutAdditions: [],
      }).success
    ).toBe(false);
  });

  it("requires complete source coverage for insufficient-evidence reports", () => {
    const report = {
      coverage: COMPLETE_COVERAGE,
      nextSteps: ["Connect an attributable work source."],
      result: "insufficient_evidence",
    };

    expect(
      centerAgentMemberResearchReportSchema.safeParse(report).success
    ).toBe(true);
    expect(
      centerAgentMemberResearchReportSchema.safeParse({
        ...report,
        coverage: COMPLETE_COVERAGE.slice(1),
      }).success
    ).toBe(false);
  });
});
