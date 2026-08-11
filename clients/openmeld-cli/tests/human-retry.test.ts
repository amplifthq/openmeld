import { describe, expect, it } from "vitest";
import { resolveHumanRetryDecision } from "../src/runtime/human-retry";

describe("resolveHumanRetryDecision", () => {
  it("treats cancelled selection as cancel", () => {
    expect(
      resolveHumanRetryDecision({
        action: "__cancel__",
        isCancelled: true,
      })
    ).toBe("cancel");
  });

  it("treats stay selection as stay", () => {
    expect(
      resolveHumanRetryDecision({
        action: "stay",
        isCancelled: false,
      })
    ).toBe("stay");
  });

  it("treats explicit cancel action as cancel", () => {
    expect(
      resolveHumanRetryDecision({
        action: "cancel",
        isCancelled: false,
      })
    ).toBe("cancel");
  });

  it("treats non-cancel non-stay selection as switch", () => {
    expect(
      resolveHumanRetryDecision({
        action: "switch",
        isCancelled: false,
      })
    ).toBe("switch");
  });
});
