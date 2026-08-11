import stringWidth from "string-width";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";

const REPLY_PREVIEW_FENCED_BLOCK_RE = /```[\s\S]*?```/gu;
const REPLY_PREVIEW_LEADING_MENTION_PATTERN =
  /^@[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:[.,!?;:，。！？；：]+)?(?:\s+|$)/u;

export function buildHumanReplyCuePreview(
  value: string,
  maxVisibleWidth: number
): string {
  const sanitizedPreview = sanitizeReplyCueText(value);
  if (!sanitizedPreview) {
    return "";
  }

  const previewBody =
    stripLeadingReplyCueMention(sanitizedPreview) || sanitizedPreview;
  return truncateReplyCuePreview(previewBody, maxVisibleWidth);
}

function sanitizeReplyCueText(value: string): string {
  return sanitizeTerminalDisplayText(
    value.replace(REPLY_PREVIEW_FENCED_BLOCK_RE, " "),
    "single-line"
  )
    .replace(/\s+/gu, " ")
    .trim();
}

function stripLeadingReplyCueMention(value: string): string {
  const match = REPLY_PREVIEW_LEADING_MENTION_PATTERN.exec(value);
  if (!match) {
    return value;
  }

  return value.slice(match[0].length).trimStart();
}

function truncateReplyCuePreview(
  value: string,
  maxVisibleWidth: number
): string {
  if (stringWidth(value) <= maxVisibleWidth) {
    return value;
  }
  if (maxVisibleWidth <= 1) {
    return "…";
  }

  const ellipsis = "…";
  const targetWidth = maxVisibleWidth - stringWidth(ellipsis);
  let result = "";
  let currentWidth = 0;

  for (const char of value) {
    const nextWidth = currentWidth + stringWidth(char);
    if (nextWidth > targetWidth) {
      break;
    }
    result += char;
    currentWidth = nextWidth;
  }

  return `${result.trimEnd()}${ellipsis}`;
}
