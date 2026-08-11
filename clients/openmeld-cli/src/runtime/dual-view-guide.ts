export type DualViewGuideInput = {
  summary: string;
  humanSteps: string[];
  agentRequiredArgs?: string[];
  agentOptionalArgs?: string[];
  agentCommands?: string[];
  notes?: string[];
};

function appendSection(
  lines: string[],
  title: string,
  items: string[] | undefined
): void {
  if (!items || items.length === 0) {
    return;
  }
  lines.push(title);
  for (const item of items) {
    lines.push(`  ${item}`);
  }
}

export function buildDualViewGuideLines(input: DualViewGuideInput): string[] {
  const lines = [input.summary, "", "[FOR HUMAN OPERATORS]"];

  for (const [index, step] of input.humanSteps.entries()) {
    lines.push(`${index + 1}) ${step}`);
  }

  lines.push("", "[FOR AGENTS]");
  appendSection(lines, "required arguments:", input.agentRequiredArgs);
  appendSection(lines, "optional arguments:", input.agentOptionalArgs);
  appendSection(lines, "commands:", input.agentCommands);
  appendSection(lines, "notes:", input.notes);

  return lines;
}

export function buildDualViewGuideMessage(input: DualViewGuideInput): string {
  return buildDualViewGuideLines(input).join("\n");
}
