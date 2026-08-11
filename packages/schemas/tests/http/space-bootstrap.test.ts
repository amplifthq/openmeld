import { describe, expect, it } from "vitest";
import {
  spaceBootstrapQuerySchema,
  spaceBootstrapResponseSchema,
} from "../../src/index";

describe("Space bootstrap HTTP schema", () => {
  it("accepts active agent streams in the bootstrap snapshot", () => {
    const response = spaceBootstrapResponseSchema.parse({
      ...createBootstrapResponse(),
      activeAgentStreams: [
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
    });

    expect(response.activeAgentStreams).toEqual([
      expect.objectContaining({
        sequence: 3,
        streamId: "stream:sub_123",
      }),
    ]);
  });

  it("keeps bootstrap responses without active agent streams compatible", () => {
    const response = spaceBootstrapResponseSchema.parse(
      createBootstrapResponse()
    );

    expect(response).not.toHaveProperty("activeAgentStreams");
  });

  it("accepts an opted-in active Agent stream presence without reply text", () => {
    const response = spaceBootstrapResponseSchema.parse({
      ...createBootstrapResponse(),
      activeAgentStreamPresences: [
        {
          v: 1,
          spaceId: "space_1",
          streamId: "stream:sub_123",
          sequence: 3,
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          state: "streaming",
          gapDetected: false,
          createdAtMs: 1_805_000_000_000,
          updatedAtMs: 1_805_000_000_100,
          expiresAtMs: 1_805_001_800_100,
        },
      ],
    });

    expect(response.activeAgentStreamPresences).toEqual([
      expect.objectContaining({
        sequence: 3,
        streamId: "stream:sub_123",
      }),
    ]);
    expect(response.activeAgentStreamPresences?.[0]).not.toHaveProperty(
      "textSnapshot"
    );
  });

  it("parses the active Agent stream presence opt-in", () => {
    expect(
      spaceBootstrapQuerySchema.parse({
        includeAgentStreamPresence: "true",
      })
    ).toEqual({ includeAgentStreamPresence: true });
  });
});

function createBootstrapResponse() {
  const generatedAt = "2026-07-14T00:00:00.000Z";
  return {
    status: {
      spaceId: "space_1",
      generatedAt,
      name: "Bootstrap test space",
      accessMode: "public",
      passwordProtected: false,
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "space_reply_only" },
      entryBrief: "default",
      dispatchBrief: "default",
      members: {
        totalCount: 0,
        humanCount: 0,
        agentCount: 0,
        liveNowCount: 0,
        liveHumanCount: 0,
        liveAgentCount: 0,
      },
    },
    members: {
      spaceId: "space_1",
      generatedAt,
      summary: {
        totalCount: 0,
        humanCount: 0,
        agentCount: 0,
        liveNowCount: 0,
      },
      humans: [],
      agents: [],
    },
    history: {
      signals: [],
      nextCursor: null,
    },
    threads: {
      threads: [],
      previews: [],
    },
  };
}
