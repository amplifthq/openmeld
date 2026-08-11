import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStopAwareDelay } from "../src/local-service/carrier/stop-aware-delay";

const AUTH_REJECTED_MAX_BACKOFF_MS = 15 * 60 * 1000;

describe("createStopAwareDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the full backoff duration when no stop arrives", async () => {
    const delay = createStopAwareDelay();
    let result: string | null = null;
    const waitPromise = delay
      .wait(AUTH_REJECTED_MAX_BACKOFF_MS)
      .then((value) => {
        result = value;
      });

    await vi.advanceTimersByTimeAsync(AUTH_REJECTED_MAX_BACKOFF_MS - 1);
    expect(result).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await waitPromise;
    expect(result).toBe("elapsed");
  });

  it("wakes immediately when interrupted mid-backoff at the 15-minute tier", async () => {
    const delay = createStopAwareDelay();
    let result: string | null = null;
    const waitPromise = delay
      .wait(AUTH_REJECTED_MAX_BACKOFF_MS)
      .then((value) => {
        result = value;
      });

    await vi.advanceTimersByTimeAsync(7 * 60 * 1000);
    expect(result).toBeNull();

    delay.interrupt();
    // Only microtasks may run: the wake must not depend on any timer.
    await waitPromise;
    expect(result).toBe("interrupted");
  });

  it("resolves immediately for waits requested after the interrupt", async () => {
    const delay = createStopAwareDelay();
    delay.interrupt();

    await expect(delay.wait(60_000)).resolves.toBe("interrupted");
  });

  it("interrupts every pending wait at once", async () => {
    const delay = createStopAwareDelay();
    const results: string[] = [];
    const waitPromises = [
      delay.wait(60_000).then((value) => {
        results.push(value);
      }),
      delay.wait(AUTH_REJECTED_MAX_BACKOFF_MS).then((value) => {
        results.push(value);
      }),
    ];

    delay.interrupt();
    await Promise.all(waitPromises);
    expect(results).toEqual(["interrupted", "interrupted"]);
  });

  it("does not fire a stray timer callback after an interrupted wait elapses", async () => {
    const delay = createStopAwareDelay();
    const resultPromise = delay.wait(60_000);
    delay.interrupt();
    await expect(resultPromise).resolves.toBe("interrupted");

    // Advancing past the original deadline must not resolve anything twice or
    // leave a live timer behind.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
