import { describe, expect, it } from "vitest";
import { buildIdempotencyKey } from "../dispatch/rules/dispatch-idempotency";

describe("dispatch idempotency", () => {
  it("uses sourceEventId + targetProfileId only", () => {
    const key = buildIdempotencyKey({
      sourceEventId: "evt-1",
      targetProfileId: "agt-1",
    });

    expect(key).toBe("5:evt-1|5:agt-1");
  });
});
