import { describe, expect, it } from "vitest";
import { resolveConnectorActionReplayWindowRemainingMs } from "../src/center-agent/connector-action-operation-repository";

describe("original provider replay window", () => {
  const hour = 60 * 60 * 1000;
  it.each([
    { elapsed: 0, remaining: 24 * hour },
    { elapsed: 23 * hour, remaining: hour },
    { elapsed: 24 * hour, remaining: 0 },
    { elapsed: 25 * hour, remaining: 0 },
    { elapsed: -1, remaining: 0 },
  ])("does not renew the original reservation after $elapsed ms", ({
    elapsed,
    remaining,
  }) => {
    expect(
      resolveConnectorActionReplayWindowRemainingMs(1000, 1000 + elapsed)
    ).toBe(remaining);
  });
});
