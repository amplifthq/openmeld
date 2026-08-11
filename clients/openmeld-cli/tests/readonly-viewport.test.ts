import { describe, expect, it } from "vitest";
import {
  READONLY_VIEWPORT_SCROLL_HINT_LINE,
  type ReadonlyViewportRow,
  resolveNextReadonlyViewportOffset,
  resolveReadonlyViewportState,
} from "../src/space/shell/pi-tui/components/readonly-viewport";

describe("resolveReadonlyViewportState", () => {
  it("preserves explicit offsets when rows append", () => {
    const initialState = resolveReadonlyViewportState({
      bodyAnchorRowIndex: null,
      bodyAnchorRowRange: null,
      bodyRows: createRows(8),
      controlRows: [],
      footerRows: mapLinesToRows(["Press Esc to close."]),
      headerRows: mapLinesToRows(["Header"]),
      maxDisplayRows: 8,
      scrollMode: {
        kind: "offset",
        offset: 2,
      },
    });

    const appendedState = resolveReadonlyViewportState({
      bodyAnchorRowIndex: null,
      bodyAnchorRowRange: null,
      bodyRows: createRows(10),
      controlRows: [],
      footerRows: mapLinesToRows(["Press Esc to close."]),
      headerRows: mapLinesToRows(["Header"]),
      maxDisplayRows: 8,
      scrollMode: {
        kind: "offset",
        offset: initialState.offset,
      },
    });

    expect(initialState.offset).toBe(2);
    expect(appendedState.offset).toBe(2);
  });

  it("pins to the latest content when follow-latest uses an unbounded offset", () => {
    const initialState = resolveReadonlyViewportState({
      bodyAnchorRowIndex: null,
      bodyAnchorRowRange: null,
      bodyRows: createRows(8),
      controlRows: [],
      footerRows: mapLinesToRows(["Press Esc to close."]),
      headerRows: mapLinesToRows(["Header"]),
      maxDisplayRows: 8,
      scrollMode: {
        kind: "offset",
        offset: Number.POSITIVE_INFINITY,
      },
    });

    const appendedState = resolveReadonlyViewportState({
      bodyAnchorRowIndex: null,
      bodyAnchorRowRange: null,
      bodyRows: createRows(10),
      controlRows: [],
      footerRows: mapLinesToRows(["Press Esc to close."]),
      headerRows: mapLinesToRows(["Header"]),
      maxDisplayRows: 8,
      scrollMode: {
        kind: "offset",
        offset: Number.POSITIVE_INFINITY,
      },
    });

    expect(initialState.offset).toBe(initialState.maxOffset);
    expect(appendedState.offset).toBe(appendedState.maxOffset);
  });

  it("clamps the offset when content shrinks", () => {
    const state = resolveReadonlyViewportState({
      bodyAnchorRowIndex: null,
      bodyAnchorRowRange: null,
      bodyRows: createRows(3),
      controlRows: [],
      footerRows: mapLinesToRows(["Press Esc to close."]),
      headerRows: mapLinesToRows(["Header"]),
      maxDisplayRows: 8,
      scrollMode: {
        kind: "offset",
        offset: 5,
      },
    });

    expect(state.offset).toBe(state.maxOffset);
    expect(state.maxOffset).toBe(0);
  });

  it("keeps overflow hints and scroll controls in the runtime footer", () => {
    const state = resolveReadonlyViewportState({
      bodyAnchorRowIndex: null,
      bodyAnchorRowRange: null,
      bodyRows: createRows(10),
      controlRows: [],
      footerRows: mapLinesToRows(["Press Esc to close."]),
      headerRows: mapLinesToRows(["Header"]),
      maxDisplayRows: 8,
      runtimeFooter: {
        alwaysShowScrollHint: true,
      },
      scrollMode: {
        kind: "offset",
        offset: 2,
      },
    });

    expect(state.footerLines).toContain(READONLY_VIEWPORT_SCROLL_HINT_LINE);
    expect(state.footerLines.some((line) => line.includes("more"))).toBe(true);
  });
});

describe("resolveNextReadonlyViewportOffset", () => {
  it("supports page and edge navigation math", () => {
    const pageDownOffset = resolveNextReadonlyViewportOffset({
      canScroll: true,
      currentOffset: 2,
      data: "\u001B[6~",
      maxOffset: 10,
      visibleBodyRowCount: 3,
    });
    const homeOffset = resolveNextReadonlyViewportOffset({
      canScroll: true,
      currentOffset: pageDownOffset,
      data: "\u001B[H",
      maxOffset: 10,
      visibleBodyRowCount: 3,
    });
    const endOffset = resolveNextReadonlyViewportOffset({
      canScroll: true,
      currentOffset: homeOffset,
      data: "\u001B[F",
      maxOffset: 10,
      visibleBodyRowCount: 3,
    });

    expect(pageDownOffset).toBe(5);
    expect(homeOffset).toBe(0);
    expect(endOffset).toBe(10);
  });
});

function createRows(count: number): ReadonlyViewportRow[] {
  return Array.from({ length: count }, (_, index) => ({
    text: `Row ${index + 1}`,
  }));
}

function mapLinesToRows(lines: readonly string[]): ReadonlyViewportRow[] {
  return lines.map((text) => ({ text }));
}
