import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import { applyAutomaticThreadWake } from "../src/authoring/thread-wake";
import {
  resolveThreadAutomaticWakeTarget,
  resolveThreadWakeContinuation,
} from "../src/read-projection/thread-wake-continuation";

function signal(
  kind: "agent" | "human",
  targets: string[] = []
): SignalEnvelope {
  return {
    v: 1,
    id: "source",
    spaceId: "space-thread-continuation",
    ts: 1,
    type: "signal.text",
    profile: { kind, profileId: "A" },
    data: {
      text: "hello",
      messageEnvelope: {
        activationTargets: targets,
        referenceTargets: [],
        text: "hello",
      },
    },
  };
}

describe("thread Wake continuation", () => {
  it("adds one visible Wake to the original human message without changing its identity or repeating it", () => {
    const reply = signal("human");
    const originalId = reply.id;
    applyAutomaticThreadWake(reply, () => ({ profileId: "B", label: "@Beta" }));
    expect(reply.id).toBe(originalId);
    expect(reply.type === "signal.text" && reply.data).toMatchObject({
      text: "hello\n@Beta",
      messageEnvelope: { activationTargets: ["B"], text: "hello\n@Beta" },
      meta: { threadWakeContinuation: true },
    });
    applyAutomaticThreadWake(reply, () => {
      throw new Error("Must not choose again");
    });
    expect(reply.type === "signal.text" && reply.data.text).toBe(
      "hello\n@Beta"
    );
  });
  it("leaves explicit targets and group messages unchanged", () => {
    const explicit = signal("human", ["C"]);
    applyAutomaticThreadWake(explicit, () => {
      throw new Error("Explicit recipient wins");
    });
    const group = signal("human");
    applyAutomaticThreadWake(group, () => null);
    expect(group.type === "signal.text" && group.data.text).toBe("hello");
  });
  it.each([
    { humans: [], agents: ["A"], sender: "H", expected: "A" },
    { humans: ["H"], agents: ["A"], sender: "H", expected: "A" },
    { humans: ["H"], agents: ["A"], sender: "other", expected: null },
    { humans: ["H", "other"], agents: ["A"], sender: "H", expected: null },
    { humans: ["H"], agents: ["A", "B"], sender: "H", expected: null },
    { humans: ["H"], agents: [], sender: "H", expected: null },
  ])("uses direct-message rules for $humans / $agents / $sender", ({
    humans,
    agents,
    sender,
    expected,
  }) => {
    expect(
      resolveThreadAutomaticWakeTarget({
        senderProfileId: sender,
        participants: [
          ...humans.map((profileId) => ({ profileId, kind: "human" })),
          ...agents.map((profileId) => ({ profileId, kind: "agent" })),
        ],
      })
    ).toBe(expected);
  });
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
