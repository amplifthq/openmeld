import { describe, expect, it } from "vitest";
import {
  DATA_PLANE_DEFAULTS,
  shouldDedupeWithinWindow,
} from "../src/data-plane-contract";

describe("data-plane contract parity", () => {
  it("keeps dedupe decision parity with legacy runtime formula", () => {
    const legacyShouldDedupeWithinWindow = (input: {
      firstSeenAtMs: number;
      nowMs: number;
      windowMs?: number;
    }): boolean => {
      const windowMs = input.windowMs ?? DATA_PLANE_DEFAULTS.dedupeWindowMs;
      const elapsedMs = input.nowMs - input.firstSeenAtMs;
      return elapsedMs >= 0 && elapsedMs < windowMs;
    };

    const nowMs = Date.UTC(2026, 1, 26, 12, 0, 0);
    const cases = [
      {
        firstSeenAtMs: nowMs,
        nowMs,
      },
      {
        firstSeenAtMs: nowMs - 1,
        nowMs,
      },
      {
        firstSeenAtMs: nowMs - DATA_PLANE_DEFAULTS.dedupeWindowMs + 1,
        nowMs,
      },
      {
        firstSeenAtMs: nowMs - DATA_PLANE_DEFAULTS.dedupeWindowMs,
        nowMs,
      },
      {
        firstSeenAtMs: nowMs + 1000,
        nowMs,
      },
    ] as const;

    for (const sample of cases) {
      expect(shouldDedupeWithinWindow(sample)).toBe(
        legacyShouldDedupeWithinWindow(sample)
      );
    }
  });
});
