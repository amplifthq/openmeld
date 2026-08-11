import { describe, expect, it } from "vitest";
import { buildIdempotencyKey } from "../src";

describe("agent-runtime idempotency key", () => {
  it("builds a stable key from sourceEventId and targetProfileId", () => {
    expect(
      buildIdempotencyKey({
        sourceEventId: "evt-42",
        targetProfileId: "agt_codex",
      })
    ).toBe("6:evt-42|9:agt_codex");
  });

  it("encodes lengths so different id pairs cannot collide by concatenation", () => {
    expect(
      buildIdempotencyKey({
        sourceEventId: "ab",
        targetProfileId: "c",
      })
    ).toBe("2:ab|1:c");
    expect(
      buildIdempotencyKey({
        sourceEventId: "a",
        targetProfileId: "bc",
      })
    ).toBe("1:a|2:bc");
  });
});
