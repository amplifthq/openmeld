import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { createDaemonStartSpinner } from "../src/commands/service-output";
import type { RuntimeContext } from "../src/runtime/context";

describe("service output", () => {
  const originalStdoutIsTty = Object.getOwnPropertyDescriptor(
    process.stdout,
    "isTTY"
  );
  const originalStdoutColumns = Object.getOwnPropertyDescriptor(
    process.stdout,
    "columns"
  );
  let stdoutChunks: string[] = [];
  let stdoutWriteSpy: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    vi.useFakeTimers();
    stdoutChunks = [];
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array
    ) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  });

  afterEach(() => {
    vi.useRealTimers();
    stdoutWriteSpy.mockRestore();
    restoreProcessStdoutProperty("isTTY", originalStdoutIsTty);
    restoreProcessStdoutProperty("columns", originalStdoutColumns);
  });

  it("suppresses the service start spinner when another progress owner wraps it", () => {
    setProcessStdoutProperty("isTTY", true);
    setProcessStdoutProperty("columns", 80);

    const spinner = createDaemonStartSpinner({
      runtime: buildRuntime("human"),
      suppress: true,
    });

    expect(spinner).toBeNull();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it("uses the shared single-line spinner for standalone human service start", () => {
    setProcessStdoutProperty("isTTY", true);
    setProcessStdoutProperty("columns", 80);

    const spinner = createDaemonStartSpinner({
      runtime: buildRuntime("human"),
    });
    spinner?.start("Starting OpenMeld Service...");
    vi.advanceTimersByTime(250);
    spinner?.message("OpenMeld is repairing a local service issue...");
    spinner?.clear();

    expect(stdoutChunks[0]).toContain("Starting OpenMeld Service...");
    expect(stdoutChunks[1]).toContain(
      "OpenMeld is repairing a local service issue..."
    );
    expect(stdoutChunks.at(-1)).toBe("\r\x1B[2K");
    for (const chunk of stdoutChunks) {
      expect(chunk).not.toContain("\n");
    }
  });
});

function buildRuntime(resolvedView: "agent" | "human"): RuntimeContext {
  return {
    interactive: false,
    resolvedView,
    viewMode: resolvedView,
  };
}

function setProcessStdoutProperty(key: "columns" | "isTTY", value: unknown) {
  Object.defineProperty(process.stdout, key, {
    configurable: true,
    value,
  });
}

function restoreProcessStdoutProperty(
  key: "columns" | "isTTY",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(process.stdout, key, descriptor);
    return;
  }
  Reflect.deleteProperty(process.stdout, key);
}
