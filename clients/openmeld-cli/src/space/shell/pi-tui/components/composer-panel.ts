import {
  type Component,
  Container,
  type Editor,
  type EditorTheme,
  type TUI,
} from "@mariozechner/pi-tui";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import {
  OPENMELD_COMPOSER_SURFACE_BG_RGB,
  renderOpenMeldBrandAccent,
} from "../../../../ui/brand";
import { renderTextInputCursor } from "../../../../ui/text-input-cursor";
import type { SpaceSummarySegmentViewState } from "../../../view/space-session-view-state";
import { createSpaceComposerEditor } from "../space-composer-editor";
import { renderSpaceSummaryLines } from "./render-space-summary-lines";

const COMPOSER_INPUT_BACKGROUND = `\u001B[48;2;${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[0])};${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[1])};${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[2])}m`;
const COMPOSER_INPUT_BACKGROUND_RESET = "\u001B[49m";
const COMPOSER_PLACEHOLDER_FOREGROUND = "\u001B[38;2;122;122;122m";
const COMPOSER_PLACEHOLDER_FOREGROUND_RESET = "\u001B[39m";
const COMPOSER_INPUT_PREFIX = " › ";
const COMPOSER_INPUT_CONTINUATION_PREFIX = "   ";
const COMPOSER_INPUT_PREFIX_WIDTH = stringWidth(COMPOSER_INPUT_PREFIX);
const COMPOSER_BORDER_PATTERN = /^─+$/u;
const COMPOSER_SCROLL_BORDER_PATTERN = /^─── [↑↓] \d+ more ─*$/u;
const COMPOSER_INPUT_VERTICAL_PADDING_LINES = 1;
const ANSI_SGR_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "g"
);

export class ComposerPanel implements Component {
  readonly #container = new Container();
  readonly editor: Editor;
  #helperText = "";
  #leadingBlankLines = 1;
  #placeholderText = "";
  #showPlaceholder = false;
  #summarySegments: readonly SpaceSummarySegmentViewState[] = [];
  #visible = true;

  constructor(tui: TUI, theme: EditorTheme) {
    this.editor = createSpaceComposerEditor(tui, theme, {
      paddingX: 0,
      autocompleteMaxVisible: 6,
    });
    this.#container.addChild(this.editor);
  }

  invalidate(): void {
    this.#container.invalidate();
  }

  setHelperText(text: string): void {
    if (this.#helperText === text) {
      return;
    }
    this.#helperText = text;
    this.#container.invalidate();
  }

  setLeadingBlankLines(count: number): void {
    const normalizedCount = Math.max(0, Math.trunc(count));
    if (this.#leadingBlankLines === normalizedCount) {
      return;
    }
    this.#leadingBlankLines = normalizedCount;
    this.#container.invalidate();
  }

  setPlaceholderText(text: string): void {
    if (this.#placeholderText === text) {
      return;
    }
    this.#placeholderText = text;
    this.#container.invalidate();
  }

  setShowPlaceholder(visible: boolean): void {
    if (this.#showPlaceholder === visible) {
      return;
    }
    this.#showPlaceholder = visible;
    this.#container.invalidate();
  }

  setSummarySegments(segments: readonly SpaceSummarySegmentViewState[]): void {
    this.#summarySegments = segments;
    this.#container.invalidate();
  }

  setVisible(visible: boolean): void {
    if (this.#visible === visible) {
      return;
    }
    this.#visible = visible;
    this.#container.invalidate();
  }

  render(width: number): string[] {
    if (!this.#visible) {
      return [];
    }
    const editorRenderWidth = Math.max(1, width - COMPOSER_INPUT_PREFIX_WIDTH);
    const composerLines = styleComposerEditorLines({
      lines: this.#container.render(editorRenderWidth),
      placeholderText: this.#placeholderText,
      showPlaceholder: this.#showPlaceholder,
      width,
    });
    return [
      ...Array.from({ length: this.#leadingBlankLines }, () => ""),
      ...renderComposerHelperLines(this.#helperText, width),
      ...composerLines,
      ...renderSpaceSummaryLines({
        segments: this.#summarySegments,
        tone: "muted",
        width,
      }),
    ];
  }
}

function renderComposerHelperLines(text: string, width: number): string[] {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return [];
  }
  const wrapped = wrapAnsi(normalizedText, Math.max(1, width), {
    hard: true,
    trim: false,
    wordWrap: true,
  });
  return wrapped.split("\n");
}

function styleComposerEditorLines(input: {
  lines: readonly string[];
  placeholderText: string;
  showPlaceholder: boolean;
  width: number;
}): string[] {
  const sections = splitComposerEditorRenderLines(input.lines);
  const bodyLines = sections.bodyLines.length > 0 ? sections.bodyLines : [""];
  const topPaddingLines = Array.from(
    { length: COMPOSER_INPUT_VERTICAL_PADDING_LINES },
    () => renderComposerInputPaddingLine(input.width)
  );
  const styledBodyLines = bodyLines.map((line, index) =>
    renderComposerInputLine({
      line,
      placeholderText: index === 0 ? input.placeholderText : "",
      width: input.width,
      prefix:
        index === 0
          ? COMPOSER_INPUT_PREFIX
          : COMPOSER_INPUT_CONTINUATION_PREFIX,
      showPlaceholder: index === 0 && input.showPlaceholder,
    })
  );
  const bottomPaddingLines = Array.from(
    { length: COMPOSER_INPUT_VERTICAL_PADDING_LINES },
    () => renderComposerInputPaddingLine(input.width)
  );
  const footerLines = sections.footerLines.map((line) =>
    indentComposerFooterLine(line, input.width)
  );
  return [
    ...topPaddingLines,
    ...styledBodyLines,
    ...bottomPaddingLines,
    ...footerLines,
  ];
}

function splitComposerEditorRenderLines(lines: readonly string[]): {
  bodyLines: readonly string[];
  footerLines: readonly string[];
} {
  const topBorderIndex = lines.findIndex(isComposerBorderLine);
  const bottomBorderIndex = findLastComposerBorderLineIndex(lines);
  if (topBorderIndex === -1 || bottomBorderIndex <= topBorderIndex) {
    return {
      bodyLines: [...lines],
      footerLines: [],
    };
  }
  return {
    bodyLines: lines.slice(topBorderIndex + 1, bottomBorderIndex),
    footerLines: lines.slice(bottomBorderIndex + 1),
  };
}

function findLastComposerBorderLineIndex(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isComposerBorderLine(lines[index] ?? "")) {
      return index;
    }
  }
  return -1;
}

function isComposerBorderLine(line: string): boolean {
  const normalized = line.replaceAll(ANSI_SGR_PATTERN, "").trim();
  return (
    COMPOSER_BORDER_PATTERN.test(normalized) ||
    COMPOSER_SCROLL_BORDER_PATTERN.test(normalized)
  );
}

function renderComposerInputLine(input: {
  line: string;
  placeholderText: string;
  prefix: string;
  showPlaceholder: boolean;
  width: number;
}): string {
  const combinedLine =
    input.showPlaceholder && input.placeholderText
      ? renderComposerPlaceholderLine(input.prefix, input.placeholderText)
      : `${input.prefix}${input.line}`;
  const visibleWidth = stringWidth(combinedLine);
  const trailingPadding = " ".repeat(Math.max(0, input.width - visibleWidth));
  return applyComposerInputBackground(`${combinedLine}${trailingPadding}`);
}

function renderComposerInputPaddingLine(width: number): string {
  return applyComposerInputBackground(" ".repeat(Math.max(0, width)));
}

function applyComposerInputBackground(line: string): string {
  const normalizedLine = line.replaceAll(
    "\u001B[0m",
    `\u001B[0m${COMPOSER_INPUT_BACKGROUND}`
  );
  return `${COMPOSER_INPUT_BACKGROUND}${normalizedLine}${COMPOSER_INPUT_BACKGROUND_RESET}`;
}

function indentComposerFooterLine(line: string, width: number): string {
  const indentedLine = `${COMPOSER_INPUT_CONTINUATION_PREFIX}${line}`;
  const visibleWidth = stringWidth(indentedLine);
  return `${indentedLine}${" ".repeat(Math.max(0, width - visibleWidth))}`;
}

function renderComposerPlaceholderLine(
  prefix: string,
  placeholderText: string
): string {
  return `${renderOpenMeldBrandAccent(prefix)}${renderTextInputCursor()}${COMPOSER_PLACEHOLDER_FOREGROUND} ${placeholderText}${COMPOSER_PLACEHOLDER_FOREGROUND_RESET}`;
}
