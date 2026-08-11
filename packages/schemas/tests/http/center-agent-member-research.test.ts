import { describe, expect, it } from "vitest";
import {
  centerAgentMemberResearchBatchSchema,
  centerAgentMemberResearchReportSchema,
} from "../../src/schemas/http/center-agent-member-research";

const CREATED_AT = "2026-07-16T00:00:00.000Z";
const UPDATED_AT = "2026-07-16T00:01:00.000Z";
const COMPLETE_COVERAGE = [
  "organization_directory",
  "approved_profile_report",
  "agent_activity",
  "github",
  "slack_workspace_directory",
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

describe("Center Agent member research contracts", () => {
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
