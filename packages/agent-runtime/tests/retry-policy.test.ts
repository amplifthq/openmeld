import { describe, expect, it } from "vitest";
import {
  computeRetryDelaySeconds,
  DEFAULT_DISPATCH_MAX_ATTEMPTS,
  DEFAULT_UNKNOWN_ERROR_MAX_ATTEMPTS,
  shouldRetryByAttemptBudget,
} from "../src/index";

describe("agent-runtime retry policy", () => {
  it("matches core legacy retry decision behavior", () => {
    const legacyShouldRetryDispatchAttempt = (attempt: number): boolean => {
      return attempt < DEFAULT_DISPATCH_MAX_ATTEMPTS;
    };

    const legacyShouldRetryUnknownDispatchAttempt = (
      attempt: number
    ): boolean => {
      return attempt < DEFAULT_UNKNOWN_ERROR_MAX_ATTEMPTS;
    };

    for (const attempt of [1, 2, 3, 6, 7, 8]) {
      expect(shouldRetryByAttemptBudget({ attempt })).toBe(
        legacyShouldRetryDispatchAttempt(attempt)
      );
      expect(
        shouldRetryByAttemptBudget({
          attempt,
          maxAttempts: DEFAULT_UNKNOWN_ERROR_MAX_ATTEMPTS,
        })
      ).toBe(legacyShouldRetryUnknownDispatchAttempt(attempt));
    }
  });

  it("computes bounded retry delay with jitter", () => {
    expect(computeRetryDelaySeconds({ attempt: 1, random: () => 0.5 })).toBe(1);
    expect(computeRetryDelaySeconds({ attempt: 2, random: () => 0 })).toBe(2);
    expect(computeRetryDelaySeconds({ attempt: 2, random: () => 1 })).toBe(4);
  });
});
