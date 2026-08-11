import stringWidth from "string-width";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

const PREVIEW_MAX_VISIBLE_CHARS = 240;
const PREVIEW_MIN_VISIBLE_CHARS = 24;
const PREVIEW_ELLIPSIS = "...";
const STATUS_SYSTEM_PREFIX = "* 📣 system · ";
const STATUS_PREVIEW_PREFIX = "Sending: ";

export type PendingOutboundDispatchRowDraft = {
  statusText: string;
  targetLabel: string;
  targetMentionLabel: string | null;
};

export function formatPendingOutboundStatusText(input: {
  pendingText: string;
  terminalColumns: number | null;
}): string {
  const normalizedText = normalizePendingOutboundText(input.pendingText);
  if (!normalizedText) {
    return "Sending...";
  }

  const maxStatusWidth = resolvePendingOutboundPreviewWidth({
    terminalColumns: input.terminalColumns,
  });
  const statusHead = truncatePreviewHead(normalizedText, maxStatusWidth);
  return `${STATUS_PREVIEW_PREFIX}${statusHead}`;
}

export function buildPendingOutboundDispatchRowDrafts(input: {
  pendingText: string;
  terminalColumns: number | null;
}): PendingOutboundDispatchRowDraft[] {
  return [
    {
      statusText: formatPendingOutboundStatusText(input),
      targetLabel: "",
      targetMentionLabel: null,
    },
  ];
}

function normalizePendingOutboundText(value: string): string {
  return sanitizeTerminalDisplayText(value, "single-line")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePendingOutboundPreviewWidth(input: {
  terminalColumns: number | null;
}): number {
  const prefixWidth = stringWidth(
    `${STATUS_SYSTEM_PREFIX}${STATUS_PREVIEW_PREFIX}`
  );
  if (input.terminalColumns === null) {
    return PREVIEW_MAX_VISIBLE_CHARS;
  }
  const availableWidth = input.terminalColumns - prefixWidth;
  return Math.max(
    PREVIEW_MIN_VISIBLE_CHARS,
    Math.min(PREVIEW_MAX_VISIBLE_CHARS, availableWidth)
  );
}

function truncatePreviewHead(value: string, maxWidth: number): string {
  if (stringWidth(value) <= maxWidth) {
    return value;
  }
  const truncatedWidth = Math.max(0, maxWidth - stringWidth(PREVIEW_ELLIPSIS));
  let head = "";
  for (const char of value) {
    if (stringWidth(head) + stringWidth(char) > truncatedWidth) {
      break;
    }
    head += char;
  }
  return `${head}${PREVIEW_ELLIPSIS}`;
}
