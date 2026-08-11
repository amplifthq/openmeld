import pc from "picocolors";
import wrapAnsi from "wrap-ansi";
import type { SpaceSummarySegmentViewState } from "../../../view/space-session-view-state";

export function renderSpaceSummaryLines(input: {
  segments: readonly SpaceSummarySegmentViewState[];
  tone?: "default" | "muted";
  width: number;
}): string[] {
  const text = joinSpaceSummarySegments(input.segments);
  if (!text) {
    return [];
  }
  const styledText =
    input.tone === "muted" ? pc.dim(text) : renderDefaultSummaryText(text);
  return wrapAnsi(styledText, Math.max(1, input.width), {
    hard: true,
    trim: false,
    wordWrap: true,
  }).split("\n");
}

function joinSpaceSummarySegments(
  segments: readonly SpaceSummarySegmentViewState[]
): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter((segment) => segment.length > 0)
    .join(pc.dim(" · "));
}

function renderDefaultSummaryText(text: string): string {
  return text;
}
