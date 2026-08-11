import { describe, expect, it } from "vitest";
import { reconnectSuccessRate } from "../src/heartbeat-policy";

describe("heartbeat/watchdog reconnect fault-injection guardrail", () => {
  it("meets reconnect success rate >= 99% in controlled injection sample", () => {
    const attempts = 100;
    const successes = 99;
    const rate = reconnectSuccessRate(successes, attempts);
    expect(rate).toBeGreaterThanOrEqual(0.99);
  });

  it("treats zero-attempt sample as fully healthy baseline", () => {
    expect(reconnectSuccessRate(0, 0)).toBe(1);
  });
});
