import { readSync } from "node:fs";
import type { Key } from "node:readline";
import stringWidth from "string-width";
import { isBinaryDistribution } from "../runtime/distribution";

const TERMINAL_READ_BUFFER_BYTES = 64;

export type InteractivePromptStatus = "active" | "submitted" | "cancelled";

// Interactive prompts default to the process std streams, but callers can pass
// an explicit terminal (e.g. /dev/tty) so a prompt can run even when stdin is
// redirected to /dev/null — as happens in the `curl | sh` setup bootstrap.
export type InteractivePromptStreams = {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
};

export type InteractivePromptKeypressResult<State, Result> =
  | { type: "state"; state: State }
  | {
      type: "result";
      result: Result;
      status: Exclude<InteractivePromptStatus, "active">;
      state?: State;
    }
  | { type: "ignore" };

export type InteractivePromptKeypressEvent = {
  key: Key;
  str: string | undefined;
};

export function isReturnKeypress(input: {
  str: string | undefined;
  key: Key;
}): boolean {
  return (
    input.key.name === "return" ||
    input.key.name === "enter" ||
    input.key.sequence === "\r" ||
    input.key.sequence === "\n" ||
    input.str === "\r" ||
    input.str === "\n"
  );
}

export function parseInteractivePromptInputData(
  chunk: Buffer | string | Uint8Array
): InteractivePromptKeypressEvent[] {
  const text =
    typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  const events: InteractivePromptKeypressEvent[] = [];
  let index = 0;

  while (index < text.length) {
    const parsed = parseNextInteractivePromptKeypress(text, index);
    events.push(parsed.event);
    index += parsed.length;
  }

  return events;
}

function parseNextInteractivePromptKeypress(
  text: string,
  index: number
): {
  event: InteractivePromptKeypressEvent;
  length: number;
} {
  const remaining = text.slice(index);
  return (
    parseAnsiEscapeKeypress(remaining) ??
    parseControlKeypress(text[index] ?? "") ??
    parsePrintableKeypress(text, index) ?? {
      event: {
        str: text[index],
        key: { sequence: text[index] },
      },
      length: 1,
    }
  );
}

function parseAnsiEscapeKeypress(input: string): {
  event: InteractivePromptKeypressEvent;
  length: number;
} | null {
  if (input.startsWith("\u001b[A")) {
    return {
      event: { str: undefined, key: { name: "up", sequence: "\u001b[A" } },
      length: 3,
    };
  }
  if (input.startsWith("\u001b[B")) {
    return {
      event: { str: undefined, key: { name: "down", sequence: "\u001b[B" } },
      length: 3,
    };
  }
  if (input.startsWith("\u001b[C")) {
    return {
      event: { str: undefined, key: { name: "right", sequence: "\u001b[C" } },
      length: 3,
    };
  }
  if (input.startsWith("\u001b[D")) {
    return {
      event: { str: undefined, key: { name: "left", sequence: "\u001b[D" } },
      length: 3,
    };
  }
  if (input.startsWith("\u001b[Z")) {
    return {
      event: {
        str: undefined,
        key: { name: "tab", sequence: "\u001b[Z", shift: true },
      },
      length: 3,
    };
  }
  if (input.startsWith("\u001b")) {
    return {
      event: { str: undefined, key: { name: "escape", sequence: "\u001b" } },
      length: 1,
    };
  }
  return null;
}

function parseControlKeypress(character: string): {
  event: InteractivePromptKeypressEvent;
  length: number;
} | null {
  const key = readControlKey(character);
  return key
    ? {
        event: {
          str: character,
          key,
        },
        length: 1,
      }
    : null;
}

function readControlKey(character: string): Key | null {
  if (character === "\u0003") {
    return { ctrl: true, name: "c", sequence: character };
  }
  if (character === "\u0015") {
    return { ctrl: true, name: "u", sequence: character };
  }
  if (character === "\r" || character === "\n") {
    return { name: "return", sequence: character };
  }
  if (character === "\u007f" || character === "\b") {
    return { name: "backspace", sequence: character };
  }
  if (character === "\t") {
    return { name: "tab", sequence: character };
  }
  if (character === " ") {
    return { name: "space", sequence: character };
  }
  return null;
}

function parsePrintableKeypress(
  text: string,
  index: number
): {
  event: InteractivePromptKeypressEvent;
  length: number;
} | null {
  const printableRun = readPrintableRun(text, index);
  return printableRun.length > 0
    ? {
        event: {
          str: printableRun,
          key: {
            name: printableRun.length === 1 ? printableRun : undefined,
            sequence: printableRun,
          },
        },
        length: printableRun.length,
      }
    : null;
}

function readPrintableRun(text: string, startIndex: number): string {
  let index = startIndex;
  while (index < text.length) {
    const charCode = text.charCodeAt(index);
    if (charCode < 0x21 || charCode > 0x7e) {
      break;
    }
    if (text[index] === "\u001b") {
      break;
    }
    index += 1;
  }
  return text.slice(startIndex, index);
}

export function resolveSynchronousTerminalInputFd(
  inputStream: NodeJS.ReadStream
): number | null {
  if (!isBinaryDistribution()) {
    return null;
  }
  const fd = (inputStream as { fd?: unknown }).fd;
  return typeof fd === "number" && Number.isInteger(fd) && fd >= 0 ? fd : null;
}

type RunInteractivePromptInput<State, Result> = {
  initialState: State;
  fallbackResult: Result;
  renderLines: (state: State, status: InteractivePromptStatus) => string[];
  handleKeypress: (input: {
    state: State;
    str: string | undefined;
    key: Key;
  }) => InteractivePromptKeypressResult<State, Result>;
};

export function runInteractivePrompt<State, Result>(
  input: RunInteractivePromptInput<State, Result>,
  streams?: InteractivePromptStreams
): Promise<Result> {
  // Keep wrap-aware prompt rendering in one place so every interactive prompt
  // clears the full terminal frame after line wrapping.
  const inputStream = streams?.input ?? process.stdin;
  const outputStream = streams?.output ?? process.stdout;
  if (
    inputStream.isTTY !== true ||
    outputStream.isTTY !== true ||
    typeof inputStream.setRawMode !== "function"
  ) {
    return Promise.resolve(input.fallbackResult);
  }

  return new Promise((resolve) => {
    let state = input.initialState;
    let lastRenderHeight = 0;
    let cleanedUp = false;
    const synchronousInputFd = resolveSynchronousTerminalInputFd(inputStream);

    inputStream.setRawMode(true);
    if (synchronousInputFd === null) {
      inputStream.resume();
    }

    const clearRender = () => {
      if (lastRenderHeight <= 0) {
        return;
      }
      outputStream.write(`\u001B[${String(lastRenderHeight)}A`);
      for (let index = 0; index < lastRenderHeight; index += 1) {
        outputStream.write("\u001B[2K\u001B[1B");
      }
      outputStream.write(`\u001B[${String(lastRenderHeight)}A`);
    };

    const render = (status: InteractivePromptStatus = "active") => {
      clearRender();
      const lines = input.renderLines(state, status);
      outputStream.write(`${lines.join("\n")}\n`);
      lastRenderHeight = measureRenderedTerminalLinesHeight(
        lines,
        outputStream.columns
      );
    };

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      if (synchronousInputFd === null) {
        inputStream.removeListener("data", onData);
        inputStream.pause();
      }
      inputStream.setRawMode(false);
    };

    const finish = (
      result: Result,
      status: Exclude<InteractivePromptStatus, "active">,
      nextState?: State
    ) => {
      if (nextState) {
        state = nextState;
      }
      render(status);
      cleanup();
      resolve(result);
    };

    const handleParsedKeypress = (str: string | undefined, key: Key) => {
      const keypressResult = input.handleKeypress({
        state,
        str,
        key,
      });
      if (keypressResult.type === "ignore") {
        return;
      }
      if (keypressResult.type === "result") {
        finish(
          keypressResult.result,
          keypressResult.status,
          keypressResult.state
        );
        return;
      }
      state = keypressResult.state;
      render();
    };

    const handleInputChunk = (chunk: Buffer | string | Uint8Array) => {
      for (const event of parseInteractivePromptInputData(chunk)) {
        handleParsedKeypress(event.str, event.key);
        if (cleanedUp) {
          return;
        }
      }
    };

    const onData = (chunk: Buffer | string) => {
      handleInputChunk(chunk);
    };

    const readSynchronouslyFromTerminal = () => {
      const buffer = Buffer.alloc(TERMINAL_READ_BUFFER_BYTES);
      while (!cleanedUp && synchronousInputFd !== null) {
        let bytesRead = 0;
        try {
          bytesRead = readSync(
            synchronousInputFd,
            buffer,
            0,
            buffer.length,
            null
          );
        } catch {
          finish(input.fallbackResult, "cancelled");
          return;
        }
        if (bytesRead <= 0) {
          finish(input.fallbackResult, "cancelled");
          return;
        }
        handleInputChunk(buffer.subarray(0, bytesRead));
      }
    };

    if (synchronousInputFd === null) {
      inputStream.on("data", onData);
    }
    render();
    if (synchronousInputFd !== null) {
      setImmediate(readSynchronouslyFromTerminal);
    }
  });
}

export function measureRenderedTerminalLinesHeight(
  lines: string[],
  columns: number | undefined
): number {
  const normalizedColumns =
    typeof columns === "number" && Number.isFinite(columns) && columns > 0
      ? Math.trunc(columns)
      : null;
  if (normalizedColumns === null) {
    return lines.length;
  }

  return lines.reduce(
    (height, line) =>
      height + measureRenderedTerminalLineHeight(line, normalizedColumns),
    0
  );
}

export function measureRenderedTerminalLineHeight(
  line: string,
  columns: number
): number {
  const width = stringWidth(line);
  if (width <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(width / columns));
}
