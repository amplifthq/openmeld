import type { SignalEnvelope } from "@openmeld/protocol";

// A thread preview shows one line per reply: the first line that still has
// content after trimming and light Markdown cleanup, skipping rules and code
// fences. Space read models use the same rule to bound preview text, so the
// line a client shows never depends on text the server left out.
const THREAD_REPLY_PREVIEW_LINES = /\r?\n/;
const THREAD_REPLY_PREVIEW_LEADING_MARKDOWN = /^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/;
const THREAD_REPLY_PREVIEW_BOLD = /\*\*([^*]+)\*\*/g;
const THREAD_REPLY_PREVIEW_UNDERSCORE_BOLD = /__([^_]+)__/g;
const THREAD_REPLY_PREVIEW_DECORATION = /^(?:[-*_]{3,}|`{3,}.*|~{3,}.*)$/;

// Reply text at or under this length is carried whole.
export const THREAD_REPLY_PREVIEW_TEXT_MAX_CHARS = 1000;

function cleanThreadReplyPreviewLine(line: string): string {
  return line
    .trim()
    .replace(THREAD_REPLY_PREVIEW_LEADING_MARKDOWN, "")
    .replace(THREAD_REPLY_PREVIEW_BOLD, "$1")
    .replace(THREAD_REPLY_PREVIEW_UNDERSCORE_BOLD, "$1");
}

function isThreadReplyPreviewLine(cleanedLine: string): boolean {
  return (
    cleanedLine.length > 0 && !THREAD_REPLY_PREVIEW_DECORATION.test(cleanedLine)
  );
}

export function readThreadReplyPreviewLine(text: string): string {
  return (
    text
      .split(THREAD_REPLY_PREVIEW_LINES)
      .map(cleanThreadReplyPreviewLine)
      .find(isThreadReplyPreviewLine) ?? text
  );
}

// Returns the prefix of text that ends with the line
// readThreadReplyPreviewLine selects. That line is kept whole, so its links
// and formatting render exactly as in the full text; only the lines after it
// are left out. Text without a selectable line is returned whole.
export function boundThreadReplyPreviewText(
  text: string,
  maxChars: number = THREAD_REPLY_PREVIEW_TEXT_MAX_CHARS
): string {
  if (text.length <= maxChars) {
    return text;
  }
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    if (
      isThreadReplyPreviewLine(
        cleanThreadReplyPreviewLine(text.slice(lineStart, lineEnd))
      )
    ) {
      return text.slice(0, lineEnd);
    }
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }
  return text;
}

// Thread previews render one line per reply, so a text reply carries only the
// prefix through the line it shows. Opening the Thread reads full
// signals.
export function boundThreadPreviewSignal(
  signal: SignalEnvelope
): SignalEnvelope {
  if (signal.type !== "signal.text") {
    return signal;
  }
  const text = boundThreadReplyPreviewText(signal.data.text);
  return text === signal.data.text
    ? signal
    : { ...signal, data: { ...signal.data, text } };
}
