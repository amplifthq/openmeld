import type { SpaceAgentStreamDeltaFrame } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { ReasoningReplay } from "../src/space/application/reasoning-replay";

const frame: Extract<SpaceAgentStreamDeltaFrame, { kind: "thinking" }> = {
  type: "space.agent_stream_delta",
  v: 1,
  spaceId: "space",
  streamId: "stream",
  profileId: "profile",
  dispatchId: "dispatch",
  triggerMessageId: "trigger",
  kind: "thinking",
  sequence: 1,
  thinkingSnapshot: "Recent reasoning",
  reasoningState: { status: "streaming" },
  state: "streaming",
  updatedAtMs: 1000,
};

describe("transient reasoning replay", () => {
  it("replays the latest tail and replaces private text on disable", () => {
    const replay = new ReasoningReplay();
    replay.remember(frame);
    expect(replay.read(1001)).toEqual([frame]);
    replay.remember({
      ...frame,
      sequence: 2,
      reasoningState: { status: "disabled" as const },
    });
    replay.remember(frame);
    expect(replay.read(1002)[0]).toMatchObject({
      thinkingSnapshot: "",
      reasoningState: { status: "disabled" },
    });
    replay.forget("stream");
    expect(replay.read(1003)).toEqual([]);
    expect(new ReasoningReplay().read(1003)).toEqual([]);
  });

  it("invalidates an already-read replay when its owner clears it", () => {
    const replay = new ReasoningReplay();
    replay.remember(frame);
    const pending = replay.read(1001)[0];
    if (!pending) {
      throw new Error("Expected a replay tail");
    }
    const revision = replay.revision;
    expect(replay.isCurrent(pending)).toBe(true);
    replay.clearProfile(frame.profileId);
    expect(replay.isCurrent(pending)).toBe(false);
    expect(replay.revision).not.toBe(revision);
    expect(replay.read(1002)).toEqual([]);
  });

  it("bounds retained streams, tail size, and lifetime", () => {
    const replay = new ReasoningReplay();
    for (let index = 0; index < 129; index++) {
      replay.remember({
        ...frame,
        streamId: `stream-${index}`,
        thinkingSnapshot: "x".repeat(9000),
      });
    }
    const frames = replay.read(1001);
    expect(frames).toHaveLength(128);
    expect(frames[0]?.streamId).toBe("stream-1");
    expect(
      frames.every((value) => value.thinkingSnapshot.length === 8192)
    ).toBe(true);
    expect(replay.read(1000 + 30 * 60 * 1000)).toEqual([]);
  });
});
