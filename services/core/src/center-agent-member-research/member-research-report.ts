import type {
  CenterAgentMemberResearchCoverage,
  CenterAgentMemberResearchEvidenceItem,
  CenterAgentMemberResearchReport,
} from "@openmeld/schemas/types";

const COVERAGE_SOURCE_LABELS = {
  agent_activity: "Agent Activity",
  approved_profile_report: "Approved Profile Report",
  github: "GitHub",
  organization_directory: "Organization directory",
  slack_workspace_directory: "Slack workspace directory",
} as const satisfies Record<
  CenterAgentMemberResearchCoverage["source"],
  string
>;

const COVERAGE_STATUS_LABELS = {
  checked: "Checked",
  not_attributable: "Not attributable",
  unavailable: "Unavailable",
} as const satisfies Record<
  CenterAgentMemberResearchCoverage["status"],
  string
>;
const LINE_BREAK_PATTERN = /\r?\n/u;
const WHITESPACE_PATTERN = /\s+/gu;
const MARKDOWN_INLINE_CHARACTERS = [
  "\\",
  "`",
  "*",
  "_",
  "[",
  "]",
  "<",
  ">",
] as const;

export function renderCenterAgentMemberResearchDraft(input: {
  approvedContent: string | null;
  draftedAtMs: number;
  report: CenterAgentMemberResearchReport;
  subjectDisplayName: string;
}): string {
  const sections = [renderAbout(input.approvedContent, input.report)];
  if (input.report.result === "evidence_backed") {
    sections.push(renderEvidenceBackedReport(input.report, input.draftedAtMs));
  } else {
    sections.push(
      renderInsufficientEvidenceReport(input.report, input.subjectDisplayName)
    );
  }
  return sections.join("\n\n");
}

function renderAbout(
  approvedContent: string | null,
  report: CenterAgentMemberResearchReport
): string {
  const approvedAbout = readApprovedAboutBody(approvedContent);
  const lines = [
    "## About",
    approvedAbout ?? "No approved About information is available.",
  ];
  if (
    report.result === "evidence_backed" &&
    report.suggestedAboutAdditions.length > 0
  ) {
    lines.push(
      "",
      "### Suggested additions",
      ...report.suggestedAboutAdditions.map(renderEvidenceItem)
    );
  }
  return lines.join("\n");
}

function renderEvidenceBackedReport(
  report: Extract<
    CenterAgentMemberResearchReport,
    { result: "evidence_backed" }
  >,
  draftedAtMs: number
): string {
  const observedDate = new Date(draftedAtMs).toISOString().slice(0, 10);
  return [
    "## Working profile",
    "",
    "### Current focus",
    ...report.currentFocus.map(renderEvidenceItem),
    "",
    "### Recent contributions",
    ...report.recentContributions.map(renderEvidenceItem),
    "",
    "### Collaboration guidance",
    ...(report.collaborationGuidance.length > 0
      ? report.collaborationGuidance.map(renderEvidenceItem)
      : [
          "- No recurring collaboration pattern was supported by the available evidence.",
        ]),
    "",
    `## Observed activity (drafted by Center Agent, ${observedDate})`,
    ...report.observedActivity.map(renderEvidenceItem),
    "",
    renderCoverage(report.coverage),
  ].join("\n");
}

function renderInsufficientEvidenceReport(
  report: Extract<
    CenterAgentMemberResearchReport,
    { result: "insufficient_evidence" }
  >,
  subjectDisplayName: string
): string {
  return [
    "## Research status",
    "**Insufficient evidence**",
    "",
    `Not enough organization-connected evidence was available to write a useful work profile for ${escapeMarkdownInlineText(subjectDisplayName)}.`,
    "",
    renderCoverage(report.coverage),
    "",
    "## Next step",
    ...report.nextSteps.map((step) => `- ${escapeMarkdownInlineText(step)}`),
  ].join("\n");
}

function renderCoverage(coverage: CenterAgentMemberResearchCoverage[]): string {
  return [
    "## Research coverage",
    "| Source | Coverage | Time range | Evidence |",
    "| --- | --- | --- | --- |",
    ...coverage.map(
      (entry) =>
        `| ${COVERAGE_SOURCE_LABELS[entry.source]} | ${COVERAGE_STATUS_LABELS[entry.status]} | ${escapeTableCell(entry.timeRange)} | ${escapeTableCell(entry.evidence)} |`
    ),
  ].join("\n");
}

function renderEvidenceItem(
  evidence: CenterAgentMemberResearchEvidenceItem
): string {
  return `- ${evidence.date} — ${escapeMarkdownInlineText(evidence.text)} Source: ${renderEvidenceReference(evidence)}`;
}

function renderEvidenceReference(
  evidence: CenterAgentMemberResearchEvidenceItem
): string {
  if (evidence.source === "github") {
    if (!evidence.sourceUrl) {
      throw new TypeError("GitHub member research evidence requires a URL.");
    }
    return `[GitHub: ${escapeLinkLabel(evidence.sourceId)}](${escapeLinkDestination(evidence.sourceUrl)})`;
  }
  return `Agent Activity \`${escapeInlineCode(evidence.sourceId)}\``;
}

function readApprovedAboutBody(content: string | null): string | null {
  if (!content) {
    return null;
  }
  const lines = content.split(LINE_BREAK_PATTERN);
  const aboutIndex = lines.findIndex((line) => line.trim() === "## About");
  if (aboutIndex < 0) {
    return null;
  }
  const nextHeadingOffset = lines
    .slice(aboutIndex + 1)
    .findIndex((line) => line.trim().startsWith("## "));
  const endIndex =
    nextHeadingOffset < 0 ? lines.length : aboutIndex + 1 + nextHeadingOffset;
  const aboutBody = lines
    .slice(aboutIndex + 1, endIndex)
    .join("\n")
    .trim();
  return aboutBody || null;
}

function normalizeInlineText(value: string): string {
  return value.replace(WHITESPACE_PATTERN, " ").trim();
}

function escapeMarkdownInlineText(value: string): string {
  let escaped = normalizeInlineText(value);
  for (const character of MARKDOWN_INLINE_CHARACTERS) {
    escaped = escaped.replaceAll(character, `\\${character}`);
  }
  return escaped;
}

function escapeTableCell(value: string): string {
  return escapeMarkdownInlineText(value).replaceAll("|", "\\|");
}

function escapeLinkLabel(value: string): string {
  return normalizeInlineText(value).replaceAll("]", "\\]");
}

function escapeLinkDestination(value: string): string {
  return value
    .replaceAll("\\", "%5C")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
}

function escapeInlineCode(value: string): string {
  return normalizeInlineText(value).replaceAll("`", "'");
}
