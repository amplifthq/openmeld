import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import stringWidth from "string-width";
import { renderPositiveAccentText } from "../../ui/positive-accent";
import { renderTextInputCursor } from "../../ui/text-input-cursor";
import type {
  PanelBodyBlockViewState,
  PanelFactItemViewState,
  PanelViewState,
  SearchablePanelItemViewState,
} from "../view/space-session-view-state";
import { formatPanelInstructionsLine } from "./space-panel-definition";

const PANEL_COLUMN_GAP = 4;
const PANEL_TWO_COLUMN_MIN_WIDTH = 88;
const WHITESPACE_SPLIT_REGEX = /\s+/u;

export type PanelDisplaySections = {
  bodyAnchorLineIndex: number | null;
  bodyItemAnchors: readonly PanelDisplayBodyItemAnchor[];
  bodyLines: readonly string[];
  controlLines: readonly string[];
  footerLines: readonly string[];
  headerLines: readonly string[];
};

export type PanelDisplayBodyItemAnchor = {
  id: string;
  lineIndex: number;
};

export function buildPanelDisplayLines(input: {
  includeControls?: boolean;
  panel: PanelViewState;
  contentWidth?: number;
}): string[] {
  return joinPanelDisplaySections(
    buildPanelDisplaySections({
      contentWidth: input.contentWidth,
      includeControls: input.includeControls,
      panel: input.panel,
    })
  );
}

export function buildPanelDisplaySections(input: {
  includeControls?: boolean;
  panel: PanelViewState;
  contentWidth?: number;
}): PanelDisplaySections {
  const contentWidth = input.contentWidth ?? 0;
  const title = input.panel.title.trim();
  const headerMetaText = input.panel.headerMetaText?.trim() ?? "";
  const includeControls = input.includeControls ?? true;
  const searchableDisplay =
    input.panel.mode === "searchable_list" && includeControls
      ? renderSearchablePanelDisplay(input.panel.searchableList)
      : null;
  const controlLines =
    searchableDisplay?.controlLines ??
    (input.panel.mode === "searchable_list" && includeControls
      ? buildSearchableControlLines(input.panel.searchableList)
      : []);
  const bodyLines = alignPanelBodyLines(
    searchableDisplay?.bodyLines ??
      renderPanelBodyBlocks(input.panel.body.blocks, contentWidth),
    contentWidth,
    input.panel.contentAlign
  );
  const instructionLine = renderPanelInstructionText(input.panel);
  return {
    bodyAnchorLineIndex: searchableDisplay?.activeLineIndex ?? null,
    bodyItemAnchors: searchableDisplay?.itemAnchors ?? [],
    bodyLines,
    controlLines,
    footerLines: instructionLine ? [instructionLine] : [],
    headerLines: buildPanelHeaderLines({
      contentWidth,
      headerMetaText,
      title,
    }),
  };
}

function renderPanelInstructionText(panel: PanelViewState): string {
  const instructionLine = formatPanelInstructionsLine(panel.instructions);
  if (!instructionLine) {
    return "";
  }
  const closeInstruction = `${pc.dim("Press ")}Esc${pc.dim(" to close.")}`;
  if (panel.mode === "searchable_list") {
    return `${closeInstruction}${pc.dim(" Type to search.")}`;
  }
  return closeInstruction;
}

export function formatPanelOverflowHintLine(input: {
  hiddenAfter: number;
  hiddenBefore: number;
}): string | null {
  if (input.hiddenBefore === 0 && input.hiddenAfter === 0) {
    return null;
  }

  const parts: string[] = [];
  if (input.hiddenBefore > 0) {
    parts.push(
      renderPositiveAccentText(`↑ ${String(input.hiddenBefore)} more`)
    );
  }
  if (input.hiddenAfter > 0) {
    parts.push(renderPositiveAccentText(`↓ ${String(input.hiddenAfter)} more`));
  }
  return parts.join(pc.dim(" · "));
}

export function joinPanelDisplaySections(
  sections: PanelDisplaySections
): string[] {
  const renderedSections = [
    [...sections.headerLines],
    [...sections.controlLines],
    [...sections.bodyLines],
    [...sections.footerLines],
  ].filter((lines) => lines.length > 0);

  return renderedSections.flatMap((lines, index) => {
    if (index === 0) {
      return lines;
    }
    return ["", ...lines];
  });
}

function alignPanelBodyLines(
  lines: readonly string[],
  width: number,
  contentAlign: PanelViewState["contentAlign"]
): string[] {
  if (contentAlign !== "centered_block" || lines.length === 0) {
    return [...lines];
  }

  const blockWidth = lines.reduce((maxWidth, line) => {
    return Math.max(maxWidth, stringWidth(line));
  }, 0);
  const leftPadding = Math.max(0, Math.floor((width - blockWidth) / 2));
  const padding = " ".repeat(leftPadding);

  return lines.map((line) => {
    if (!line.trim()) {
      return line;
    }
    return `${padding}${line}`;
  });
}

function buildPanelHeaderLines(input: {
  contentWidth: number;
  headerMetaText: string;
  title: string;
}): string[] {
  if (!(input.title || input.headerMetaText)) {
    return [];
  }

  if (!input.title) {
    return [pc.dim(input.headerMetaText)];
  }

  if (!input.headerMetaText) {
    return [input.title];
  }

  const titleWidth = stringWidth(stripVTControlCharacters(input.title));
  const headerMetaWidth = stringWidth(input.headerMetaText);
  const minimumGapWidth = 2;

  if (
    input.contentWidth > 0 &&
    titleWidth + minimumGapWidth + headerMetaWidth <= input.contentWidth
  ) {
    const gapWidth = Math.max(
      minimumGapWidth,
      input.contentWidth - titleWidth - headerMetaWidth
    );
    return [
      `${input.title}${" ".repeat(gapWidth)}${pc.dim(input.headerMetaText)}`,
    ];
  }

  if (input.contentWidth > 0) {
    return [
      input.title,
      padVisibleStart(pc.dim(input.headerMetaText), input.contentWidth),
    ];
  }

  return [input.title, pc.dim(input.headerMetaText)];
}

function renderPanelBodyBlocks(
  blocks: readonly PanelBodyBlockViewState[],
  contentWidth: number
): string[] {
  const renderedBlocks = blocks
    .map((block) => renderPanelBodyBlock(block, contentWidth))
    .filter((lines) => lines.length > 0);

  return renderedBlocks.flatMap((lines, index) => {
    if (index === 0) {
      return lines;
    }
    return ["", ...lines];
  });
}

function renderPanelBodyBlock(
  block: PanelBodyBlockViewState,
  contentWidth: number
): string[] {
  switch (block.kind) {
    case "facts":
      return renderFactsBlock(block.items, contentWidth);
    case "lines":
      return [...block.lines];
    default:
      return assertUnreachable(block);
  }
}

function buildSearchableControlLines(
  searchableList: PanelViewState["searchableList"]
): string[] {
  if (!searchableList) {
    return [];
  }

  const controlLabel = pc.dim(searchableList.control.label);
  const controlValue = renderSearchableControlValue(searchableList.control);
  return [`${controlLabel}  ${controlValue}`];
}

function renderSearchableControlValue(
  control: NonNullable<PanelViewState["searchableList"]>["control"]
): string {
  if (control.query.length > 0) {
    return `${control.query}${renderTextInputCursor()}`;
  }
  return `${renderTextInputCursor()} ${pc.dim(control.placeholder)}`;
}

function renderSearchablePanelDisplay(
  searchableList: PanelViewState["searchableList"]
): {
  activeLineIndex: number | null;
  bodyLines: readonly string[];
  controlLines: readonly string[];
  itemAnchors: readonly PanelDisplayBodyItemAnchor[];
} | null {
  if (!searchableList) {
    return null;
  }

  const itemAnchors: PanelDisplayBodyItemAnchor[] = [];
  const lines: string[] = [];
  const sections = searchableList.sections.filter(
    (section) => section.items.length > 0
  );

  if (sections.length === 0) {
    return {
      activeLineIndex: null,
      bodyLines: searchableList.emptyLines,
      controlLines: buildSearchableControlLines(searchableList),
      itemAnchors: [],
    };
  }

  let activeLineIndex: number | null = null;
  for (const [sectionIndex, section] of sections.entries()) {
    if (sectionIndex > 0) {
      lines.push("");
    }
    if (section.title) {
      lines.push(pc.bold(section.title));
    }

    for (const item of section.items) {
      const itemLineIndex = lines.length;
      itemAnchors.push({
        id: item.id,
        lineIndex: itemLineIndex,
      });
      if (item.id === searchableList.activeItemId && activeLineIndex === null) {
        activeLineIndex = itemLineIndex;
      }
      lines.push(
        ...renderSearchablePanelItemLines(
          item,
          item.id === searchableList.activeItemId
        )
      );
    }
  }

  return {
    activeLineIndex,
    bodyLines: lines,
    controlLines: buildSearchableControlLines(searchableList),
    itemAnchors,
  };
}

function renderSearchablePanelItemLines(
  item: SearchablePanelItemViewState,
  active: boolean
): string[] {
  return item.lines.map((line, lineIndex) => {
    let prefix = "  ";
    if (lineIndex === 0) {
      prefix = active ? pc.cyan("❯ ") : "  ";
    }
    return `${prefix}${line}`;
  });
}

function renderFactsBlock(
  items: readonly PanelFactItemViewState[],
  contentWidth: number
): string[] {
  const fullWidthFacts = items.filter((item) => item.span === "full");
  const columnFacts = items.filter((item) => item.span === "column");
  const lines: string[] = [];

  for (const item of fullWidthFacts) {
    lines.push(renderInlineFact(item));
  }

  if (fullWidthFacts.length > 0 && columnFacts.length > 0) {
    lines.push("");
  }

  if (columnFacts.length > 0) {
    lines.push(...renderColumnFacts(columnFacts, contentWidth));
  }

  return lines;
}

function renderInlineFact(item: PanelFactItemViewState): string {
  return `${pc.dim(item.label)}  ${item.value}`;
}

function renderColumnFacts(
  items: readonly PanelFactItemViewState[],
  contentWidth: number
): string[] {
  if (contentWidth < PANEL_TWO_COLUMN_MIN_WIDTH) {
    return renderStackedFacts(items);
  }

  const columnWidth = Math.max(
    1,
    Math.floor((contentWidth - PANEL_COLUMN_GAP) / 2)
  );
  const lines: string[] = [];

  for (let index = 0; index < items.length; index += 2) {
    const left = items[index];
    if (!left) {
      continue;
    }
    const right = items[index + 1];
    const leftLines = buildFactCellLines(left, columnWidth);
    const rightLines = right ? buildFactCellLines(right, columnWidth) : [];
    const rowHeight = Math.max(leftLines.length, rightLines.length);

    for (let lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
      const leftLine = leftLines[lineIndex] ?? "";
      if (!right) {
        lines.push(leftLine);
        continue;
      }
      const rightLine = rightLines[lineIndex] ?? "";
      lines.push(
        `${padVisibleEnd(leftLine, columnWidth)}${" ".repeat(
          PANEL_COLUMN_GAP
        )}${rightLine}`
      );
    }

    if (index + 2 < items.length) {
      lines.push("");
    }
  }

  return lines;
}

function renderStackedFacts(
  items: readonly PanelFactItemViewState[]
): string[] {
  const lines: string[] = [];

  for (const [index, item] of items.entries()) {
    lines.push(pc.dim(item.label));
    lines.push(item.value);
    if (index < items.length - 1) {
      lines.push("");
    }
  }

  return lines;
}

function buildFactCellLines(
  item: PanelFactItemViewState,
  width: number
): string[] {
  return [pc.dim(item.label), ...wrapText(item.value, width)];
}

function wrapText(value: string, width: number): string[] {
  const normalized = value.trim();
  if (!normalized) {
    return [""];
  }

  const words = normalized.split(WHITESPACE_SPLIT_REGEX);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const wordWidth = stringWidth(word);
    if (wordWidth > width) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      lines.push(...splitLongToken(word, width));
      continue;
    }

    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (stringWidth(nextLine) <= width) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [normalized];
}

function splitLongToken(value: string, width: number): string[] {
  const segments: string[] = [];
  let currentSegment = "";

  for (const character of Array.from(value)) {
    const nextSegment = `${currentSegment}${character}`;
    if (stringWidth(nextSegment) <= width) {
      currentSegment = nextSegment;
      continue;
    }

    if (currentSegment) {
      segments.push(currentSegment);
    }
    currentSegment = character;
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

function padVisibleEnd(value: string, width: number): string {
  const visibleWidth = stringWidth(stripVTControlCharacters(value));
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth))}`;
}

function padVisibleStart(value: string, width: number): string {
  const visibleWidth = stringWidth(stripVTControlCharacters(value));
  return `${" ".repeat(Math.max(0, width - visibleWidth))}${value}`;
}

function assertUnreachable(value: never): never {
  throw new Error(`Unknown panel body block: ${JSON.stringify(value)}`);
}
