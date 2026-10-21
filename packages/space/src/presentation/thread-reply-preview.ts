import type { SignalEnvelope } from "@openmeld/protocol";

// A thread preview shows one line per reply: the first line that still has
// content after trimming and light Markdown cleanup, skipping rules and fenced
// code blocks. A reply that is only code shows its first code line. Space
// read models use the same rule to bound preview text, so
// the line a client shows never depends on text the server left out.
const THREAD_REPLY_PREVIEW_LEADING_MARKDOWN = /^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/;
const THREAD_REPLY_PREVIEW_BOLD = /\*\*([^*]+)\*\*/g;
const THREAD_REPLY_PREVIEW_UNDERSCORE_BOLD = /__([^_]+)__/g;
const THREAD_REPLY_PREVIEW_DECORATION = /^(?:[-*_]{3,}|`{3,}[^`]*|~{3,}.*)$/;
// CommonMark fences, read from the raw line: up to three spaces of indent, a
// backtick opener's info string cannot contain a backtick, and a closer is a
// run of the opener's character at least as long as the opener, with nothing
// after it. Only top-level fences are tracked; a fence marker inside a quote
// or list item is skipped as a single decoration line.
const THREAD_REPLY_PREVIEW_FENCE_OPENER = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/;
const THREAD_REPLY_PREVIEW_FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

// Reply text at or under this length is carried whole.
export const THREAD_REPLY_PREVIEW_TEXT_MAX_CHARS = 1000;

type ThreadReplyPreviewLine = {
  // The cleaned line a preview shows.
  readonly line: string;
  // Indexes in the source text where the line starts and where it ends,
  // before its newline.
  readonly start: number;
  readonly end: number;
  // True for a line inside a fenced code block.
  readonly fenced: boolean;
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

// Yields the lines a preview may show, in order. Rules and fence markers are
// skipped; lines inside a top-level fence are marked fenced, and a fence that
// never closes runs to the end of the text. Both readers below pick from this
// one sequence, so the bounded text and the shown line cannot disagree.
function* threadReplyPreviewLines(
  text: string
): Generator<ThreadReplyPreviewLine> {
  const state: { fence?: string } = {};
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const end = newline === -1 ? text.length : newline;
    const line = readThreadReplyPreviewSourceLine(
      trimThreadReplyPreviewLineEnd(text, lineStart, end),
      state
    );
    if (line) {
      yield { ...line, start: lineStart, end };
    }
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }
}

// CommonMark allows only spaces and tabs after a closing fence, so only those
// (and a CR before the newline) are trimmed. A backward scan stays linear on
// long runs of spaces.
function trimThreadReplyPreviewLineEnd(
  text: string,
  start: number,
  end: number
): string {
  let trimmedEnd = end;
  while (trimmedEnd > start) {
    const char = text[trimmedEnd - 1];
    if (char !== " " && char !== "\t" && char !== "\r") {
      break;
    }
    trimmedEnd -= 1;
  }
  return text.slice(start, trimmedEnd);
}

// Advances the fence state past one raw line and returns the line a preview
// may show from it, if any.
function readThreadReplyPreviewSourceLine(
  raw: string,
  state: { fence?: string }
): { line: string; fenced: boolean } | undefined {
  if (state.fence !== undefined) {
    if (closesThreadReplyPreviewFence(raw, state.fence)) {
      state.fence = undefined;
      return;
    }
    const line = raw.trim();
    return line.length > 0 ? { line, fenced: true } : undefined;
  }
  const opener = THREAD_REPLY_PREVIEW_FENCE_OPENER.exec(raw);
  if (opener) {
    state.fence = opener[1] ?? opener[2];
    return;
  }
  const line = cleanThreadReplyPreviewLine(raw);
  return line.length > 0 && !THREAD_REPLY_PREVIEW_DECORATION.test(line)
    ? { line, fenced: false }
    : undefined;
}

// The first line outside a fence, else the first code line of a reply that
// is only code.
function selectThreadReplyPreviewLine(
  text: string
): ThreadReplyPreviewLine | undefined {
  let firstFenced: ThreadReplyPreviewLine | undefined;
  for (const line of threadReplyPreviewLines(text)) {
    if (!line.fenced) {
      return line;
    }
    firstFenced ??= line;
  }
  return firstFenced;
}

export function readThreadReplyPreviewLine(text: string): string {
  return selectThreadReplyPreviewLine(text)?.line ?? text;
}

// Returns text that readThreadReplyPreviewLine reads as the same line it
// selects from the full text. A line outside a fence is carried alone and
// whole, so its links and formatting render exactly as in the full text and a
// code block before it is not carried; reading it alone runs the same rules.
// A code line is carried with the prefix that opens its fence, because a code
// line alone could read as Markdown. Text without a selectable line is
// returned whole.
export function boundThreadReplyPreviewText(
  text: string,
  maxChars: number = THREAD_REPLY_PREVIEW_TEXT_MAX_CHARS
): string {
  if (text.length <= maxChars) {
    return text;
  }
  const selected = selectThreadReplyPreviewLine(text);
  if (!selected) {
    return text;
  }
  return text.slice(selected.fenced ? 0 : selected.start, selected.end);
}

// Thread previews render one line per reply, so a long text reply carries
// only what boundThreadReplyPreviewText keeps for the line it shows. Opening
// the Thread reads full signals.
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
