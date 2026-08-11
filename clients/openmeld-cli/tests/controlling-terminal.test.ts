import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Direct unit coverage for resolveControllingTerminalSession — the /dev/tty
// open + fallback logic that the executor tests mock out, and the one path that
// cannot be smoke-tested where a real controlling terminal cannot be allocated.
const { openSyncMock, closeSyncMock, readStreamMock, writeStreamMock } =
  vi.hoisted(() => ({
    openSyncMock: vi.fn(),
    closeSyncMock: vi.fn(),
    readStreamMock: vi.fn(),
    writeStreamMock: vi.fn(),
  }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, closeSync: closeSyncMock, openSync: openSyncMock };
});

vi.mock("node:tty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:tty")>();
  return {
    ...actual,
    // Regular functions (not arrows) so `new ReadStream(fd)` returns the mock
    // object the constructor returns.
    ReadStream: function MockReadStream(fd: number) {
      return readStreamMock(fd);
    } as unknown as typeof actual.ReadStream,
    WriteStream: function MockWriteStream(fd: number) {
      return writeStreamMock(fd);
    } as unknown as typeof actual.WriteStream,
  };
});

import { resolveControllingTerminalSession } from "../src/ui/controlling-terminal";

type MutableStdio = { isTTY?: unknown; setRawMode?: unknown };

let savedStdinIsTTY: unknown;
let savedStdoutIsTTY: unknown;
let savedStdinSetRawMode: unknown;
let savedPlatform: NodeJS.Platform;

function setProcessTerminal(input: {
  stdinIsTTY: boolean | undefined;
  stdoutIsTTY: boolean | undefined;
  hasSetRawMode: boolean;
  platform: NodeJS.Platform;
}): void {
  (process.stdin as MutableStdio).isTTY = input.stdinIsTTY;
  (process.stdout as MutableStdio).isTTY = input.stdoutIsTTY;
  (process.stdin as MutableStdio).setRawMode = input.hasSetRawMode
    ? () => process.stdin
    : undefined;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: input.platform,
  });
}

function makeFakeTtyStream(isTTY: boolean) {
  return { destroy: vi.fn(), isTTY, setRawMode: vi.fn() };
}

beforeEach(() => {
  savedStdinIsTTY = (process.stdin as MutableStdio).isTTY;
  savedStdoutIsTTY = (process.stdout as MutableStdio).isTTY;
  savedStdinSetRawMode = (process.stdin as MutableStdio).setRawMode;
  savedPlatform = process.platform;
  openSyncMock.mockReset();
  closeSyncMock.mockReset();
  readStreamMock.mockReset();
  writeStreamMock.mockReset();
  // Default: process std streams are NOT TTYs (forces the /dev/tty path), posix.
  setProcessTerminal({
    hasSetRawMode: false,
    platform: "linux",
    stdinIsTTY: undefined,
    stdoutIsTTY: undefined,
  });
});

afterEach(() => {
  (process.stdin as MutableStdio).isTTY = savedStdinIsTTY;
  (process.stdout as MutableStdio).isTTY = savedStdoutIsTTY;
  (process.stdin as MutableStdio).setRawMode = savedStdinSetRawMode;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: savedPlatform,
  });
});

describe("resolveControllingTerminalSession", () => {
  it("reuses the process std streams when both are real TTYs (no /dev/tty open)", () => {
    setProcessTerminal({
      hasSetRawMode: true,
      platform: "linux",
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });

    const session = resolveControllingTerminalSession();

    expect(session).not.toBeNull();
    expect(session?.streams.input).toBe(process.stdin);
    expect(session?.streams.output).toBe(process.stdout);
    expect(openSyncMock).not.toHaveBeenCalled();
    expect(() => session?.close()).not.toThrow();
  });

  it("returns null on win32 (no /dev/tty device path)", () => {
    setProcessTerminal({
      hasSetRawMode: false,
      platform: "win32",
      stdinIsTTY: undefined,
      stdoutIsTTY: undefined,
    });

    expect(resolveControllingTerminalSession()).toBeNull();
    expect(openSyncMock).not.toHaveBeenCalled();
  });

  it("falls back to null when /dev/tty cannot be opened (headless/CI, e.g. ENXIO)", () => {
    openSyncMock.mockImplementation(() => {
      throw new Error("ENXIO: no such device or address, open '/dev/tty'");
    });

    expect(resolveControllingTerminalSession()).toBeNull();
  });

  it("closes the raw fd and returns null when the tty stream constructor throws", () => {
    openSyncMock.mockReturnValueOnce(7);
    readStreamMock.mockImplementation(() => {
      throw new Error("ERR_TTY_INIT_FAILED");
    });

    expect(resolveControllingTerminalSession()).toBeNull();
    // ReadStream threw before fd ownership transferred → closed via closeFdSafely.
    expect(closeSyncMock).toHaveBeenCalledWith(7);
  });

  it("opens /dev/tty for input+output and close() destroys both streams (no fd leak)", () => {
    const fakeInput = makeFakeTtyStream(true);
    const fakeOutput = makeFakeTtyStream(true);
    openSyncMock.mockReturnValueOnce(7).mockReturnValueOnce(8);
    readStreamMock.mockReturnValue(fakeInput);
    writeStreamMock.mockReturnValue(fakeOutput);

    const session = resolveControllingTerminalSession();

    expect(session).not.toBeNull();
    expect(session?.streams.input).toBe(fakeInput);
    expect(session?.streams.output).toBe(fakeOutput);
    // Ownership transferred to the streams → raw fds not closed directly.
    expect(closeSyncMock).not.toHaveBeenCalled();

    session?.close();
    expect(fakeInput.destroy).toHaveBeenCalledTimes(1);
    expect(fakeOutput.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys both streams and returns null when the opened device is not a TTY", () => {
    const fakeInput = makeFakeTtyStream(false);
    const fakeOutput = makeFakeTtyStream(true);
    openSyncMock.mockReturnValueOnce(7).mockReturnValueOnce(8);
    readStreamMock.mockReturnValue(fakeInput);
    writeStreamMock.mockReturnValue(fakeOutput);

    expect(resolveControllingTerminalSession()).toBeNull();
    expect(fakeInput.destroy).toHaveBeenCalledTimes(1);
    expect(fakeOutput.destroy).toHaveBeenCalledTimes(1);
  });
});
