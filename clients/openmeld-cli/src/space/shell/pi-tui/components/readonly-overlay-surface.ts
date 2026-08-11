import { stripVTControlCharacters } from "node:util";
import { Box, Text } from "@mariozechner/pi-tui";
import wrapAnsi from "wrap-ansi";
import type { SpacePanelSurfaceVariant } from "../../../panel/space-panel-definition";
import { spacePiTuiTheme } from "../theme";
import {
  type ReadonlyViewportRow,
  type ReadonlyViewportScrollMode,
  type ReadonlyViewportState,
  resolveReadonlyViewportState,
} from "./readonly-viewport";

const PANEL_HORIZONTAL_PADDING = 2;
const PANEL_VERTICAL_PADDING = 0;
const PANEL_BORDER_BOTTOM = 1;
const PANEL_BORDER_LEFT = 1;
const PANEL_BORDER_RIGHT = 1;
const PANEL_BORDER_TOP = 1;

export type ReadonlyOverlayChrome = {
  borderBgFn: (text: string) => string;
  surfaceBox: Box;
  text: Text;
};

export type ReadonlyOverlaySections = {
  bodyLines: readonly string[];
  controlLines: readonly string[];
  footerLines: readonly string[];
  headerLines: readonly string[];
};

export type ReadonlyOverlayViewportSections<
  Row extends ReadonlyViewportRow = ReadonlyViewportRow,
> = {
  bodyAnchorRowIndex: number | null;
  bodyAnchorRowRange: { end: number; start: number } | null;
  bodyRows: readonly Row[];
  controlRows: readonly Row[];
  footerRows: readonly Row[];
  headerRows: readonly Row[];
};

export type ReadonlyOverlayRenderResult<
  Row extends ReadonlyViewportRow = ReadonlyViewportRow,
> = {
  contentWidth: number;
  renderedLines: readonly string[];
  sections: ReadonlyOverlayViewportSections<Row>;
  viewportState: ReadonlyViewportState;
};

export function createReadonlyOverlayChrome(
  surfaceVariant: SpacePanelSurfaceVariant = "light"
): ReadonlyOverlayChrome {
  const surfaceBox = new Box(
    PANEL_HORIZONTAL_PADDING,
    PANEL_VERTICAL_PADDING,
    (width) => spacePiTuiTheme.resolvePanelSurfaceBg(surfaceVariant)(width)
  );
  const text = new Text("", 0, 0);
  surfaceBox.addChild(text);
  return {
    borderBgFn: spacePiTuiTheme.resolvePanelBorderBg(surfaceVariant),
    surfaceBox,
    text,
  };
}

export function syncReadonlyOverlayChrome(
  chrome: ReadonlyOverlayChrome,
  surfaceVariant: SpacePanelSurfaceVariant
): void {
  chrome.borderBgFn = spacePiTuiTheme.resolvePanelBorderBg(surfaceVariant);
  chrome.surfaceBox.setBgFn(
    spacePiTuiTheme.resolvePanelSurfaceBg(surfaceVariant)
  );
}

export function renderReadonlyOverlayChrome(
  chrome: ReadonlyOverlayChrome,
  width: number
): string[] {
  const surfaceWidth = Math.max(
    1,
    width - PANEL_BORDER_LEFT - PANEL_BORDER_RIGHT
  );
  const surfaceLines = chrome.surfaceBox.render(surfaceWidth);
  const leftBorder = chrome.borderBgFn(" ".repeat(PANEL_BORDER_LEFT));
  const rightBorder = chrome.borderBgFn(" ".repeat(PANEL_BORDER_RIGHT));
  const renderedLines: string[] = [];

  for (let index = 0; index < PANEL_BORDER_TOP; index += 1) {
    renderedLines.push(chrome.borderBgFn(" ".repeat(width)));
  }

  for (const line of surfaceLines) {
    renderedLines.push(`${leftBorder}${line}${rightBorder}`);
  }

  for (let index = 0; index < PANEL_BORDER_BOTTOM; index += 1) {
    renderedLines.push(chrome.borderBgFn(" ".repeat(width)));
  }

  return renderedLines;
}

export function buildReadonlyOverlayText(input: {
  sections: ReadonlyOverlaySections;
  surfaceVariant: SpacePanelSurfaceVariant;
  title: string;
}): string[] {
  const renderedLines: string[] = [];
  const { bodyLines, controlLines, footerLines, headerLines } = input.sections;

  appendRenderedSection({
    lines: headerLines,
    renderedLines,
    surfaceVariant: input.surfaceVariant,
    title: input.title,
    tone: "primary",
    useAccentTitle: true,
  });
  appendSectionGap({
    nextLines: controlLines,
    previousLines: headerLines,
    renderedLines,
    surfaceVariant: input.surfaceVariant,
  });
  appendRenderedSection({
    lines: controlLines,
    renderedLines,
    surfaceVariant: input.surfaceVariant,
    title: input.title,
    tone: "primary",
    useAccentTitle: false,
  });
  appendSectionGap({
    nextLines: bodyLines,
    previousLines: controlLines.length > 0 ? controlLines : headerLines,
    renderedLines,
    surfaceVariant: input.surfaceVariant,
  });
  appendRenderedSection({
    lines: bodyLines,
    renderedLines,
    surfaceVariant: input.surfaceVariant,
    title: input.title,
    tone: "primary",
    useAccentTitle: false,
  });

  let footerPreviousLines = headerLines;
  if (controlLines.length > 0) {
    footerPreviousLines = controlLines;
  }
  if (bodyLines.length > 0) {
    footerPreviousLines = bodyLines;
  }
  appendSectionGap({
    nextLines: footerLines,
    previousLines: footerPreviousLines,
    renderedLines,
    surfaceVariant: input.surfaceVariant,
  });
  appendRenderedSection({
    lines: footerLines,
    renderedLines,
    surfaceVariant: input.surfaceVariant,
    title: input.title,
    tone: "instruction",
    useAccentTitle: false,
  });

  return renderedLines;
}

export function resolveReadonlyOverlayContentWidth(width: number): number {
  const availableWidth = Math.max(
    1,
    width - PANEL_BORDER_LEFT - PANEL_BORDER_RIGHT
  );
  return Math.max(1, availableWidth - PANEL_HORIZONTAL_PADDING * 2);
}

export function resolveReadonlyOverlayMaxDisplayRows(
  maxPanelRows: number
): number {
  return Math.max(
    1,
    maxPanelRows -
      PANEL_VERTICAL_PADDING * 2 -
      PANEL_BORDER_TOP -
      PANEL_BORDER_BOTTOM
  );
}

export function wrapReadonlyViewportRows<
  Row extends ReadonlyViewportRow = ReadonlyViewportRow,
>(input: {
  contentWidth: number;
  lines: readonly string[];
  mapRow: (text: string, sourceLineIndex: number) => Row;
}): Row[] {
  const width = Math.max(1, input.contentWidth);

  return input.lines.flatMap((line, sourceLineIndex) => {
    const wrapped = wrapAnsi(line, width, {
      hard: true,
      trim: false,
      wordWrap: true,
    });
    const wrappedLines = wrapped.length > 0 ? wrapped.split("\n") : [""];

    return wrappedLines.map((text) => input.mapRow(text, sourceLineIndex));
  });
}

export function buildReadonlyOverlayRenderResult<
  Row extends ReadonlyViewportRow = ReadonlyViewportRow,
>(input: {
  maxPanelRows: number;
  resolveSections: (
    contentWidth: number
  ) => ReadonlyOverlayViewportSections<Row>;
  runtimeFooter?: {
    alwaysShowScrollHint?: boolean;
    scrollHintLine?: string;
    wrapLines?: (
      lines: readonly string[],
      contentWidth: number
    ) => readonly ReadonlyViewportRow[];
  };
  scrollMode: ReadonlyViewportScrollMode;
  surfaceVariant: SpacePanelSurfaceVariant;
  title: string;
  width: number;
}): ReadonlyOverlayRenderResult<Row> {
  const contentWidth = resolveReadonlyOverlayContentWidth(input.width);
  const sections = input.resolveSections(contentWidth);
  const viewportState = resolveReadonlyViewportState({
    bodyAnchorRowIndex: sections.bodyAnchorRowIndex,
    bodyAnchorRowRange: sections.bodyAnchorRowRange,
    bodyRows: sections.bodyRows,
    controlRows: sections.controlRows,
    footerRows: sections.footerRows,
    headerRows: sections.headerRows,
    maxDisplayRows: resolveReadonlyOverlayMaxDisplayRows(input.maxPanelRows),
    runtimeFooter: input.runtimeFooter
      ? {
          ...input.runtimeFooter,
          wrapLines: input.runtimeFooter.wrapLines
            ? (lines) =>
                input.runtimeFooter?.wrapLines?.(lines, contentWidth) ?? []
            : undefined,
        }
      : undefined,
    scrollMode: input.scrollMode,
  });
  const renderedLines = buildReadonlyOverlayText({
    sections: {
      bodyLines: viewportState.visibleBodyLines,
      controlLines: sections.controlRows.map((row) => row.text),
      footerLines: viewportState.footerLines,
      headerLines: sections.headerRows.map((row) => row.text),
    },
    surfaceVariant: input.surfaceVariant,
    title: input.title,
  });

  return {
    contentWidth,
    renderedLines,
    sections,
    viewportState,
  };
}

function appendSectionGap(input: {
  nextLines: readonly string[];
  previousLines: readonly string[];
  renderedLines: string[];
  surfaceVariant: SpacePanelSurfaceVariant;
}): void {
  if (input.previousLines.length === 0 || input.nextLines.length === 0) {
    return;
  }

  input.renderedLines.push(
    renderOverlayTextLine({
      line: "",
      surfaceVariant: input.surfaceVariant,
      tone: "primary",
    })
  );
}

function appendRenderedSection(input: {
  lines: readonly string[];
  renderedLines: string[];
  surfaceVariant: SpacePanelSurfaceVariant;
  title: string;
  tone: "accent" | "instruction" | "primary" | "secondary";
  useAccentTitle: boolean;
}): void {
  for (const line of input.lines) {
    const plainLine = stripVTControlCharacters(line).trim();
    const tone =
      input.useAccentTitle &&
      input.title.trim() &&
      plainLine.startsWith(input.title.trim())
        ? "accent"
        : input.tone;
    input.renderedLines.push(
      renderOverlayTextLine({
        line,
        surfaceVariant: input.surfaceVariant,
        tone,
      })
    );
  }
}

function renderOverlayTextLine(input: {
  line: string;
  surfaceVariant: SpacePanelSurfaceVariant;
  tone: "accent" | "instruction" | "primary" | "secondary";
}): string {
  return spacePiTuiTheme.renderPanelTextLine({
    surfaceVariant: input.surfaceVariant,
    text: input.line,
    tone: input.tone,
  });
}
