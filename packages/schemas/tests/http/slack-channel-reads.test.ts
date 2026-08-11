import { describe, expect, it } from "vitest";
import {
  centerAgentListSlackChannelsBodySchema,
  centerAgentReadSlackChannelHistoryBodySchema,
  centerAgentReadSlackChannelMembersBodySchema,
  slackChannelHistoryResponseSchema,
  slackChannelListResponseSchema,
} from "../../src/schemas";

describe("Slack channel read schemas", () => {
  it("accepts bounded channel list, member, and history requests", () => {
    expect(
      centerAgentListSlackChannelsBodySchema.parse({
        cursor: "next-page",
        limit: 200,
      })
    ).toEqual({ cursor: "next-page", limit: 200 });
    expect(
      centerAgentReadSlackChannelMembersBodySchema.parse({
        channelName: "ok8-okok",
        limit: 200,
      })
    ).toEqual({ channelName: "ok8-okok", limit: 200 });
    expect(
      centerAgentReadSlackChannelHistoryBodySchema.parse({
        channelName: "ok8-okok",
        limit: 15,
      })
    ).toEqual({ channelName: "ok8-okok", limit: 15 });
  });

  it("rejects channel history requests above the provider-safe page limit", () => {
    expect(
      centerAgentReadSlackChannelHistoryBodySchema.safeParse({
        channelName: "ok8-okok",
        limit: 16,
      }).success
    ).toBe(false);
  });

  it("validates model-visible channel and message responses", () => {
    expect(
      slackChannelListResponseSchema.parse({
        channels: [
          {
            channelName: "ok8-okok",
            isMember: true,
            isPrivate: false,
            memberCount: 12,
          },
        ],
        generatedAt: "2026-07-21T06:00:00.000Z",
        nextCursor: null,
        organizationId: "org-a",
      })
    ).toMatchObject({ channels: [{ channelName: "ok8-okok" }] });
    expect(
      slackChannelHistoryResponseSchema.parse({
        channelName: "ok8-okok",
        generatedAt: "2026-07-21T06:00:00.000Z",
        messages: [
          {
            authorDisplayName: "Ava",
            authorSlackUserId: "U_AVA",
            isAuthorBot: false,
            messageTs: "1710000003.000350",
            text: "Latest release update",
          },
        ],
        nextCursor: null,
        organizationId: "org-a",
      })
    ).toMatchObject({ messages: [{ authorDisplayName: "Ava" }] });
  });
});
