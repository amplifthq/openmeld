import { describe, expect, it } from "vitest";
import {
  centerAgentSearchSlackMessagesBodySchema,
  centerAgentSearchSlackMessagesResponseSchema,
} from "../../src/schemas";

describe("Center Agent Slack message search contract", () => {
  it("accepts an event-bound public-message search request", () => {
    expect(
      centerAgentSearchSlackMessagesBodySchema.parse({
        includeBots: false,
        query: "project gizmo status",
        searchAuthorization: {
          encryptedAuthorization: "aesgcm:v1:iv:ciphertext",
        },
        speakerMember: {
          memberId: "member_1",
          userId: "user_1",
        },
      })
    ).toEqual({
      includeBots: false,
      query: "project gizmo status",
      searchAuthorization: {
        encryptedAuthorization: "aesgcm:v1:iv:ciphertext",
      },
      speakerMember: {
        memberId: "member_1",
        userId: "user_1",
      },
    });
  });

  it("returns bounded Slack evidence to the Center Agent that owns the turn", () => {
    expect(
      centerAgentSearchSlackMessagesResponseSchema.parse({
        messages: [
          {
            authorName: "Jennifer Hynes",
            authorUserId: "U_JENNIFER",
            channelId: "C_PRODUCT",
            channelName: "product",
            content: "The Gizmo launch is scheduled for Friday.",
            contextMessages: [],
            isAuthorBot: false,
            messageTs: "1710000000.000100",
            permalink:
              "https://example.slack.com/archives/C_PRODUCT/p1710000000000100",
          },
        ],
        moreResultsAvailable: false,
        organizationId: "org_1",
        status: "found",
      })
    ).toEqual({
      messages: [
        {
          authorName: "Jennifer Hynes",
          authorUserId: "U_JENNIFER",
          channelId: "C_PRODUCT",
          channelName: "product",
          content: "The Gizmo launch is scheduled for Friday.",
          contextMessages: [],
          isAuthorBot: false,
          messageTs: "1710000000.000100",
          permalink:
            "https://example.slack.com/archives/C_PRODUCT/p1710000000000100",
        },
      ],
      moreResultsAvailable: false,
      organizationId: "org_1",
      status: "found",
    });
    expect(
      centerAgentSearchSlackMessagesResponseSchema.safeParse({
        messages: [],
        moreResultsAvailable: false,
        organizationId: "org_1",
        status: "found",
        text: "unstructured answer must never cross the tool boundary",
      }).success
    ).toBe(false);
    const nearbyMessage = {
      authorName: "Morgan Lee",
      authorUserId: "U_MORGAN",
      channelId: "C_PRODUCT",
      channelName: "product",
      content: "Nearby context.",
      isAuthorBot: false,
      messageTs: "1710000000.000090",
      permalink:
        "https://example.slack.com/archives/C_PRODUCT/p1710000000000090",
    };
    expect(
      centerAgentSearchSlackMessagesResponseSchema.safeParse({
        messages: [
          {
            ...nearbyMessage,
            contextMessages: [nearbyMessage, nearbyMessage, nearbyMessage],
          },
        ],
        moreResultsAvailable: false,
        organizationId: "org_1",
        status: "found",
      }).success
    ).toBe(false);
  });

  it("represents an expired action token as an explicit unavailable result", () => {
    expect(
      centerAgentSearchSlackMessagesResponseSchema.parse({
        organizationId: "org_1",
        reason:
          "Slack search authorization expired. Ask the user to send a new Slack message and try again.",
        status: "authorization_expired",
      })
    ).toEqual({
      organizationId: "org_1",
      reason:
        "Slack search authorization expired. Ask the user to send a new Slack message and try again.",
      status: "authorization_expired",
    });
  });
});
