import { describe, expect, it } from "vitest";
import {
  computeDispatchRetryDelaySeconds,
  DISPATCH_IDEMPOTENCY_WINDOW_MS,
  DISPATCH_MAX_ATTEMPTS,
  isDispatchDedupeWindowRisk,
  shouldDedupeWithinWindow,
  shouldRetryDispatchAttempt,
  shouldRetryUnknownDispatchAttempt,
} from "../dispatch/rules/dispatch-runtime-constants";

describe("dispatch runtime constants", () => {
  it("keeps retryable attempts within max attempt budget", () => {
    expect(shouldRetryDispatchAttempt(1)).toBe(true);
    expect(shouldRetryDispatchAttempt(DISPATCH_MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetryDispatchAttempt(DISPATCH_MAX_ATTEMPTS)).toBe(false);
    expect(shouldRetryDispatchAttempt(DISPATCH_MAX_ATTEMPTS + 1)).toBe(false);
  });

  it("uses tighter budget for unknown errors", () => {
    expect(shouldRetryUnknownDispatchAttempt(1)).toBe(true);
    expect(shouldRetryUnknownDispatchAttempt(2)).toBe(true);
    expect(shouldRetryUnknownDispatchAttempt(3)).toBe(false);
  });

  it("computes jittered retry delay from fixed backoff ladder", () => {
    const lowJitter = computeDispatchRetryDelaySeconds({
      attempt: 2,
      random: () => 0,
    });
    const noJitter = computeDispatchRetryDelaySeconds({
      attempt: 2,
      random: () => 0.5,
    });
    const highJitter = computeDispatchRetryDelaySeconds({
      attempt: 2,
      random: () => 1,
    });

    expect(noJitter).toBe(3);
    expect(lowJitter).toBeGreaterThanOrEqual(2);
    expect(highJitter).toBeLessThanOrEqual(4);
  });

  it("emits dedupe window risk near 24h lag threshold", () => {
    expect(isDispatchDedupeWindowRisk(DISPATCH_IDEMPOTENCY_WINDOW_MS)).toBe(
      true
    );
    expect(
      isDispatchDedupeWindowRisk(
        Math.floor(DISPATCH_IDEMPOTENCY_WINDOW_MS * 0.5)
      )
    ).toBe(false);
  });

  it("uses half-open [0, 24h) idempotency dedupe window boundary", () => {
    const firstSeenAtMs = Date.UTC(2026, 1, 26, 0, 0, 0);
    expect(
      shouldDedupeWithinWindow({
        firstSeenAtMs,
        nowMs: firstSeenAtMs,
      })
    ).toBe(true);
    expect(
      shouldDedupeWithinWindow({
        firstSeenAtMs,
        nowMs: firstSeenAtMs + DISPATCH_IDEMPOTENCY_WINDOW_MS - 1,
      })
    ).toBe(true);
    expect(
      shouldDedupeWithinWindow({
        firstSeenAtMs,
        nowMs: firstSeenAtMs + DISPATCH_IDEMPOTENCY_WINDOW_MS,
      })
    ).toBe(false);
  });
});
