import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDEMPOTENCY_WINDOW_MS,
  shouldDedupeWithinWindow,
} from "../src/index";

describe("agent-runtime dedupe window", () => {
  it("matches legacy dedupe decision behavior", () => {
    const legacyShouldDedupeWithinWindow = (input: {
      firstSeenAtMs: number;
      nowMs: number;
      windowMs?: number;
    }): boolean => {
      const windowMs = input.windowMs ?? DEFAULT_IDEMPOTENCY_WINDOW_MS;
      const elapsedMs = input.nowMs - input.firstSeenAtMs;
      return elapsedMs >= 0 && elapsedMs < windowMs;
    };

    const cases = [
      {
        firstSeenAtMs: 100,
        nowMs: 100,
      },
      {
        firstSeenAtMs: 100,
        nowMs: 101,
      },
      {
        firstSeenAtMs: 100,
        nowMs: 100 + DEFAULT_IDEMPOTENCY_WINDOW_MS - 1,
      },
      {
        firstSeenAtMs: 100,
        nowMs: 100 + DEFAULT_IDEMPOTENCY_WINDOW_MS,
      },
      {
        firstSeenAtMs: 200,
        nowMs: 100,
      },
    ] as const;

    for (const item of cases) {
      expect(shouldDedupeWithinWindow(item)).toBe(
        legacyShouldDedupeWithinWindow(item)
      );
    }
  });
});
