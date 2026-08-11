import process from "node:process";
import pc from "picocolors";
import stringWidth from "string-width";

export type UnifiedCardFrame = {
  top: string;
  empty: string;
  rows: string[];
  bottom: string;
  contentWidth: number;
};

export function buildUnifiedCardFrame(input: {
  title: string;
  rowTextList: string[];
  minContentWidth?: number;
  horizontalPadding?: number;
}): UnifiedCardFrame {
  const horizontalPadding = Math.max(0, input.horizontalPadding ?? 2);
  const minContentWidth = input.minContentWidth ?? 56;
  const maxContentWidth = resolveMaxContentWidth(horizontalPadding);
  const naturalContentWidth = Math.max(
    0,
    ...input.rowTextList.map((row) => visibleWidth(row))
  );
  const initialContentWidth = resolveInitialContentWidth({
    maxContentWidth,
    minContentWidth,
    naturalContentWidth,
  });
  const wrappedRows = input.rowTextList.flatMap((row) =>
    wrapCardRowText(row, initialContentWidth)
  );
  const contentWidth = Math.max(
    wrappedRows.length > 0 ? 0 : initialContentWidth,
    ...wrappedRows.map((row) => visibleWidth(row))
  );
  const titleWidth = visibleWidth(input.title);
  const frameInnerWidth = Math.max(
    contentWidth + horizontalPadding * 2,
    titleWidth + 1
  );
  const rowContentWidth = frameInnerWidth - horizontalPadding * 2;
  const topBorderWidth = Math.max(1, frameInnerWidth - titleWidth);
  const top = `${input.title} ${pc.dim(
    "─".repeat(topBorderWidth)
  )}${pc.dim("┐")}`;
  const empty = `${pc.dim("│")}${" ".repeat(horizontalPadding)}${" ".repeat(rowContentWidth)}${" ".repeat(horizontalPadding)}${pc.dim("│")}`;
  const rows = wrappedRows.map(
    (row) =>
      `${pc.dim("│")}${" ".repeat(horizontalPadding)}${padEndVisibleWidth(
        row,
        rowContentWidth
      )}${" ".repeat(horizontalPadding)}${pc.dim("│")}`
  );
  const bottom = `${pc.dim("└")}${pc.dim("─".repeat(frameInnerWidth))}${pc.dim("┘")}`;

  return {
    top,
    empty,
    rows,
    bottom,
    contentWidth: rowContentWidth,
  };
}

function visibleWidth(value: string): number {
  return stringWidth(value);
}

function padEndVisibleWidth(value: string, targetWidth: number): string {
  const valueWidth = visibleWidth(value);
  if (valueWidth >= targetWidth) {
    return value;
  }
  return `${value}${" ".repeat(targetWidth - valueWidth)}`;
}

function resolveInitialContentWidth(input: {
  maxContentWidth: number | null;
  minContentWidth: number;
  naturalContentWidth: number;
}): number {
  if (input.maxContentWidth === null) {
    return Math.max(input.minContentWidth, input.naturalContentWidth);
  }

  if (input.maxContentWidth >= input.minContentWidth) {
    return Math.max(
      input.minContentWidth,
      Math.min(input.naturalContentWidth, input.maxContentWidth)
    );
  }

  return input.maxContentWidth;
}

function resolveMaxContentWidth(horizontalPadding: number): number | null {
  if (!process.stdout.isTTY || typeof process.stdout.columns !== "number") {
    return null;
  }
  const availableWidth = process.stdout.columns - horizontalPadding * 2 - 2;
  return Math.max(16, availableWidth);
}

function wrapCardRowText(value: string, width: number): string[] {
  if (width <= 0 || visibleWidth(value) <= width) {
    return [value];
  }

  const words = value.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length === 0) {
      pushWrappedWord(word, width, lines, (nextLine) => {
        currentLine = nextLine;
      });
      continue;
    }

    const candidate = `${currentLine} ${word}`;
    if (visibleWidth(candidate) <= width) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = "";
    pushWrappedWord(word, width, lines, (nextLine) => {
      currentLine = nextLine;
    });
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function pushWrappedWord(
  word: string,
  width: number,
  lines: string[],
  setCurrentLine: (value: string) => void
): void {
  if (visibleWidth(word) <= width) {
    setCurrentLine(word);
    return;
  }

  let segment = "";
  for (const character of word) {
    const candidate = `${segment}${character}`;
    if (segment.length > 0 && visibleWidth(candidate) > width) {
      lines.push(segment);
      segment = character;
      continue;
    }
    segment = candidate;
  }
  setCurrentLine(segment);
}
