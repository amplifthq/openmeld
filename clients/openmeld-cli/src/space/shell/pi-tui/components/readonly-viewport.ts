import { Key, matchesKey } from "@mariozechner/pi-tui";
import {
  clampNumber,
  resolveAnchoredVisibleWindow,
  resolveOffsetVisibleWindow,
} from "../../../../ui/visible-window";
import { formatPanelOverflowHintLine } from "../../../panel/space-panel-display";

export const READONLY_VIEWPORT_SCROLL_HINT_LINE =
  "↑↓ scroll · PgUp/PgDn page · Home/End jump";

export type ReadonlyViewportRow = {
  text: string;
};

export type ReadonlyViewportScrollMode =
  | {
      kind: "anchor";
    }
  | {
      kind: "offset";
      offset: number;
    };

export type ReadonlyViewportState = {
  canScroll: boolean;
  footerLines: readonly string[];
  hiddenAfter: number;
  hiddenBefore: number;
  maxOffset: number;
  offset: number;
  visibleBodyLines: readonly string[];
  visibleBodyRowCount: number;
};

export function buildReadonlyRuntimeFooterLines(input: {
  alwaysShowScrollHint?: boolean;
  canScroll: boolean;
  hiddenAfter: number;
  hiddenBefore: number;
  scrollHintLine?: string;
}): string[] {
  const overflowSummaryLine = formatPanelOverflowHintLine({
    hiddenAfter: input.hiddenAfter,
    hiddenBefore: input.hiddenBefore,
  });
  const lines: string[] = [];

  if (overflowSummaryLine) {
    lines.push(overflowSummaryLine);
  }
  if (input.canScroll || input.alwaysShowScrollHint) {
    lines.push(input.scrollHintLine ?? READONLY_VIEWPORT_SCROLL_HINT_LINE);
  }

  return lines;
}

export function resolveReadonlyViewportState(input: {
  bodyAnchorRowIndex: number | null;
  bodyAnchorRowRange: { end: number; start: number } | null;
  bodyRows: readonly ReadonlyViewportRow[];
  controlRows: readonly ReadonlyViewportRow[];
  footerRows: readonly ReadonlyViewportRow[];
  headerRows: readonly ReadonlyViewportRow[];
  maxDisplayRows: number;
  runtimeFooter?: {
    alwaysShowScrollHint?: boolean;
    scrollHintLine?: string;
    wrapLines?: (lines: readonly string[]) => readonly ReadonlyViewportRow[];
  };
  scrollMode: ReadonlyViewportScrollMode;
}): ReadonlyViewportState {
  const wrapRuntimeFooterLines =
    input.runtimeFooter?.wrapLines ?? mapLinesToRows;

  if (input.bodyRows.length === 0) {
    const runtimeFooterRows = wrapRuntimeFooterLines(
      buildReadonlyRuntimeFooterLines({
        alwaysShowScrollHint: input.runtimeFooter?.alwaysShowScrollHint,
        canScroll: false,
        hiddenAfter: 0,
        hiddenBefore: 0,
        scrollHintLine: input.runtimeFooter?.scrollHintLine,
      })
    );
    return {
      canScroll: false,
      footerLines: [...runtimeFooterRows, ...input.footerRows].map(
        (row) => row.text
      ),
      hiddenAfter: 0,
      hiddenBefore: 0,
      maxOffset: 0,
      offset: 0,
      visibleBodyLines: [],
      visibleBodyRowCount: 0,
    };
  }

  const baseVisibleBodyRowCount = resolveVisibleBodyRowCount({
    bodyPresent: true,
    controlLineCount: input.controlRows.length,
    footerLineCount: input.footerRows.length,
    headerLineCount: input.headerRows.length,
    maxDisplayRows: input.maxDisplayRows,
  });

  let visibleBodyRowCount = baseVisibleBodyRowCount;
  let visibleWindow = resolveVisibleWindow({
    anchorIndex: input.bodyAnchorRowIndex,
    anchorRange: input.bodyAnchorRowRange,
    bodyRowCount: input.bodyRows.length,
    maxVisible: baseVisibleBodyRowCount,
    scrollMode: input.scrollMode,
  });
  let footerRows = input.footerRows;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const hiddenBefore = visibleWindow.start;
    const hiddenAfter = Math.max(0, input.bodyRows.length - visibleWindow.end);
    const runtimeFooterRows = wrapRuntimeFooterLines(
      buildReadonlyRuntimeFooterLines({
        alwaysShowScrollHint: input.runtimeFooter?.alwaysShowScrollHint,
        canScroll: input.bodyRows.length > visibleBodyRowCount,
        hiddenAfter,
        hiddenBefore,
        scrollHintLine: input.runtimeFooter?.scrollHintLine,
      })
    );
    const nextFooterRows = [...runtimeFooterRows, ...input.footerRows];
    const nextVisibleBodyRowCount = resolveVisibleBodyRowCount({
      bodyPresent: true,
      controlLineCount: input.controlRows.length,
      footerLineCount: nextFooterRows.length,
      headerLineCount: input.headerRows.length,
      maxDisplayRows: input.maxDisplayRows,
    });
    const nextVisibleWindow = resolveVisibleWindow({
      anchorIndex: input.bodyAnchorRowIndex,
      anchorRange: input.bodyAnchorRowRange,
      bodyRowCount: input.bodyRows.length,
      maxVisible: nextVisibleBodyRowCount,
      scrollMode: input.scrollMode,
    });
    const footerStable =
      nextFooterRows.length === footerRows.length &&
      nextFooterRows.every(
        (row, index) => row.text === footerRows[index]?.text
      );
    const windowStable =
      nextVisibleBodyRowCount === visibleBodyRowCount &&
      nextVisibleWindow.start === visibleWindow.start &&
      nextVisibleWindow.end === visibleWindow.end;

    footerRows = nextFooterRows;
    visibleBodyRowCount = nextVisibleBodyRowCount;
    visibleWindow = nextVisibleWindow;

    if (footerStable && windowStable) {
      break;
    }
  }

  const hiddenBefore = visibleWindow.start;
  const hiddenAfter = Math.max(0, input.bodyRows.length - visibleWindow.end);
  const maxOffset = Math.max(0, input.bodyRows.length - visibleBodyRowCount);

  return {
    canScroll: input.bodyRows.length > visibleBodyRowCount,
    footerLines: footerRows.map((row) => row.text),
    hiddenAfter,
    hiddenBefore,
    maxOffset,
    offset: visibleWindow.start,
    visibleBodyLines: input.bodyRows
      .slice(visibleWindow.start, visibleWindow.end)
      .map((row) => row.text),
    visibleBodyRowCount,
  };
}

export function resolveNextReadonlyViewportOffset(input: {
  canScroll: boolean;
  currentOffset: number;
  data: string;
  maxOffset: number;
  visibleBodyRowCount: number;
}): number {
  if (!input.canScroll) {
    return input.currentOffset;
  }

  const pageStep = Math.max(1, input.visibleBodyRowCount);
  if (matchesKey(input.data, Key.up)) {
    return Math.max(0, input.currentOffset - 1);
  }
  if (matchesKey(input.data, Key.down)) {
    return Math.min(input.maxOffset, input.currentOffset + 1);
  }
  if (matchesKey(input.data, Key.pageUp)) {
    return Math.max(0, input.currentOffset - pageStep);
  }
  if (matchesKey(input.data, Key.pageDown)) {
    return Math.min(input.maxOffset, input.currentOffset + pageStep);
  }
  if (matchesKey(input.data, Key.home)) {
    return 0;
  }
  if (matchesKey(input.data, Key.end)) {
    return input.maxOffset;
  }

  return input.currentOffset;
}

function mapLinesToRows(lines: readonly string[]): ReadonlyViewportRow[] {
  return lines.map((text) => ({ text }));
}

function resolveVisibleWindow(input: {
  anchorIndex: number | null;
  anchorRange: { end: number; start: number } | null;
  bodyRowCount: number;
  maxVisible: number;
  scrollMode: ReadonlyViewportScrollMode;
}): { end: number; start: number } {
  if (input.scrollMode.kind === "anchor") {
    if (input.anchorRange) {
      return resolveAnchoredItemVisibleWindow({
        anchorEndIndex: input.anchorRange.end,
        anchorStartIndex: input.anchorRange.start,
        itemCount: input.bodyRowCount,
        maxVisible: input.maxVisible,
      });
    }
    return resolveAnchoredVisibleWindow({
      anchorIndex: input.anchorIndex,
      itemCount: input.bodyRowCount,
      maxVisible: input.maxVisible,
    });
  }

  return resolveOffsetVisibleWindow({
    itemCount: input.bodyRowCount,
    maxVisible: input.maxVisible,
    offset: input.scrollMode.offset,
  });
}

function resolveVisibleBodyRowCount(input: {
  bodyPresent: boolean;
  controlLineCount: number;
  footerLineCount: number;
  headerLineCount: number;
  maxDisplayRows: number;
}): number {
  const headerControlSeparator =
    input.headerLineCount > 0 && input.controlLineCount > 0 ? 1 : 0;
  const bodySeparator =
    input.bodyPresent &&
    (input.headerLineCount > 0 || input.controlLineCount > 0)
      ? 1
      : 0;
  const footerSeparator =
    input.footerLineCount > 0 &&
    (input.bodyPresent ||
      input.headerLineCount > 0 ||
      input.controlLineCount > 0)
      ? 1
      : 0;
  const visibleBodyRowCount =
    input.maxDisplayRows -
    input.headerLineCount -
    input.controlLineCount -
    input.footerLineCount -
    headerControlSeparator -
    bodySeparator -
    footerSeparator;

  return Math.max(1, visibleBodyRowCount);
}

function resolveAnchoredItemVisibleWindow(input: {
  anchorEndIndex: number;
  anchorStartIndex: number;
  itemCount: number;
  maxVisible: number;
}): { end: number; start: number } {
  if (input.itemCount <= input.maxVisible) {
    return {
      end: input.itemCount,
      start: 0,
    };
  }

  const maxStart = Math.max(0, input.itemCount - input.maxVisible);
  const clampedStartIndex = clampNumber(
    input.anchorStartIndex,
    0,
    input.itemCount - 1
  );
  const clampedEndIndex = clampNumber(
    input.anchorEndIndex,
    clampedStartIndex,
    input.itemCount - 1
  );
  const itemHeight = clampedEndIndex - clampedStartIndex + 1;

  if (itemHeight >= input.maxVisible) {
    const start = clampNumber(clampedStartIndex, 0, maxStart);
    return {
      end: Math.min(input.itemCount, start + input.maxVisible),
      start,
    };
  }

  const freeRows = input.maxVisible - itemHeight;
  const centeredStart = clampedStartIndex - Math.floor(freeRows / 2);
  let start = clampNumber(centeredStart, 0, maxStart);
  if (start > clampedStartIndex) {
    start = clampedStartIndex;
  }
  if (start + input.maxVisible <= clampedEndIndex) {
    start = clampNumber(clampedEndIndex - input.maxVisible + 1, 0, maxStart);
  }
  return {
    end: Math.min(input.itemCount, start + input.maxVisible),
    start,
  };
}
