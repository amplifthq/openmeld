import { describe, expect, it } from "vitest";
import { computeRetryDelayMs } from "../src/runtime/retry-delay";

describe("computeRetryDelayMs", () => {
  it("starts the first attempt at 250ms", () => {
    expect(computeRetryDelayMs(1)).toBe(250);
  });

  it("ramps up through the schedule before the cap", () => {
    expect(computeRetryDelayMs(2)).toBe(500);
    expect(computeRetryDelayMs(3)).toBe(1000);
  });

  it("caps at 2000ms from the fourth attempt onward", () => {
    expect(computeRetryDelayMs(4)).toBe(2000);
    expect(computeRetryDelayMs(5)).toBe(2000);
    expect(computeRetryDelayMs(100)).toBe(2000);
  });

  it("exhausts a fixed total budget in a bounded number of attempts", () => {
    const totalBudgetMs = 11_000;
    let cumulativeMs = 0;
    let attempts = 0;
    while (cumulativeMs < totalBudgetMs) {
      attempts += 1;
      cumulativeMs += computeRetryDelayMs(attempts);
    }

    expect(attempts).toBe(8);
    expect(cumulativeMs).toBe(11_750);
  });
});
