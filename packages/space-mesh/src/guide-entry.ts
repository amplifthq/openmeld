export function resolveGuideEntry(
  input:
    | {
        source: "skill";
        label?: string;
      }
    | {
        source: "cli_prompt";
        command: string;
      }
): string {
  if (input.source === "skill") {
    const label = normalizeOptionalText(input.label);
    return label
      ? `Use ${label} only if you need exact OpenMeld command details.`
      : "Use the OpenMeld guide only if you need exact command details.";
  }

  normalizeRequiredText(input.command, "command");
  return "Use the OpenMeld guide only if you need exact command details.";
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }
  throw new Error(`${label} is required`);
}
