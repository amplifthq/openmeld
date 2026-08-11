import type { SpaceBoardResponse } from "@openmeld/schemas/types";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

export function formatSpaceBoardOutput(
  board: SpaceBoardResponse,
  options: { json: boolean }
): string {
  if (options.json) {
    return JSON.stringify(board);
  }

  const workingLines = board.workingNow.map(
    (execution) =>
      `- ${profileLabel(execution)} (started ${execution.startedAt})`
  );
  const outcomeLines = board.recentOutcomes.map(
    (outcome) => `- ${outcome.at} ${profileLabel(outcome)}: ${outcome.outcome}`
  );

  return [
    `# Space: ${sanitizeTerminalDisplayText(board.space.name)}`,
    `Purpose: ${sanitizeTerminalDisplayText(board.space.purpose) || "-"}`,
    "## Guide (steward-maintained)",
    sanitizeTerminalDisplayText(board.space.guide, "multi-line") ||
      "No guide set.",
    "## Members",
    `${formatCount(board.members.humanCount, "person", "people")}, ${formatCount(
      board.members.agentCount,
      "agent",
      "agents"
    )}${board.members.centerAgentPresent ? ", Center Agent present" : ""}`,
    "## Working now",
    ...(workingLines.length > 0 ? workingLines : ["(none)"]),
    "## Recent outcomes (last 10)",
    ...(outcomeLines.length > 0 ? outcomeLines : ["(none)"]),
  ].join("\n");
}

function profileLabel(input: {
  profileId: string;
  profileName: string | null;
}): string {
  return sanitizeTerminalDisplayText(input.profileName) || input.profileId;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
