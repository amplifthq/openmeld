import { stripVTControlCharacters } from "node:util";

export type TerminalDisplaySanitizeMode = "single-line" | "multi-line";

// Terminal display boundary only:
// - strip executable VT/ANSI control sequences
// - normalize CR/CRLF to LF before line-mode handling
// - remove remaining non-printing C0/C1 controls while preserving tab/newline
const TAB_CHARACTER_CODE = 0x09;
const LINE_FEED_CHARACTER_CODE = 0x0a;
const C0_CONTROL_MAX_CODE = 0x1f;
const DELETE_CHARACTER_CODE = 0x7f;
const C1_CONTROL_MAX_CODE = 0x9f;

export function sanitizeTerminalDisplayText(
  value: string | number | null | undefined,
  mode: TerminalDisplaySanitizeMode = "single-line"
): string {
  const normalizedValue = String(value ?? "");
  if (normalizedValue.length === 0) {
    return "";
  }

  const withNormalizedNewlines = normalizedValue.replace(/\r\n?/g, "\n");
  const withoutTerminalSequences = stripVTControlCharacters(
    withNormalizedNewlines
  );
  const modeAdjusted =
    mode === "single-line"
      ? withoutTerminalSequences.replaceAll("\n", " ")
      : withoutTerminalSequences;

  return removeRemainingTerminalControlCharacters(modeAdjusted);
}

function removeRemainingTerminalControlCharacters(value: string): string {
  let sanitized = "";
  for (const char of value) {
    if (isRemainingTerminalControlCharacter(char)) {
      continue;
    }
    sanitized += char;
  }
  return sanitized;
}

function isRemainingTerminalControlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }
  if (
    codePoint === TAB_CHARACTER_CODE ||
    codePoint === LINE_FEED_CHARACTER_CODE
  ) {
    return false;
  }
  if (codePoint <= C0_CONTROL_MAX_CODE) {
    return true;
  }
  return codePoint >= DELETE_CHARACTER_CODE && codePoint <= C1_CONTROL_MAX_CODE;
}
