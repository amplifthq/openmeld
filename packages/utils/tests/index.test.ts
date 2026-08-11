import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff, sleep, toErrorMessage } from "../src/index";

describe("sleep", () => {
  it("resolves after the requested timeout", async () => {
    vi.useFakeTimers();
    try {
      let resolved = false;
      const pending = sleep(25).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(24);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("retryWithBackoff", () => {
  it("retries failed attempts with backoff", async () => {
    vi.useFakeTimers();
    try {
      const operation = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error("first"))
        .mockRejectedValueOnce(new Error("second"))
        .mockResolvedValue("ok");

      const result = retryWithBackoff(operation, {
        initialDelayMs: 10,
        maxAttempts: 3,
      });

      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(20);

      await expect(result).resolves.toBe("ok");
      expect(operation).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("toErrorMessage", () => {
  it("preserves existing Error and non-Error string conversion", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
    expect(toErrorMessage(null)).toBe("null");
    expect(toErrorMessage(undefined)).toBe("undefined");
  });
});
