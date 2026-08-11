import process from "node:process";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";

const OSC_8_PREFIX = "\u001B]8;;";
const OSC_8_SUFFIX = "\u001B]8;;\u0007";
const OSC_8_SEPARATOR = "\u0007";

export function formatTerminalHyperlink(input: {
  enabled?: boolean;
  label: string;
  url: string;
}): string {
  const label = sanitizeTerminalDisplayText(input.label, "single-line").trim();
  const url = normalizeTerminalHyperlinkUrl(input.url);
  if (!label) {
    return url ?? "";
  }
  if (!(url && isTerminalHyperlinkEnabled(input.enabled))) {
    return label;
  }
  return `${OSC_8_PREFIX}${url}${OSC_8_SEPARATOR}${label}${OSC_8_SUFFIX}`;
}

function isTerminalHyperlinkEnabled(enabled: boolean | undefined): boolean {
  return enabled ?? process.stdout.isTTY === true;
}

function normalizeTerminalHyperlinkUrl(value: string): string | null {
  const sanitized = sanitizeTerminalDisplayText(value, "single-line").trim();
  if (!sanitized) {
    return null;
  }
  try {
    const url = new URL(sanitized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
