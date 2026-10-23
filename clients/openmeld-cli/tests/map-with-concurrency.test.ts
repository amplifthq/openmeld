import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/lib/map-with-concurrency";

describe("mapWithConcurrency", () => {
  it("keeps at most the limit in flight and returns results in input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency(
      [30, 5, 20, 1, 10],
      2,
      async (ms) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, ms));
        inFlight -= 1;
        return ms * 2;
      }
    );

    expect(results).toEqual([60, 10, 40, 2, 20]);
    expect(peak).toBe(2);
  });

  it("settles only after in-flight work finishes and starts nothing new after a failure", async () => {
    const finished: string[] = [];
    const started: string[] = [];
    const run = mapWithConcurrency(["fail", "slow", "never"], 2, async (id) => {
      started.push(id);
      if (id === "fail") {
        throw new Error("probe failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished.push(id);
      return id;
    });

    await expect(run).rejects.toThrow("probe failed");
    // The slow sibling was already running; it must not outlive the call.
    expect(finished).toEqual(["slow"]);
    expect(started).toEqual(["fail", "slow"]);
  });
});
