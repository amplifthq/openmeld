import { centerAgentMemberResearchReportSchema } from "@openmeld/schemas";
import type {
  CenterAgentMemberResearchCoverage,
  CenterAgentMemberResearchEvidenceItem,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { renderCenterAgentMemberResearchDraft } from "../src/center-agent-member-research/member-research-report";

const COVERAGE: CenterAgentMemberResearchCoverage[] = [
  {
    evidence: "Exact subject identity confirmed.",
    source: "organization_directory",
    status: "checked",
    timeRange: "Current",
  },
  {
    evidence: "Approved content was read.",
    source: "approved_profile_report",
    status: "checked",
    timeRange: "Current",
  },
  {
    evidence: "Two attributable activity records were found.",
    source: "agent_activity",
    status: "checked",
    timeRange: "2026-04-17 to 2026-07-16",
  },
  {
    evidence: "One attributable pull request was found.",
    source: "github",
    status: "checked",
    timeRange: "2026-04-17 to 2026-07-16",
  },
  {
    evidence: "Exact email identity match confirmed.",
    source: "slack_workspace_directory",
    status: "checked",
    timeRange: "Current",
  },
];
const AGENT_ACTIVITY_EVIDENCE: CenterAgentMemberResearchEvidenceItem = {
  date: "2026-07-10",
  source: "agent_activity",
  sourceId: "activity_1",
  text: "Validated the release path.",
};
const GITHUB_EVIDENCE: CenterAgentMemberResearchEvidenceItem = {
  date: "2026-07-12",
  source: "github",
  sourceId: "acme/repo#42",
  sourceUrl: "https://github.com/acme/repo/pull/42",
  text: "Merged the release guard.",
};

describe("member research report quality", () => {
  it("renders a server-validated evidence report with traceable citations", () => {
    const report = centerAgentMemberResearchReportSchema.parse({
      collaborationGuidance: [AGENT_ACTIVITY_EVIDENCE],
      coverage: COVERAGE,
      currentFocus: [AGENT_ACTIVITY_EVIDENCE],
      observedActivity: [AGENT_ACTIVITY_EVIDENCE, GITHUB_EVIDENCE],
      recentContributions: [GITHUB_EVIDENCE],
      result: "evidence_backed",
      suggestedAboutAdditions: [GITHUB_EVIDENCE],
    });

    const draft = renderCenterAgentMemberResearchDraft({
      approvedContent: null,
      draftedAtMs: Date.UTC(2026, 6, 16, 12),
      report,
      subjectDisplayName: "Morgan Lee",
    });

    expect(draft).toContain("## Working profile");
    expect(draft).toContain(
      "[GitHub: acme/repo#42](https://github.com/acme/repo/pull/42)"
    );
    expect(draft).toContain("Agent Activity `activity_1`");
    expect(draft).toContain("## Research coverage");
  });

  it("renders an honest insufficient-evidence result", () => {
    const report = centerAgentMemberResearchReportSchema.parse({
      coverage: COVERAGE.map((entry) => ({
        ...entry,
        status: "unavailable" as const,
      })),
      nextSteps: [
        "Connect an attributable work source before researching again.",
      ],
      result: "insufficient_evidence",
    });

    const draft = renderCenterAgentMemberResearchDraft({
      approvedContent: null,
      draftedAtMs: Date.UTC(2026, 6, 16, 12),
      report,
      subjectDisplayName: "Morgan Lee",
    });

    expect(draft).toContain("**Insufficient evidence**");
    expect(draft).toContain(
      "Not enough organization-connected evidence was available to write a useful work profile for Morgan Lee."
    );
    expect(draft).not.toContain("## Working profile");
    expect(draft).toContain("## Next step");
  });

  it("preserves the approved About section verbatim", () => {
    const report = centerAgentMemberResearchReportSchema.parse({
      coverage: COVERAGE,
      nextSteps: ["Collect two attributable dated work items."],
      result: "insufficient_evidence",
    });

    const draft = renderCenterAgentMemberResearchDraft({
      approvedContent: `## About
Keep this exact sentence.

- Keep this approved detail too.

## Observed activity
- Old observation.`,
      draftedAtMs: Date.UTC(2026, 6, 16, 12),
      report,
      subjectDisplayName: "Morgan Lee",
    });

    expect(draft).toContain(`## About
Keep this exact sentence.

- Keep this approved detail too.

## Research status`);
    expect(draft).not.toContain("Old observation.");
  });

  it("rejects identity metadata as work evidence", () => {
    const result = centerAgentMemberResearchReportSchema.safeParse({
      collaborationGuidance: [],
      coverage: COVERAGE,
      currentFocus: [
        {
          ...AGENT_ACTIVITY_EVIDENCE,
          source: "organization_directory",
        },
      ],
      observedActivity: [AGENT_ACTIVITY_EVIDENCE, GITHUB_EVIDENCE],
      recentContributions: [GITHUB_EVIDENCE],
      result: "evidence_backed",
      suggestedAboutAdditions: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects repeated citations masquerading as distinct evidence", () => {
    const result = centerAgentMemberResearchReportSchema.safeParse({
      collaborationGuidance: [],
      coverage: COVERAGE,
      currentFocus: [AGENT_ACTIVITY_EVIDENCE],
      observedActivity: [
        AGENT_ACTIVITY_EVIDENCE,
        {
          ...AGENT_ACTIVITY_EVIDENCE,
          text: "Restated the same activity.",
        },
      ],
      recentContributions: [AGENT_ACTIVITY_EVIDENCE],
      result: "evidence_backed",
      suggestedAboutAdditions: [],
    });

    expect(result.success).toBe(false);
  });
});
