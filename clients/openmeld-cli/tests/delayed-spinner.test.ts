import { stripVTControlCharacters } from "node:util";
import stringWidth from "string-width";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDelayedSpinner } from "../src/ui/delayed-spinner";

describe("delayed spinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays silent when work finishes before the spinner delay", () => {
    const { chunks, output } = createSpinnerOutput();
    const spinner = createDelayedSpinner({
      enabled: true,
      message: "Loading spaces...",
      output,
      delayMs: 250,
    });

    spinner.start();
    spinner.complete();
    vi.advanceTimersByTime(250);

    expect(output.write).not.toHaveBeenCalled();
    expect(chunks).toEqual([]);
  });

  it("starts after the delay and clears when work completes", () => {
    const { chunks, output } = createSpinnerOutput();
    const spinner = createDelayedSpinner({
      enabled: true,
      message: "Loading spaces...",
      output,
      delayMs: 250,
    });

    spinner.start();
    vi.advanceTimersByTime(250);
    spinner.complete();

    expect(output.write).toHaveBeenCalledTimes(2);
    expect(chunks[0]).toContain("Loading spaces...");
    expect(chunks[0]).not.toContain("\n");
    expect(chunks.at(-1)).toBe("\r\x1B[2K");
  });

  it("clears the visible spinner without rendering completion text", () => {
    const { chunks } = createSpinnerOutput();
    const spinner = createDelayedSpinner({
      enabled: true,
      message: "Loading spaces...",
      output: createSpinnerOutputSink(chunks),
      delayMs: 250,
    });

    spinner.start();
    vi.advanceTimersByTime(250);
    spinner.complete();

    const transcript = chunks.join("");
    expect(transcript).toContain("Loading spaces...");
    expect(transcript).not.toContain("complete");
    expect(transcript).not.toContain("done");
    expect(chunks.at(-1)).toBe("\r\x1B[2K");
  });

  it("clears the visible spinner when work fails", () => {
    const { chunks, output } = createSpinnerOutput();
    const spinner = createDelayedSpinner({
      enabled: true,
      message: "Loading spaces...",
      output,
      delayMs: 250,
    });

    spinner.start();
    vi.advanceTimersByTime(250);
    spinner.fail();

    expect(output.write).toHaveBeenCalledTimes(2);
    expect(chunks[0]).toContain("Loading spaces...");
    expect(chunks.at(-1)).toBe("\r\x1B[2K");
  });

  it("redraws message updates on the same terminal row", () => {
    const { chunks, output } = createSpinnerOutput();
    const spinner = createDelayedSpinner({
      enabled: true,
      message: "Preparing OpenMeld Service...",
      output,
      delayMs: 250,
    });

    spinner.start();
    vi.advanceTimersByTime(250);
    spinner.message("Saving this computer's OpenMeld Service identity...");
    spinner.complete();

    expect(output.write).toHaveBeenCalledTimes(3);
    expect(chunks[0]).toContain("Preparing OpenMeld Service...");
    expect(chunks[1]).toContain(
      "Saving this computer's OpenMeld Service identity..."
    );
    for (const chunk of chunks) {
      expect(chunk).not.toContain("\n");
    }
    expect(chunks.at(-1)).toBe("\r\x1B[2K");
  });

  it("keeps spinner messages on one terminal row", () => {
    const { chunks } = createSpinnerOutput({ columns: 48 });
    const spinner = createDelayedSpinner({
      enabled: true,
      message:
        "Waiting for your agent choices in OpenMeld Web. Keep this Terminal open; setup will continue automatically.",
      output: createSpinnerOutputSink(chunks, { columns: 48 }),
      delayMs: 250,
    });

    spinner.start();
    vi.advanceTimersByTime(250);

    const startedLine = stripTerminalControls(chunks[0] ?? "");
    expect(startedLine).toContain("…");
    expect(startedLine).not.toContain("\n");
    expect(stringWidth(startedLine)).toBeLessThanOrEqual(48);
  });

  it("does not render when stdout is not interactive", () => {
    const { chunks, output } = createSpinnerOutput({ isTTY: false });
    const spinner = createDelayedSpinner({
      enabled: true,
      message: "Loading spaces...",
      output,
      delayMs: 250,
    });

    spinner.start();
    vi.advanceTimersByTime(250);
    spinner.complete();

    expect(output.write).not.toHaveBeenCalled();
    expect(chunks).toEqual([]);
  });
});

function createSpinnerOutput(
  input: { columns?: number; isTTY?: boolean } = {}
) {
  const chunks: string[] = [];
  return {
    chunks,
    output: createSpinnerOutputSink(chunks, input),
  };
}

function createSpinnerOutputSink(
  chunks: string[],
  input: {
    columns?: number;
    isTTY?: boolean;
  } = {}
) {
  return {
    columns: input.columns ?? 80,
    isTTY: input.isTTY ?? true,
    write: vi.fn((chunk: string) => {
      chunks.push(String(chunk));
      return true;
    }),
  };
}

function stripTerminalControls(value: string): string {
  return stripVTControlCharacters(value).replaceAll("\r", "");
}
