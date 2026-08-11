import { type Component, Key, matchesKey } from "@mariozechner/pi-tui";
import { clampNumber } from "../../../../ui/visible-window";
import {
  buildPanelDisplaySections,
  type PanelDisplayBodyItemAnchor,
} from "../../../panel/space-panel-display";
import type { PanelViewState } from "../../../view/space-session-view-state";
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

type WrappedPanelRow = ReadonlyViewportRow & {
  sourceLineIndex: number;
};

type WrappedPanelItemAnchor = {
  endRowIndex: number;
  id: string;
  startRowIndex: number;
};

type WrappedPanelSections = {
  bodyAnchorRowIndex: number | null;
  bodyAnchorRowRange: { end: number; start: number } | null;
  bodyItemAnchors: readonly WrappedPanelItemAnchor[];
  bodyRows: readonly WrappedPanelRow[];
  controlRows: readonly WrappedPanelRow[];
  footerRows: readonly WrappedPanelRow[];
  headerRows: readonly WrappedPanelRow[];
};

export class ReadonlyOverlayPanel implements Component {
  readonly #chrome = createReadonlyOverlayChrome();
  readonly #getMaxPanelRows: () => number;
  readonly #onClose: () => void;
  #panel: PanelViewState;
  #lastRenderWidth = 80;
  #scrollOffset = 0;

  constructor(input: {
    getMaxPanelRows: () => number;
    onClose: () => void;
    panel: PanelViewState;
  }) {
    this.#getMaxPanelRows = input.getMaxPanelRows;
    this.#onClose = input.onClose;
    this.#panel = input.panel;
    this.#syncText(80);
  }

  setPanel(panel: PanelViewState): void {
    this.#panel = panel;
    this.#syncText(this.#lastRenderWidth);
  }

  handleInput(data: string): void {
    const nextScrollOffset = resolveNextReadonlyScrollOffset({
      currentScrollOffset: this.#scrollOffset,
      data,
      getMaxPanelRows: this.#getMaxPanelRows,
      panel: this.#panel,
      width: this.#lastRenderWidth,
    });
    if (nextScrollOffset !== this.#scrollOffset) {
      this.#scrollOffset = nextScrollOffset;
      this.#syncText(this.#lastRenderWidth);
      this.invalidate();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.#onClose();
    }
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
    syncReadonlyOverlayChrome(this.#chrome, this.#panel.surfaceVariant);
    const renderResult = buildReadonlyOffsetRenderResult({
      getMaxPanelRows: this.#getMaxPanelRows,
      panel: this.#panel,
      scrollOffset: this.#scrollOffset,
      width,
    });
    this.#scrollOffset = renderResult.viewportState.offset;
    this.#chrome.text.setText(renderResult.renderedLines.join("\n"));
  }
}

export class SearchableOverlayPanel implements Component {
  readonly #chrome = createReadonlyOverlayChrome();
  readonly #getMaxPanelRows: () => number;
  readonly #onActiveItemChange: (activeItemId: string | null) => void;
  readonly #onClose: () => void;
  readonly #onQueryChange: (query: string) => void;
  #panel: PanelViewState;
  #lastRenderWidth = 80;

  constructor(input: {
    getMaxPanelRows: () => number;
    onActiveItemChange: (activeItemId: string | null) => void;
    onClose: () => void;
    onQueryChange: (query: string) => void;
    panel: PanelViewState;
  }) {
    this.#getMaxPanelRows = input.getMaxPanelRows;
    this.#onActiveItemChange = input.onActiveItemChange;
    this.#onClose = input.onClose;
    this.#onQueryChange = input.onQueryChange;
    this.#panel = input.panel;
    this.#syncText(80);
  }

  setPanel(panel: PanelViewState): void {
    this.#panel = panel;
    this.#syncText(this.#lastRenderWidth);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.#onClose();
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      const currentQuery = this.#panel.searchableList?.control.query ?? "";
      if (currentQuery.length > 0) {
        this.#onQueryChange(currentQuery.slice(0, -1));
      }
      return;
    }

    const nextActiveItemId = resolveNextSearchableActiveItemId({
      data,
      getMaxPanelRows: this.#getMaxPanelRows,
      panel: this.#panel,
      width: this.#lastRenderWidth,
    });
    if (nextActiveItemId !== this.#panel.searchableList?.activeItemId) {
      this.#onActiveItemChange(nextActiveItemId);
      return;
    }

    if (isPrintablePanelQueryInput(data)) {
      const currentQuery = this.#panel.searchableList?.control.query ?? "";
      this.#onQueryChange(`${currentQuery}${data}`);
    }
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
    syncReadonlyOverlayChrome(this.#chrome, this.#panel.surfaceVariant);
    const renderResult = buildReadonlyOverlayRenderResult({
      maxPanelRows: this.#getMaxPanelRows(),
      resolveSections: (contentWidth) => {
        const wrappedSections = buildWrappedPanelSections({
          contentWidth,
          panel: this.#panel,
        });
        const activeItemAnchor = resolveWrappedActiveItemAnchor(
          wrappedSections.bodyItemAnchors,
          this.#panel.searchableList?.activeItemId ?? null
        );
        return {
          ...wrappedSections,
          bodyAnchorRowIndex: activeItemAnchor?.startRowIndex ?? null,
          bodyAnchorRowRange: activeItemAnchor
            ? {
                end: activeItemAnchor.endRowIndex,
                start: activeItemAnchor.startRowIndex,
              }
            : null,
        };
      },
      runtimeFooter: {
        wrapLines: (lines, contentWidth) =>
          wrapPanelSectionRows(lines, contentWidth),
      },
      scrollMode: {
        kind: "anchor",
      },
      surfaceVariant: this.#panel.surfaceVariant,
      title: this.#panel.title,
      width,
    });
    this.#chrome.text.setText(renderResult.renderedLines.join("\n"));
  }
}

function resolveNextReadonlyScrollOffset(input: {
  currentScrollOffset: number;
  data: string;
  getMaxPanelRows: () => number;
  panel: PanelViewState;
  width: number;
}): number {
  const viewportState = buildReadonlyViewportState({
    getMaxPanelRows: input.getMaxPanelRows,
    panel: input.panel,
    scrollOffset: input.currentScrollOffset,
    width: input.width,
  });
  return resolveNextReadonlyViewportOffset({
    canScroll: viewportState.canScroll,
    currentOffset: viewportState.offset,
    data: input.data,
    maxOffset: viewportState.maxOffset,
    visibleBodyRowCount: viewportState.visibleBodyRowCount,
  });
}

function buildReadonlyViewportState(input: {
  getMaxPanelRows: () => number;
  panel: PanelViewState;
  scrollOffset: number;
  width: number;
}) {
  return buildReadonlyOffsetRenderResult(input).viewportState;
}

function resolveNextSearchableActiveItemId(input: {
  data: string;
  getMaxPanelRows: () => number;
  panel: PanelViewState;
  width: number;
}): string | null {
  const searchableList = input.panel.searchableList;
  if (!searchableList) {
    return null;
  }

  const panelContentWidth = resolveReadonlyOverlayContentWidth(input.width);
  const wrappedSections = buildWrappedPanelSections({
    contentWidth: panelContentWidth,
    panel: input.panel,
  });
  const itemAnchors = wrappedSections.bodyItemAnchors;
  if (itemAnchors.length === 0) {
    return null;
  }

  const currentIndex = clampNumber(
    itemAnchors.findIndex(
      (anchor) => anchor.id === searchableList.activeItemId
    ),
    0,
    itemAnchors.length - 1
  );
  const currentAnchor = itemAnchors[currentIndex];
  if (!currentAnchor) {
    return itemAnchors[0]?.id ?? null;
  }
  const viewportState = resolveReadonlyViewportState({
    bodyAnchorRowIndex: currentAnchor.startRowIndex,
    bodyAnchorRowRange: {
      end: currentAnchor.endRowIndex,
      start: currentAnchor.startRowIndex,
    },
    bodyRows: wrappedSections.bodyRows,
    controlRows: wrappedSections.controlRows,
    footerRows: wrappedSections.footerRows,
    headerRows: wrappedSections.headerRows,
    maxDisplayRows: resolveReadonlyOverlayMaxDisplayRows(
      input.getMaxPanelRows()
    ),
    runtimeFooter: {
      wrapLines: (lines) => wrapPanelSectionRows(lines, panelContentWidth),
    },
    scrollMode: {
      kind: "anchor",
    },
  });

  if (matchesKey(input.data, Key.up)) {
    return itemAnchors[Math.max(0, currentIndex - 1)]?.id ?? currentAnchor.id;
  }
  if (matchesKey(input.data, Key.down)) {
    return (
      itemAnchors[Math.min(itemAnchors.length - 1, currentIndex + 1)]?.id ??
      currentAnchor.id
    );
  }
  if (matchesKey(input.data, Key.home)) {
    return itemAnchors[0]?.id ?? currentAnchor.id;
  }
  if (matchesKey(input.data, Key.end)) {
    return itemAnchors.at(-1)?.id ?? currentAnchor.id;
  }
  if (matchesKey(input.data, Key.pageUp)) {
    return resolvePageMoveItemId({
      currentAnchor,
      deltaRows: -viewportState.visibleBodyRowCount,
      fallbackIndex: 0,
      itemAnchors,
    });
  }
  if (matchesKey(input.data, Key.pageDown)) {
    return resolvePageMoveItemId({
      currentAnchor,
      deltaRows: viewportState.visibleBodyRowCount,
      fallbackIndex: itemAnchors.length - 1,
      itemAnchors,
    });
  }

  return searchableList.activeItemId;
}

function resolvePageMoveItemId(input: {
  currentAnchor: WrappedPanelItemAnchor;
  deltaRows: number;
  fallbackIndex: number;
  itemAnchors: readonly WrappedPanelItemAnchor[];
}): string | null {
  const targetRowIndex = input.currentAnchor.startRowIndex + input.deltaRows;
  if (input.deltaRows < 0) {
    for (let index = input.itemAnchors.length - 1; index >= 0; index -= 1) {
      const anchor = input.itemAnchors[index];
      if (anchor && anchor.startRowIndex <= targetRowIndex) {
        return anchor.id;
      }
    }
  } else {
    for (const anchor of input.itemAnchors) {
      if (anchor.startRowIndex >= targetRowIndex) {
        return anchor.id;
      }
    }
  }
  return input.itemAnchors[input.fallbackIndex]?.id ?? null;
}

function buildWrappedPanelSections(input: {
  contentWidth: number;
  panel: PanelViewState;
}): WrappedPanelSections {
  const sections = buildPanelDisplaySections({
    contentWidth: input.contentWidth,
    panel: input.panel,
  });
  const bodyRows = wrapPanelSectionRows(sections.bodyLines, input.contentWidth);
  const controlRows = wrapPanelSectionRows(
    sections.controlLines,
    input.contentWidth
  );
  const footerRows = wrapPanelSectionRows(
    sections.footerLines,
    input.contentWidth
  );
  const headerRows = wrapPanelSectionRows(
    sections.headerLines,
    input.contentWidth
  );
  return {
    bodyAnchorRowIndex: resolveWrappedAnchorRowIndex(
      bodyRows,
      sections.bodyAnchorLineIndex
    ),
    bodyAnchorRowRange: null,
    bodyItemAnchors: resolveWrappedItemAnchors(
      bodyRows,
      sections.bodyItemAnchors
    ),
    bodyRows,
    controlRows,
    footerRows,
    headerRows,
  };
}

function wrapPanelSectionRows(
  lines: readonly string[],
  contentWidth: number
): WrappedPanelRow[] {
  return wrapReadonlyViewportRows({
    contentWidth,
    lines,
    mapRow: (text, sourceLineIndex) => ({
      sourceLineIndex,
      text,
    }),
  });
}

function buildReadonlyOffsetRenderResult(input: {
  getMaxPanelRows: () => number;
  panel: PanelViewState;
  scrollOffset: number;
  width: number;
}) {
  return buildReadonlyOverlayRenderResult({
    maxPanelRows: input.getMaxPanelRows(),
    resolveSections: (contentWidth) =>
      buildWrappedPanelSections({
        contentWidth,
        panel: input.panel,
      }),
    runtimeFooter: {
      wrapLines: (lines, contentWidth) =>
        wrapPanelSectionRows(lines, contentWidth),
    },
    scrollMode: {
      kind: "offset",
      offset: input.scrollOffset,
    },
    surfaceVariant: input.panel.surfaceVariant,
    title: input.panel.title,
    width: input.width,
  });
}

function resolveWrappedAnchorRowIndex(
  rows: readonly WrappedPanelRow[],
  anchorLineIndex: number | null
): number | null {
  if (anchorLineIndex === null) {
    return null;
  }

  const rowIndex = rows.findIndex(
    (row) => row.sourceLineIndex === anchorLineIndex
  );
  return rowIndex >= 0 ? rowIndex : null;
}

function resolveWrappedItemAnchors(
  rows: readonly WrappedPanelRow[],
  anchors: readonly PanelDisplayBodyItemAnchor[]
): WrappedPanelItemAnchor[] {
  return anchors
    .map((anchor, index) => {
      const startRowIndex = rows.findIndex(
        (row) => row.sourceLineIndex === anchor.lineIndex
      );
      if (startRowIndex < 0) {
        return null;
      }
      const nextAnchorLineIndex =
        anchors[index + 1]?.lineIndex ?? Number.POSITIVE_INFINITY;
      let endRowIndex = startRowIndex;
      for (
        let rowIndex = startRowIndex;
        rowIndex < rows.length;
        rowIndex += 1
      ) {
        const row = rows[rowIndex];
        if (!row || row.sourceLineIndex >= nextAnchorLineIndex) {
          break;
        }
        endRowIndex = rowIndex;
      }
      return {
        endRowIndex,
        id: anchor.id,
        startRowIndex,
      };
    })
    .filter((anchor): anchor is WrappedPanelItemAnchor => anchor !== null);
}

function resolveWrappedActiveItemAnchor(
  itemAnchors: readonly WrappedPanelItemAnchor[],
  activeItemId: string | null
): WrappedPanelItemAnchor | null {
  if (!activeItemId) {
    return null;
  }
  return itemAnchors.find((anchor) => anchor.id === activeItemId) ?? null;
}

function isPrintablePanelQueryInput(data: string): boolean {
  if (!containsOnlyPrintablePanelQueryCharacters(data)) {
    return false;
  }
  if (
    matchesKey(data, Key.up) ||
    matchesKey(data, Key.down) ||
    matchesKey(data, Key.pageUp) ||
    matchesKey(data, Key.pageDown) ||
    matchesKey(data, Key.home) ||
    matchesKey(data, Key.end) ||
    matchesKey(data, Key.escape) ||
    matchesKey(data, Key.enter) ||
    matchesKey(data, Key.ctrl("d"))
  ) {
    return false;
  }
  return true;
}

function containsOnlyPrintablePanelQueryCharacters(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      return false;
    }
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return false;
    }
  }

  return true;
}
