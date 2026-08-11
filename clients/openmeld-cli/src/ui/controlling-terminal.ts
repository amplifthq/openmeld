import { closeSync, openSync } from "node:fs";
import process from "node:process";
import { ReadStream, WriteStream } from "node:tty";
import type { InteractivePromptStreams } from "./interactive-prompt";

export type ControllingTerminalSession = {
  streams: InteractivePromptStreams;
  close: () => void;
};

const CONTROLLING_TERMINAL_PATH = "/dev/tty";

function hasUsableProcessTerminal(): boolean {
  return (
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    typeof process.stdin.setRawMode === "function"
  );
}

function closeFdSafely(fd: number | null): void {
  if (fd === null) {
    return;
  }
  try {
    closeSync(fd);
  } catch {
    // The fd may already be owned/closed by a stream; ignore.
  }
}

// Resolve a terminal we can prompt on. The fast path reuses the process std
// streams when both are real TTYs. Otherwise — most importantly under the
// `curl | sh` setup bootstrap, where the CLI runs with stdin redirected to
// /dev/null — we open the controlling terminal (/dev/tty) directly so an
// interactive prompt can still read keys and render. Returns null when no
// controlling terminal is available (Windows, CI, fully headless), so callers
// can fall back to a non-interactive default.
export function resolveControllingTerminalSession(): ControllingTerminalSession | null {
  if (hasUsableProcessTerminal()) {
    return {
      streams: { input: process.stdin, output: process.stdout },
      close: () => undefined,
    };
  }

  // /dev/tty is POSIX-only; Windows has no equivalent device path here.
  if (process.platform === "win32") {
    return null;
  }

  let readFd: number | null = null;
  let writeFd: number | null = null;
  let input: ReadStream | null = null;
  let output: WriteStream | null = null;
  try {
    readFd = openSync(CONTROLLING_TERMINAL_PATH, "r");
    input = new ReadStream(readFd);
    readFd = null; // Ownership transferred to the stream.
    writeFd = openSync(CONTROLLING_TERMINAL_PATH, "w");
    output = new WriteStream(writeFd);
    writeFd = null; // Ownership transferred to the stream.

    // Belt-and-suspenders: `new ReadStream`/`WriteStream` already throws
    // ERR_TTY_INIT_FAILED on a non-tty fd (handled by the catch below), so for a
    // real /dev/tty this guard is rarely hit. It covers the exotic case where the
    // device opens and constructs but does not report as a TTY.
    if (
      input.isTTY !== true ||
      output.isTTY !== true ||
      typeof input.setRawMode !== "function"
    ) {
      input.destroy();
      output.destroy();
      return null;
    }

    const ttyInput = input;
    const ttyOutput = output;
    return {
      streams: { input: ttyInput, output: ttyOutput },
      close: () => {
        ttyInput.destroy();
        ttyOutput.destroy();
      },
    };
  } catch {
    if (input) {
      input.destroy();
    } else {
      closeFdSafely(readFd);
    }
    if (output) {
      output.destroy();
    } else {
      closeFdSafely(writeFd);
    }
    return null;
  }
}
