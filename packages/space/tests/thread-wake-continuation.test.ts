import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import { resolveThreadWakeContinuation } from "../src/read-projection/thread-wake-continuation";

function signal(
  kind: "agent" | "human",
  targets: string[] = []
): SignalEnvelope {
  return {
    id: "source",
    type: "signal.text",
    profile: { kind, profileId: "A" },
    data: { text: "hello", messageEnvelope: { activationTargets: targets } },
  } as SignalEnvelope;
}

describe("thread Wake continuation", () => {
  it("continues the last explicitly selected Agent rather than the first", () => {
    expect(
      resolveThreadWakeContinuation({
        root: signal("agent"),
        latestExplicitWake: signal("human", ["B"]),
      })
    ).toBe("B");
  });
  it("starts with an Agent root but never invents a target for human conversation", () => {
    expect(
      resolveThreadWakeContinuation({
        root: signal("agent"),
        latestExplicitWake: null,
      })
    ).toBe("A");
    expect(
      resolveThreadWakeContinuation({
        root: signal("human"),
        latestExplicitWake: null,
      })
    ).toBeNull();
  });
  it("does not guess after a multi-Agent Wake", () => {
    expect(
      resolveThreadWakeContinuation({
        root: signal("agent"),
        latestExplicitWake: signal("human", ["B", "C"]),
      })
    ).toBeNull();
  });
});
