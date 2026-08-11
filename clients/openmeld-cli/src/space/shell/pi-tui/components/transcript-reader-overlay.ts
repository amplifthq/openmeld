import { stripVTControlCharacters } from "node:util";
import { type Component, Key, matchesKey } from "@mariozechner/pi-tui";
import { formatPanelInstructionsLine } from "../../../panel/space-panel-definition";
import {
  renderTranscriptBlocks,
  type TranscriptBlockViewState,
} from "../../../transcript/transcript-render";
import {
  buildReadonlyOverlayRenderResult,
  createReadonlyOverlayChrome,
  renderReadonlyOverlayChrome,
  resolveReadonlyOverlayContentWidth,
  resolveReadonlyOverlayMaxDisplayRows,
  syncReadonlyOverlayChrome,
  wrapReadonlyViewportRows,
} from "./readonly-overlay-surface";
import {
  type ReadonlyViewportRow,
  resolveNextReadonlyViewportOffset,
  resolveReadonlyViewportState,
} from "./readonly-viewport";

const TRANSCRIPT_READER_TITLE = "📜 Transcript History";
const TRANSCRIPT_READER_HEADER_LINE =
  "Read older messages without leaving the live session.";
const TRANSCRIPT_READER_EMPTY_LINE = "No messages yet.";
const TRANSCRIPT_READER_UPDATES_BELOW_LINE = "New updates below · End to jump";
const TRANSCRIPT_READER_CLOSE_LINE = formatPanelInstructionsLine([
  {
    id: "close",
    keys: ["Esc"],
    label: "close",
  },
]);

type TranscriptReaderRenderState = {
  hasNewUpdatesBelow: boolean;
  isFollowingLatest: boolean;
  scrollOffset: number;
};

export class TranscriptReaderOverlay implements Component {
  readonly #chrome = createReadonlyOverlayChrome("dark");
  readonly #getMaxPanelRows: () => number;
  readonly #onClose: () => void;

  #blocks: readonly TranscriptBlockViewState[];
  #hasNewUpdatesBelow = false;
  #isFollowingLatest = true;
  #lastRenderWidth = 80;
  #lastRenderedRowCount = 0;
  #pendingBlockUpdate = true;
  #scrollOffset = 0;

  constructor(input: {
    blocks: readonly TranscriptBlockViewState[];
    getMaxPanelRows: () => number;
    onClose: () => void;
  }) {
    this.#blocks = input.blocks;
    this.#getMaxPanelRows = input.getMaxPanelRows;
    this.#onClose = input.onClose;
    this.#syncText(80);
  }

  setBlocks(blocks: readonly TranscriptBlockViewState[]): void {
    this.#blocks = blocks;
    this.#pendingBlockUpdate = true;
    this.#syncText(this.#lastRenderWidth);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.#onClose();
      return;
    }

    const viewportState = this.#buildViewportState(this.#lastRenderWidth);
    const nextScrollOffset = resolveNextReadonlyViewportOffset({
      canScroll: viewportState.canScroll,
      currentOffset: viewportState.offset,
      data,
      maxOffset: viewportState.maxOffset,
      visibleBodyRowCount: viewportState.visibleBodyRowCount,
    });
    if (nextScrollOffset === viewportState.offset) {
      return;
    }

    this.#scrollOffset = nextScrollOffset;
    this.#isFollowingLatest = nextScrollOffset >= viewportState.maxOffset;
    if (this.#isFollowingLatest) {
      this.#hasNewUpdatesBelow = false;
    }
    this.#syncText(this.#lastRenderWidth);
    this.invalidate();
  }

  invalidate(): void {
    this.#chrome.surfaceBox.invalidate();
  }

  render(width: number): string[] {
    this.#lastRenderWidth = width;
    this.#syncText(width);
    return renderReadonlyOverlayChrome(this.#chrome, width);
  }

  #syncText(width: number): void {
    syncReadonlyOverlayChrome(this.#chrome, "dark");
    const currentRenderState = this.#normalizeRenderState(
      this.#readRenderState()
    );
    let renderResult = this.#buildOverlayRenderResult(
      width,
      currentRenderState
    );
    const previousVisibleBodyEnd =
      renderResult.viewportState.offset +
      renderResult.viewportState.visibleBodyRowCount;
    const nextHasNewUpdatesBelow = this.#resolveNextHasNewUpdatesBelow({
      bodyRowCount: renderResult.sections.bodyRows.length,
      renderState: currentRenderState,
    });
    let nextRenderState =
      nextHasNewUpdatesBelow === currentRenderState.hasNewUpdatesBelow
        ? currentRenderState
        : {
            ...currentRenderState,
            hasNewUpdatesBelow: nextHasNewUpdatesBelow,
          };

    if (this.#pendingBlockUpdate && !currentRenderState.isFollowingLatest) {
      const previewViewportState =
        nextRenderState === currentRenderState
          ? renderResult.viewportState
          : this.#buildViewportState(width, nextRenderState);
      const preservedOffset = Math.max(
        0,
        Math.min(
          previewViewportState.maxOffset,
          previousVisibleBodyEnd - previewViewportState.visibleBodyRowCount
        )
      );
      if (preservedOffset !== nextRenderState.scrollOffset) {
        nextRenderState = {
          ...nextRenderState,
          scrollOffset: preservedOffset,
        };
      }
      if (preservedOffset >= previewViewportState.maxOffset) {
        nextRenderState = {
          ...nextRenderState,
          hasNewUpdatesBelow: false,
          isFollowingLatest: true,
        };
      }
    }

    if (!this.#isSameRenderState(currentRenderState, nextRenderState)) {
      renderResult = this.#buildOverlayRenderResult(width, nextRenderState);
    }
    const nextIsFollowingLatest =
      renderResult.viewportState.offset >= renderResult.viewportState.maxOffset;
    this.#scrollOffset = renderResult.viewportState.offset;
    this.#isFollowingLatest = nextIsFollowingLatest;
    this.#hasNewUpdatesBelow = nextIsFollowingLatest
      ? false
      : nextRenderState.hasNewUpdatesBelow;
    this.#lastRenderedRowCount = renderResult.sections.bodyRows.length;
    this.#pendingBlockUpdate = false;
    this.#chrome.text.setText(renderResult.renderedLines.join("\n"));
  }

  #buildViewportState(
    width: number,
    renderState: TranscriptReaderRenderState = this.#readRenderState()
  ) {
    const contentWidth = resolveReadonlyOverlayContentWidth(width);
    return resolveReadonlyViewportState({
      ...this.#buildOverlaySections(contentWidth, renderState),
      maxDisplayRows: resolveReadonlyOverlayMaxDisplayRows(
        this.#getMaxPanelRows()
      ),
      runtimeFooter: this.#buildViewportRuntimeFooter(contentWidth),
      scrollMode: renderState.isFollowingLatest
        ? {
            kind: "anchor",
          }
        : {
            kind: "offset",
            offset: renderState.scrollOffset,
          },
    });
  }

  #buildOverlayRenderResult(
    width: number,
    renderState: TranscriptReaderRenderState = this.#readRenderState()
  ) {
    return buildReadonlyOverlayRenderResult({
      maxPanelRows: this.#getMaxPanelRows(),
      resolveSections: (contentWidth) =>
        this.#buildOverlaySections(contentWidth, renderState),
      runtimeFooter: this.#buildOverlayRuntimeFooter(),
      scrollMode: renderState.isFollowingLatest
        ? {
            kind: "anchor",
          }
        : {
            kind: "offset",
            offset: renderState.scrollOffset,
          },
      surfaceVariant: "dark",
      title: TRANSCRIPT_READER_TITLE,
      width,
    });
  }

  #readRenderState(): TranscriptReaderRenderState {
    return {
      hasNewUpdatesBelow: this.#hasNewUpdatesBelow,
      isFollowingLatest: this.#isFollowingLatest,
      scrollOffset: this.#scrollOffset,
    };
  }

  #normalizeRenderState(
    renderState: TranscriptReaderRenderState
  ): TranscriptReaderRenderState {
    if (!renderState.isFollowingLatest) {
      return renderState;
    }
    if (!renderState.hasNewUpdatesBelow) {
      return renderState;
    }
    return {
      ...renderState,
      hasNewUpdatesBelow: false,
    };
  }

  #isSameRenderState(
    left: TranscriptReaderRenderState,
    right: TranscriptReaderRenderState
  ): boolean {
    return (
      left.hasNewUpdatesBelow === right.hasNewUpdatesBelow &&
      left.isFollowingLatest === right.isFollowingLatest &&
      left.scrollOffset === right.scrollOffset
    );
  }

  #buildOverlaySections(
    contentWidth: number,
    renderState: TranscriptReaderRenderState
  ) {
    const latestBlockRowRange = renderState.isFollowingLatest
      ? this.#buildLatestBlockRowRange(contentWidth)
      : null;
    return {
      bodyAnchorRowIndex: latestBlockRowRange?.start ?? null,
      bodyAnchorRowRange: latestBlockRowRange,
      bodyRows: this.#buildBodyRows(contentWidth),
      controlRows: [],
      footerRows: wrapPlainTextRows(
        this.#buildFooterLines(renderState),
        contentWidth
      ),
      headerRows: wrapPlainTextRows(
        [TRANSCRIPT_READER_TITLE, TRANSCRIPT_READER_HEADER_LINE],
        contentWidth
      ),
    };
  }

  #buildOverlayRuntimeFooter() {
    return {
      alwaysShowScrollHint: true,
      wrapLines: (lines: readonly string[], contentWidth: number) =>
        wrapPlainTextRows(lines, contentWidth),
    };
  }

  #buildViewportRuntimeFooter(contentWidth: number) {
    return {
      alwaysShowScrollHint: true,
      wrapLines: (lines: readonly string[]) =>
        wrapPlainTextRows(lines, contentWidth),
    };
  }

  #buildBodyRows(contentWidth: number): ReadonlyViewportRow[] {
    const lines = renderTranscriptBlocks(this.#blocks, contentWidth);
    if (lines.length === 0) {
      return [
        {
          text: TRANSCRIPT_READER_EMPTY_LINE,
        },
      ];
    }
    return lines.map((text) => ({ text }));
  }

  #buildLatestBlockRowRange(contentWidth: number): {
    end: number;
    start: number;
  } | null {
    const lastBlock = this.#blocks.at(-1);
    if (!lastBlock) {
      return null;
    }

    const lastBlockLines = renderTranscriptBlocks([lastBlock], contentWidth);
    if (lastBlockLines.length === 0) {
      return null;
    }
    const visibleLastBlockRowRange =
      resolveVisibleTranscriptRowRange(lastBlockLines);
    if (this.#blocks.length === 1) {
      return {
        end: visibleLastBlockRowRange.end,
        start: visibleLastBlockRowRange.start,
      };
    }

    const prefixLines = renderTranscriptBlocks(
      this.#blocks.slice(0, -1),
      contentWidth
    );
    const previousBlock = this.#blocks.at(-2);
    if (!previousBlock) {
      return {
        end: lastBlockLines.length - 1,
        start: 0,
      };
    }

    const previousAndLastLines = renderTranscriptBlocks(
      [previousBlock, lastBlock],
      contentWidth
    );
    const previousBlockLines = renderTranscriptBlocks(
      [previousBlock],
      contentWidth
    );
    const gapLineCount = Math.max(
      0,
      previousAndLastLines.length -
        previousBlockLines.length -
        lastBlockLines.length
    );
    const start = prefixLines.length + gapLineCount;

    return {
      end: start + visibleLastBlockRowRange.end,
      start: start + visibleLastBlockRowRange.start,
    };
  }

  #buildFooterLines(renderState: TranscriptReaderRenderState): string[] {
    const lines: string[] = [];
    if (renderState.hasNewUpdatesBelow && !renderState.isFollowingLatest) {
      lines.push(TRANSCRIPT_READER_UPDATES_BELOW_LINE);
    }
    lines.push(TRANSCRIPT_READER_CLOSE_LINE);
    return lines;
  }

  #resolveNextHasNewUpdatesBelow(input: {
    bodyRowCount: number;
    renderState: TranscriptReaderRenderState;
  }): boolean {
    if (!this.#pendingBlockUpdate) {
      return input.renderState.hasNewUpdatesBelow;
    }
    if (input.renderState.isFollowingLatest) {
      return false;
    }
    if (input.bodyRowCount > this.#lastRenderedRowCount) {
      return true;
    }
    return input.renderState.hasNewUpdatesBelow;
  }
}

function wrapPlainTextRows(
  lines: readonly string[],
  contentWidth: number
): ReadonlyViewportRow[] {
  return wrapReadonlyViewportRows({
    contentWidth,
    lines,
    mapRow: (text) => ({
      text,
    }),
  });
}

function resolveVisibleTranscriptRowRange(lines: readonly string[]): {
  end: number;
  start: number;
} {
  let start = 0;
  while (
    start < lines.length &&
    stripVTControlCharacters(lines[start] ?? "").trim().length === 0
  ) {
    start += 1;
  }

  let end = lines.length - 1;
  while (
    end >= start &&
    stripVTControlCharacters(lines[end] ?? "").trim().length === 0
  ) {
    end -= 1;
  }

  if (end < start) {
    return {
      end: Math.max(0, lines.length - 1),
      start: 0,
    };
  }

  return {
    end,
    start,
  };
}
