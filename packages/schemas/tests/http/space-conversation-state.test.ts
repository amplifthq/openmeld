import { describe, expect, it } from "vitest";
import {
  getSpaceConversationStateInputSchema,
  getSpaceConversationStateResponseSchema,
} from "../../src/index";

describe("Space conversation state HTTP schemas", () => {
  it("accepts the companion active-stream read model", () => {
    expect(
      getSpaceConversationStateResponseSchema.parse({
        v: 1,
        spaceId: "space_1",
        streams: [
          {
            v: 1,
            spaceId: "space_1",
            streamId: "stream:sub_123",
            sequence: 3,
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            triggerMessageId: "signal_1",
            dispatchId: "dispatch_1",
            textSnapshot: "The release plan is almost ready.",
            state: "streaming",
            gapDetected: false,
            createdAtMs: 1_805_000_000_000,
            updatedAtMs: 1_805_000_000_100,
            expiresAtMs: 1_805_001_800_100,
          },
        ],
      })
    ).toMatchObject({
      v: 1,
      spaceId: "space_1",
      streams: [{ streamId: "stream:sub_123", sequence: 3 }],
    });
  });

  it("requires a Space id for the companion read", () => {
    expect(
      getSpaceConversationStateInputSchema.safeParse({ spaceId: "" }).success
    ).toBe(false);
  });

  it("rejects snapshots whose expiry predates their latest update", () => {
    expect(
      getSpaceConversationStateResponseSchema.safeParse({
        v: 1,
        spaceId: "space_1",
        streams: [
          {
            v: 1,
            spaceId: "space_1",
            streamId: "stream:sub_123",
            sequence: 1,
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            triggerMessageId: "signal_1",
            dispatchId: "dispatch_1",
            textSnapshot: "Partial",
            state: "streaming",
            gapDetected: false,
            createdAtMs: 200,
            updatedAtMs: 300,
            expiresAtMs: 299,
          },
        ],
      }).success
    ).toBe(false);
  });

  it("rejects stream snapshots from a different Space", () => {
    expect(
      getSpaceConversationStateResponseSchema.safeParse({
        v: 1,
        spaceId: "space_1",
        streams: [
          {
            v: 1,
            spaceId: "space_2",
            streamId: "stream:sub_123",
            sequence: 1,
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            triggerMessageId: "signal_1",
            dispatchId: "dispatch_1",
            textSnapshot: "Partial",
            state: "streaming",
            gapDetected: false,
            createdAtMs: 200,
            updatedAtMs: 300,
            expiresAtMs: 400,
          },
        ],
      }).success
    ).toBe(false);
  });
});
