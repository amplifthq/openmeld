import pc from "picocolors";
import stringWidth from "string-width";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";

const DEFAULT_SPINNER_DELAY_MS = 250;
const SPINNER_FRAME_INTERVAL_MS = 80;
const SPINNER_DECORATION_VISIBLE_WIDTH = 3;
const SPINNER_FRAMES = ["◒", "◐", "◓", "◑"] as const;
const CLEAR_CURRENT_TERMINAL_LINE = "\r\x1B[2K";
const TRUNCATED_SPINNER_MESSAGE_MARKER = "…";

export type DelayedSpinner = {
  start: () => void;
  complete: () => void;
  fail: () => void;
  message: (message: string) => void;
};

type DelayedSpinnerOutput = {
  columns?: number;
  isTTY?: boolean;
  write: (chunk: string) => unknown;
};

export function createDelayedSpinner(input: {
  enabled: boolean;
  message: string;
  delayMs?: number;
  isTTY?: boolean;
  columns?: number;
  output?: DelayedSpinnerOutput;
}): DelayedSpinner {
  const output = input.output ?? {
    columns: process.stdout.columns,
    isTTY: process.stdout.isTTY,
    write: (chunk: string) => process.stdout.write(chunk),
  };
  const terminalColumns = resolveSpinnerTerminalColumns(
    input.columns ?? output.columns
  );
  const shouldRender =
    input.enabled === true &&
    (input.isTTY ?? output.isTTY) === true &&
    terminalColumns !== null &&
    terminalColumns >= SPINNER_DECORATION_VISIBLE_WIDTH;
  if (!shouldRender) {
    return {
      start: () => undefined,
      complete: () => undefined,
      fail: () => undefined,
      message: () => undefined,
    };
  }

  const delayMs = input.delayMs ?? DEFAULT_SPINNER_DELAY_MS;
  let pendingTimer: NodeJS.Timeout | null = null;
  let frameTimer: NodeJS.Timeout | null = null;
  let frameIndex = 0;
  let spinnerVisible = false;
  let latestMessage = toSingleLineSpinnerMessage({
    message: input.message,
    terminalColumns,
  });

  const clearPendingTimer = (): void => {
    if (!pendingTimer) {
      return;
    }
    clearTimeout(pendingTimer);
    pendingTimer = null;
  };

  const clearFrameTimer = (): void => {
    if (!frameTimer) {
      return;
    }
    clearInterval(frameTimer);
    frameTimer = null;
  };

  const writeSpinnerLine = (line: string): void => {
    output.write(`${CLEAR_CURRENT_TERMINAL_LINE}${line}`);
  };

  const clearSpinnerLine = (): void => {
    output.write(CLEAR_CURRENT_TERMINAL_LINE);
  };

  const renderFrame = (): void => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    frameIndex += 1;
    writeSpinnerLine(`${pc.magenta(frame)}  ${latestMessage}`);
  };

  const ensureSpinnerStarted = (): void => {
    if (spinnerVisible || pendingTimer) {
      return;
    }
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      spinnerVisible = true;
      renderFrame();
      frameTimer = setInterval(renderFrame, SPINNER_FRAME_INTERVAL_MS);
    }, delayMs);
  };

  const stopSpinner = (): void => {
    clearPendingTimer();
    if (!spinnerVisible) {
      return;
    }
    spinnerVisible = false;
    clearFrameTimer();
    clearSpinnerLine();
  };

  return {
    start: () => {
      ensureSpinnerStarted();
    },
    complete: () => {
      stopSpinner();
    },
    fail: () => {
      stopSpinner();
    },
    message: (message) => {
      latestMessage = toSingleLineSpinnerMessage({
        message,
        terminalColumns,
      });
      if (spinnerVisible) {
        renderFrame();
      }
    },
  };
}

function resolveSpinnerTerminalColumns(
  columns: number | undefined
): number | null {
  if (
    typeof columns !== "number" ||
    !Number.isInteger(columns) ||
    columns < 1
  ) {
    return null;
  }
  return columns;
}

function toSingleLineSpinnerMessage(input: {
  message: string;
  terminalColumns: number;
}): string {
  const maxMessageWidth =
    input.terminalColumns - SPINNER_DECORATION_VISIBLE_WIDTH;
  if (maxMessageWidth < 1) {
    return "";
  }

  const message = sanitizeTerminalDisplayText(
    input.message,
    "single-line"
  ).trim();
  return truncateVisibleText(message, maxMessageWidth);
}

function truncateVisibleText(value: string, maxWidth: number): string {
  if (stringWidth(value) <= maxWidth) {
    return value;
  }

  const markerWidth = stringWidth(TRUNCATED_SPINNER_MESSAGE_MARKER);
  if (maxWidth <= markerWidth) {
    return TRUNCATED_SPINNER_MESSAGE_MARKER;
  }

  const targetWidth = maxWidth - markerWidth;
  let result = "";
  let resultWidth = 0;
  for (const char of value) {
    const charWidth = stringWidth(char);
    if (resultWidth + charWidth > targetWidth) {
      break;
    }
    result += char;
    resultWidth += charWidth;
  }

  return `${result.trimEnd()}${TRUNCATED_SPINNER_MESSAGE_MARKER}`;
}
