import type { SignalEnvelope } from "@openmeld/protocol";

// A thread preview shows one line per reply: the first line that still has
// content after trimming and light Markdown cleanup, skipping rules and fenced
// code blocks. Space read models use the same rule to bound preview text, so
// the line a client shows never depends on text the server left out.
const THREAD_REPLY_PREVIEW_LEADING_MARKDOWN = /^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/;
const THREAD_REPLY_PREVIEW_BOLD = /\*\*([^*]+)\*\*/g;
const THREAD_REPLY_PREVIEW_UNDERSCORE_BOLD = /__([^_]+)__/g;
const THREAD_REPLY_PREVIEW_RULE = /^[-*_]{3,}$/;
// CommonMark fences: a backtick opener's info string cannot contain a
// backtick, and a closer is a run of the opener's character at least as long
// as the opener, with nothing after it.
const THREAD_REPLY_PREVIEW_FENCE_OPENER = /^(?:(`{3,})[^`]*|(~{3,}).*)$/;
const THREAD_REPLY_PREVIEW_FENCE_CLOSER = /^(`{3,}|~{3,})\s*$/;

// Reply text at or under this length is carried whole.
export const THREAD_REPLY_PREVIEW_TEXT_MAX_CHARS = 1000;

type ThreadReplyPreviewLine = {
  // The cleaned line a preview shows.
  readonly line: string;
  // Index in the source text where the line ends, before its newline.
  readonly end: number;
};

function cleanThreadReplyPreviewLine(line: string): string {
  return line
    .trim()
    .replace(THREAD_REPLY_PREVIEW_LEADING_MARKDOWN, "")
    .replace(THREAD_REPLY_PREVIEW_BOLD, "$1")
    .replace(THREAD_REPLY_PREVIEW_UNDERSCORE_BOLD, "$1");
}

function closesThreadReplyPreviewFence(line: string, opener: string): boolean {
  const closer = THREAD_REPLY_PREVIEW_FENCE_CLOSER.exec(line)?.[1];
  return (
    closer !== undefined &&
    closer[0] === opener[0] &&
    closer.length >= opener.length
  );
}

// Yields the lines a preview may show, in order. Rules, fence markers, and the
// lines inside a fence are skipped; a fence that never closes runs to the end
// of the text. Both readers below walk this one sequence, so the bounded text
// and the shown line cannot disagree.
function* threadReplyPreviewLines(
  text: string
): Generator<ThreadReplyPreviewLine> {
  let fence: string | undefined;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const end = newline === -1 ? text.length : newline;
    const line = cleanThreadReplyPreviewLine(text.slice(lineStart, end));
    if (fence !== undefined) {
      if (closesThreadReplyPreviewFence(line, fence)) {
        fence = undefined;
      }
    } else {
      const opener = THREAD_REPLY_PREVIEW_FENCE_OPENER.exec(line);
      if (opener) {
        fence = opener[1] ?? opener[2];
      } else if (line.length > 0 && !THREAD_REPLY_PREVIEW_RULE.test(line)) {
        yield { line, end };
      }
    }
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }
}

export function readThreadReplyPreviewLine(text: string): string {
  for (const { line } of threadReplyPreviewLines(text)) {
    return line;
  }
  return text;
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
  for (const { end } of threadReplyPreviewLines(text)) {
    return text.slice(0, end);
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
