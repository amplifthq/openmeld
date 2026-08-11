import { isSpaceQuitCommand } from "./quit-command";

export type ComposeDraftState = {
  lines: string[];
};

export type ComposeLineAction =
  | { kind: "quit" }
  | { kind: "continue"; nextDraft: ComposeDraftState }
  | { kind: "send"; nextDraft: ComposeDraftState; text: string };

export function consumeComposeInputLine(input: {
  line: string;
  draft: ComposeDraftState;
}): ComposeLineAction {
  const rawLine = String(input.line ?? "");
  if (isSpaceQuitCommand(rawLine)) {
    return { kind: "quit" };
  }

  const continuation = parseContinuationLine(rawLine);
  if (continuation.continues) {
    return {
      kind: "continue",
      nextDraft: {
        lines: [...input.draft.lines, continuation.lineText],
      },
    };
  }

  const nextLines =
    input.draft.lines.length > 0
      ? [...input.draft.lines, continuation.lineText]
      : [continuation.lineText];

  return {
    kind: "send",
    nextDraft: emptyComposeDraft(),
    text: nextLines.join("\n"),
  };
}

export function emptyComposeDraft(): ComposeDraftState {
  return { lines: [] };
}

type ContinuationParseResult = {
  continues: boolean;
  lineText: string;
};

function parseContinuationLine(line: string): ContinuationParseResult {
  const trimmedEnd = line.replaceAll(/\s+$/g, "");
  const trailingBackslashes = countTrailingBackslashes(trimmedEnd);
  if (trailingBackslashes !== 1) {
    return { continues: false, lineText: line };
  }
  return {
    continues: true,
    lineText: trimmedEnd.slice(0, -1),
  };
}

function countTrailingBackslashes(value: string): number {
  let count = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== "\\") {
      break;
    }
    count += 1;
  }
  return count;
}
