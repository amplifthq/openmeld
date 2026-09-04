import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import type { RuntimeContext } from "../src/runtime/context";
import type { Presenter } from "../src/runtime/presenter";
import { createSetupProgressReporter } from "../src/ui/setup-progress";

describe("setup progress reporter", () => {
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
    vi.setSystemTime(new Date(2026, 8, 4, 14, 15, 8));
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

  it("renders human non-TTY setup progress as static ellipsis lines", () => {
    setProcessStdoutProperty("isTTY", false);
    const presenter = buildPresenter("human");
    const reporter = createSetupProgressReporter({
      presenter,
      runtime: buildRuntime({ interactive: false, resolvedView: "human" }),
    });

    const step = reporter.startStep({
      code: "setup.progress.service.starting",
      text: "Preparing OpenMeld Service.",
    });
    step.detail({
      code: "setup.progress.service.identity",
      text: "Saving this computer's OpenMeld Service identity.",
    });
    step.complete("OpenMeld Service is running.");

    expect(presenter.line).toHaveBeenCalledWith({
      code: "setup.progress.service.starting",
      text: "• Preparing OpenMeld Service...",
    });
    expect(presenter.line).toHaveBeenCalledWith({
      code: "setup.progress.service.identity",
      text: "  Saving this computer's OpenMeld Service identity...",
    });
    expect(presenter.line).toHaveBeenCalledWith({
      code: "setup.progress.service.starting.completed",
      text: "[14:15:08] ✓ OpenMeld Service is running. · 0.0s",
    });
  });

  it("keeps human setup progress static when the terminal may open prompts", () => {
    setProcessStdoutProperty("isTTY", true);
    setProcessStdoutProperty("columns", 80);
    const presenter = buildPresenter("human");
    const reporter = createSetupProgressReporter({
      presenter,
      runtime: buildRuntime({ interactive: true, resolvedView: "human" }),
    });

    const step = reporter.startStep({
      code: "setup.progress.service.starting",
      text: "Preparing OpenMeld Service.",
    });
    step.detail({
      code: "setup.progress.service.identity",
      text: "Saving this computer's OpenMeld Service identity.",
    });
    step.complete("OpenMeld Service is running.");

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(stdoutChunks).toEqual([]);
    expect(presenter.line).toHaveBeenNthCalledWith(1, {
      code: "setup.progress.service.starting",
      text: "• Preparing OpenMeld Service...",
    });
    expect(presenter.line).toHaveBeenNthCalledWith(2, {
      code: "setup.progress.service.identity",
      text: "  Saving this computer's OpenMeld Service identity...",
    });
    expect(presenter.line).toHaveBeenCalledWith({
      code: "setup.progress.service.starting.completed",
      text: "[14:15:08] ✓ OpenMeld Service is running. · 0.0s",
    });
  });

  it("renders human TTY setup progress as a spinner when stdin is not interactive", () => {
    setProcessStdoutProperty("isTTY", true);
    setProcessStdoutProperty("columns", 80);
    const presenter = buildPresenter("human");
    const reporter = createSetupProgressReporter({
      presenter,
      runtime: buildRuntime({ interactive: false, resolvedView: "human" }),
    });

    const step = reporter.startStep({
      code: "setup.progress.connect_terminal",
      text: "Connecting Terminal to OpenMeld Web...",
    });
    vi.advanceTimersByTime(250);
    step.complete("Terminal connected. Keep this window open.");

    expect(stdoutWriteSpy).toHaveBeenCalledTimes(2);
    expect(stdoutChunks[0]).toContain("Connecting Terminal to OpenMeld Web...");
    expect(stdoutChunks.at(-1)).toBe("\r\x1B[2K");
    for (const chunk of stdoutChunks) {
      expect(chunk).not.toContain("\n");
    }
    expect(presenter.line).toHaveBeenCalledWith({
      code: "setup.progress.connect_terminal.completed",
      text: "[14:15:08] ✓ Terminal connected. Keep this window open. · 0.3s",
    });
  });

  it("renders fast human TTY completion as a static success line before the spinner delay", () => {
    setProcessStdoutProperty("isTTY", true);
    setProcessStdoutProperty("columns", 80);
    const presenter = buildPresenter("human");
    const reporter = createSetupProgressReporter({
      presenter,
      runtime: buildRuntime({ interactive: false, resolvedView: "human" }),
    });

    const step = reporter.startStep({
      code: "setup.progress.connect_terminal",
      text: "Connecting Terminal to OpenMeld Web...",
    });
    step.complete("Terminal connected. Keep this window open.");
    vi.advanceTimersByTime(250);

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith({
      code: "setup.progress.connect_terminal.completed",
      text: "[14:15:08] ✓ Terminal connected. Keep this window open. · 0.0s",
    });
  });

  it("renders agent setup progress as structured line envelopes", () => {
    const presenter = buildPresenter("agent");
    const reporter = createSetupProgressReporter({
      presenter,
      runtime: buildRuntime({ interactive: false, resolvedView: "agent" }),
    });

    const step = reporter.startStep({
      code: "setup.progress.service.starting",
      text: "Preparing OpenMeld Service.",
    });
    step.detail({
      code: "setup.progress.service.identity",
      text: "Saving this computer's OpenMeld Service identity.",
    });
    step.complete("OpenMeld Service is running.");

    expect(presenter.line).toHaveBeenNthCalledWith(1, {
      code: "setup.progress.service.starting",
      text: "Preparing OpenMeld Service...",
      data: {
        message: "Preparing OpenMeld Service...",
        state: "started",
      },
    });
    expect(presenter.line).toHaveBeenNthCalledWith(2, {
      code: "setup.progress.service.identity",
      text: "Saving this computer's OpenMeld Service identity...",
      data: {
        message: "Saving this computer's OpenMeld Service identity...",
        state: "started",
      },
    });
    expect(presenter.line).toHaveBeenNthCalledWith(3, {
      code: "setup.progress.service.starting.completed",
      text: "OpenMeld Service is running.",
      data: {
        message: "OpenMeld Service is running.",
        state: "completed",
      },
    });
  });

  it("shows the elapsed time for a human step that takes noticeable time", () => {
    setProcessStdoutProperty("isTTY", false);
    const presenter = buildPresenter("human");
    const reporter = createSetupProgressReporter({
      presenter,
      runtime: buildRuntime({ interactive: false, resolvedView: "human" }),
    });

    const step = reporter.startStep({
      code: "setup.progress.service.starting",
      text: "Preparing OpenMeld Service.",
    });
    vi.advanceTimersByTime(1250);
    step.complete("OpenMeld Service is running.");

    expect(presenter.line).toHaveBeenLastCalledWith({
      code: "setup.progress.service.starting.completed",
      text: "[14:15:09] ✓ OpenMeld Service is running. · 1.3s",
    });
  });

  it("uses an injected local clock for a stable human completion timestamp", () => {
    setProcessStdoutProperty("isTTY", false);
    const presenter = buildPresenter("human");
    let nowMs = new Date(2026, 8, 4, 14, 15, 8).getTime();
    const reporter = createSetupProgressReporter({
      clock: { now: () => nowMs },
      presenter,
      runtime: buildRuntime({ interactive: false, resolvedView: "human" }),
    });

    const step = reporter.startStep({
      code: "setup.progress.service.updating",
      text: "Updating OpenMeld Service.",
    });
    nowMs += 3900;
    step.complete("OpenMeld Service updated.");

    expect(presenter.line).toHaveBeenLastCalledWith({
      code: "setup.progress.service.updating.completed",
      text: "[14:15:11] ✓ OpenMeld Service updated. · 3.9s",
    });
  });

  it("exposes exact elapsed milliseconds in Agent View", () => {
    const presenter = buildPresenter("agent");
    const reporter = createSetupProgressReporter({
      presenter,
      runtime: buildRuntime({ interactive: false, resolvedView: "agent" }),
    });

    const step = reporter.startStep({
      code: "setup.progress.service.starting",
      text: "Preparing OpenMeld Service.",
    });
    vi.advanceTimersByTime(1250);
    step.complete("OpenMeld Service is running.");

    expect(presenter.line).toHaveBeenLastCalledWith({
      code: "setup.progress.service.starting.completed",
      text: "OpenMeld Service is running.",
      data: {
        durationMs: 1250,
        message: "OpenMeld Service is running.",
        state: "completed",
      },
    });
  });
});

function buildPresenter(view: "agent" | "human"): Presenter {
  return {
    view,
    data: vi.fn(),
    event: vi.fn(),
    line: vi.fn(),
  };
}

function buildRuntime(input: {
  interactive: boolean;
  resolvedView: "agent" | "human";
}): RuntimeContext {
  return {
    interactive: input.interactive,
    resolvedView: input.resolvedView,
    viewMode: input.resolvedView,
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
