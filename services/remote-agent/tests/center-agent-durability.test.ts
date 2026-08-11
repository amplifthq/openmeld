import { describe, expect, it } from "vitest";
import { CENTER_AGENT_DURABILITY } from "../flue-adapter/center-agent-durability";

describe("Center Agent durability", () => {
  it("disables the wall-clock timeout and limits recovery to five attempts", () => {
    expect(CENTER_AGENT_DURABILITY).toEqual({
      maxAttempts: 5,
      timeoutMs: 0,
    });
  });
});
