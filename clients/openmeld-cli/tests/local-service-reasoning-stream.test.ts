import { afterEach, describe, expect, it, vi } from "vitest";
import { createReasoningStream } from "../src/local-service/dispatch/reasoning-stream";

describe("ephemeral reasoning delivery", () => {
  afterEach(() => vi.useRealTimers());

  it("delivers the first fragment immediately and bounds a burst without losing its latest tail", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const stream = createReasoningStream({ enabled: () => true, send });
    const observe = (text: string) =>
      stream.observe({
        phase: "reasoning",
        blockId: "a",
        text,
        mode: "append",
        tsMs: Date.now(),
      });
    observe("First");
    expect(send).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 20_000; index++) {
      observe("x");
    }
    observe("LATEST");
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.lastCall?.[0]).toHaveLength(8192);
    expect(send.mock.lastCall?.[0].endsWith("LATEST")).toBe(true);
    stream.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never replays text collected before privacy is disabled or after disposal", () => {
    vi.useFakeTimers();
    let enabled = true;
    const send = vi.fn();
    const stream = createReasoningStream({ enabled: () => enabled, send });
    const observe = (text: string) =>
      stream.observe({
        phase: "reasoning",
        blockId: "a",
        text,
        mode: "append",
        tsMs: Date.now(),
      });
    observe("visible");
    observe("queued private text");
    enabled = false;
    stream.clear();
    observe("disabled private text");
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    enabled = true;
    observe("fresh");
    expect(send.mock.lastCall?.[0]).toBe("fresh");
    stream.dispose();
    observe("after disposal");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
