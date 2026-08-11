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

  it("returns presentation status without copying Slack results into the tool response", () => {
    expect(
      centerAgentSearchSlackMessagesResponseSchema.parse({
        organizationId: "org_1",
        status: "presented",
      })
    ).toEqual({
      organizationId: "org_1",
      status: "presented",
    });
    expect(
      centerAgentSearchSlackMessagesResponseSchema.safeParse({
        messages: [
          {
            authorName: "Jennifer Hynes",
            content: "The Gizmo launch is scheduled for Friday.",
            permalink:
              "https://example.slack.com/archives/C0123456/p1234567890",
          },
        ],
        organizationId: "org_1",
        status: "presented",
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
