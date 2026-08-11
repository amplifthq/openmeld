import { formatOpenMeldCliLine } from "./cli-entry-command";

const SPACE_SUBCOMMAND_HINT_PATTERN = /^openmeld space ([a-z-]+)(.*)$/u;

export function normalizeHelpfulHintsForView(
  hints: string[],
  effectiveView: "auto" | "human" | "agent"
): string[] {
  return hints.map((hint) => normalizeHelpfulHintForView(hint, effectiveView));
}

function normalizeHelpfulHintForView(
  hint: string,
  effectiveView: "auto" | "human" | "agent"
): string {
  const normalizedHint =
    effectiveView === "agent" ? addExplicitProfileToSpaceHint(hint) : hint;
  return formatOpenMeldCliLine(normalizedHint);
}

function addExplicitProfileToSpaceHint(hint: string): string {
  if (!hint.startsWith("openmeld space ") || hint.includes("--profile ")) {
    return hint;
  }
  const match = SPACE_SUBCOMMAND_HINT_PATTERN.exec(hint);
  if (!match) {
    return hint;
  }
  const [, subcommand, rest] = match;
  return `openmeld space ${subcommand} --profile <profile-id>${rest}`;
}
