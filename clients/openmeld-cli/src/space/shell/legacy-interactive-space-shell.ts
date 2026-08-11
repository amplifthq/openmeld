import {
  clearLine,
  createInterface,
  cursorTo,
  moveCursor,
} from "node:readline";
import pc from "picocolors";
import stringWidth from "string-width";
import type { SpaceTranscriptItem } from "../state/space-screen-state";
import type { SpaceSessionViewState } from "../view/space-session-view-state";
import type { InteractiveSpaceShell } from "./interactive-space-shell";

const REPLYING_STATUS_PROMPT_GAP_LINES = 1;
const CHAT_GROUP_DIVIDER_MARGIN = 2;
const CHAT_GROUP_DIVIDER_MIN_WIDTH = 24;
const CHAT_GROUP_DIVIDER_MAX_WIDTH = 120;
const CHAT_GROUP_DIVIDER_CHAR = "╌";
const CHAT_GROUP_DIVIDER_SIDE_GAP_LINES = 1;

type LegacyInteractiveSpaceShellInput = {
  composePromptPrefix?: string;
  onLine: (line: string) => void;
  onClose: () => void;
};

export class LegacyInteractiveSpaceShell implements InteractiveSpaceShell {
  readonly #composePromptPrefix: string;
  readonly #onLine: (line: string) => void;
  readonly #onClose: () => void;

  #readline: ReturnType<typeof createInterface> | null = null;
  #lastRenderedTranscriptCount = 0;
  #hasPrintedTextLine = false;
  #lastPrintedTextLineGroupKey: string | null = null;
  #nextDividerGapPlacement: "top" | "bottom" = "top";
  #visibleOverlayLine = "";
  #visibleOverlayLineRows = 0;
  #latestViewState: SpaceSessionViewState | null = null;
  #composerVisible = true;

  constructor(input: LegacyInteractiveSpaceShellInput) {
    this.#composePromptPrefix = input.composePromptPrefix ?? pc.dim("[draft] ");
    this.#onLine = input.onLine;
    this.#onClose = input.onClose;
  }

  start(): void {
    if (this.#readline) {
      return;
    }
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdout.isTTY === true,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.#readline = readline;
    readline.on("line", (line) => {
      if (!this.#composerVisible) {
        if (line.trim() === "q") {
          this.#onClose();
        }
        return;
      }
      this.#onLine(line);
    });
    readline.on("close", () => {
      if (this.#readline === readline) {
        this.#readline = null;
      }
      this.#onClose();
    });
    if (this.#composerVisible) {
      readline.setPrompt(this.#resolvePrompt());
      readline.prompt();
    }
  }

  render(viewState: SpaceSessionViewState): void {
    this.#latestViewState = viewState;
    this.#composerVisible = viewState.composer.visible;
    this.#renderNewTranscriptItems(viewState.transcript.items);
    this.#syncOverlayLine(viewState.status.overlayLine);
    this.#refreshPrompt();
  }

  stop(): void {
    if (!this.#readline) {
      return;
    }
    const currentReadline = this.#readline;
    this.#readline = null;
    currentReadline.removeAllListeners("line");
    currentReadline.removeAllListeners("close");
    currentReadline.close();
  }

  clearSubmittedInputLine(line: string): void {
    if (!process.stdout.isTTY) {
      return;
    }
    this.#clearInteractiveOverlay({
      submittedInputText: line,
    });
  }

  prepareExternalWrite(): void {
    this.#clearInteractiveOverlay();
  }

  #renderNewTranscriptItems(items: readonly SpaceTranscriptItem[]): void {
    if (items.length <= this.#lastRenderedTranscriptCount) {
      return;
    }
    const nextItems = items.slice(this.#lastRenderedTranscriptCount);
    for (const item of nextItems) {
      this.#emitTranscriptItem(item);
    }
    this.#lastRenderedTranscriptCount = items.length;
  }

  #emitTranscriptItem(item: SpaceTranscriptItem): void {
    this.prepareExternalWrite();
    const isGroupBoundary =
      this.#hasPrintedTextLine &&
      this.#lastPrintedTextLineGroupKey !== item.groupKey;
    if (isGroupBoundary) {
      this.#emitTextGroupDivider();
    }
    process.stdout.write(`${item.line}\n`);
    this.#hasPrintedTextLine = true;
    this.#lastPrintedTextLineGroupKey = item.groupKey;
    if (item.refreshPrompt !== false && this.#readline) {
      process.stdout.write("\n");
    }
  }

  #emitTextGroupDivider(): void {
    const dividerLine = buildChatGroupDividerLine();
    if (!dividerLine) {
      process.stdout.write("\n");
      return;
    }
    const useTopGap = this.#nextDividerGapPlacement === "top";
    const topGapLines = useTopGap ? CHAT_GROUP_DIVIDER_SIDE_GAP_LINES : 0;
    const bottomGapLines = useTopGap ? 0 : CHAT_GROUP_DIVIDER_SIDE_GAP_LINES;
    process.stdout.write(
      `${"\n".repeat(topGapLines)}${dividerLine}\n${"\n".repeat(bottomGapLines)}`
    );
    this.#nextDividerGapPlacement = useTopGap ? "bottom" : "top";
  }

  #syncOverlayLine(nextOverlayLine: string): void {
    const normalizedText = nextOverlayLine.trim();
    if (!normalizedText) {
      this.#clearVisibleOverlayLine();
      return;
    }
    if (!(process.stdout.isTTY && this.#readline)) {
      return;
    }
    if (this.#visibleOverlayLine === normalizedText) {
      return;
    }
    if (this.#visibleOverlayLine.length > 0) {
      this.#clearVisibleOverlayLine();
    } else {
      this.prepareExternalWrite();
    }
    process.stdout.write(
      `${pc.dim(normalizedText)}${"\n".repeat(REPLYING_STATUS_PROMPT_GAP_LINES + 1)}`
    );
    this.#visibleOverlayLine = normalizedText;
    this.#visibleOverlayLineRows = countRenderedTerminalRows(normalizedText);
  }

  #clearVisibleOverlayLine(): void {
    if (!(process.stdout.isTTY && this.#readline)) {
      return;
    }
    if (this.#visibleOverlayLine.length === 0) {
      return;
    }
    this.#clearInteractiveOverlay({
      includeVisibleOverlayLine: true,
    });
  }

  #clearInteractiveOverlay(input?: {
    submittedInputText?: string;
    includeVisibleOverlayLine?: boolean;
  }): void {
    if (!(this.#readline && process.stdout.isTTY)) {
      return;
    }
    const promptRowsAboveCurrent =
      typeof input?.submittedInputText === "string"
        ? this.#countPromptDisplayRows(input.submittedInputText)
        : this.#resolvePromptCursorRows();
    const visibleOverlayRowsAbovePrompt =
      input?.includeVisibleOverlayLine === true &&
      this.#visibleOverlayLine.length > 0
        ? REPLYING_STATUS_PROMPT_GAP_LINES + this.#visibleOverlayLineRows
        : 0;
    const rowsAboveCurrent =
      promptRowsAboveCurrent + visibleOverlayRowsAbovePrompt;
    clearLine(process.stdout, 0);
    cursorTo(process.stdout, 0);
    for (let rowOffset = 0; rowOffset < rowsAboveCurrent; rowOffset += 1) {
      moveCursor(process.stdout, 0, -1);
      clearLine(process.stdout, 0);
      cursorTo(process.stdout, 0);
    }
    if (input?.includeVisibleOverlayLine === true) {
      this.#visibleOverlayLine = "";
      this.#visibleOverlayLineRows = 0;
    }
  }

  #resolvePrompt(): string {
    if (!this.#composerVisible) {
      return "";
    }
    const basePrompt = this.#latestViewState?.composer.basePrompt ?? "";
    if (this.#latestViewState?.composer.hasDraft) {
      return `${this.#composePromptPrefix}${basePrompt}`;
    }
    return basePrompt;
  }

  #refreshPrompt(): void {
    const readline = this.#readline;
    if (!readline) {
      return;
    }
    if (!this.#composerVisible) {
      return;
    }
    try {
      readline.setPrompt(this.#resolvePrompt());
      readline.prompt(true);
    } catch {
      this.#readline = null;
    }
  }

  #resolvePromptCursorRows(): number {
    if (!(this.#readline && process.stdout.isTTY)) {
      return 0;
    }
    try {
      const rows = this.#readline.getCursorPos().rows;
      return Number.isInteger(rows) && rows > 0 ? rows : 0;
    } catch {
      return 0;
    }
  }

  #countPromptDisplayRows(inputText: string): number {
    const columns = resolveTerminalColumns();
    const promptWidth = stringWidth(this.#resolvePrompt());
    const inputWidth = stringWidth(inputText);
    const totalWidth = Math.max(1, promptWidth + inputWidth);
    return Math.max(1, Math.ceil(totalWidth / columns));
  }
}

function countRenderedTerminalRows(text: string): number {
  const columns = resolveTerminalColumns();
  const renderedRows = text.split("\n").reduce((rowCount, line) => {
    return (
      rowCount +
      Math.max(1, Math.ceil(Math.max(1, stringWidth(line)) / columns))
    );
  }, 0);
  return Math.max(1, renderedRows);
}

function buildChatGroupDividerLine(): string {
  if (process.stdout.isTTY !== true) {
    return "";
  }
  const columns = resolveTerminalColumns();
  const width = clampNumber(
    columns - CHAT_GROUP_DIVIDER_MARGIN * 2,
    CHAT_GROUP_DIVIDER_MIN_WIDTH,
    CHAT_GROUP_DIVIDER_MAX_WIDTH
  );
  const margin = " ".repeat(CHAT_GROUP_DIVIDER_MARGIN);
  return pc.dim(pc.gray(`${margin}${CHAT_GROUP_DIVIDER_CHAR.repeat(width)}`));
}

function resolveTerminalColumns(): number {
  const rawColumns = process.stdout.columns;
  if (!Number.isInteger(rawColumns) || rawColumns < 1) {
    return 80;
  }
  return rawColumns;
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
