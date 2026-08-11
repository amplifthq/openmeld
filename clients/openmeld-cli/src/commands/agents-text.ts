import pc from "picocolors";
import { formatOpenMeldCliTextBlock } from "../runtime/cli-entry-command";

export const formatAgentsCopy = (text: string): string =>
  formatOpenMeldCliTextBlock(text);

export function formatAgentMention(agentId: string): string {
  return pc.bold(pc.cyan(`@${agentId}`));
}

export function formatAgentsToneText(
  tone: "success" | "warning" | "info",
  value: string
): string {
  if (tone === "success") {
    return pc.green(value);
  }
  if (tone === "warning") {
    return pc.yellow(value);
  }
  return pc.cyan(value);
}

export function formatStatusTextForHuman(value: string): string {
  if (value.length === 0) {
    return value;
  }
  const normalized = value.replaceAll("_", " ");
  return normalized[0]?.toUpperCase() + normalized.slice(1);
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
