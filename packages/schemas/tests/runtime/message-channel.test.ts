import { describe, expect, it } from "vitest";
import {
  buildMessageChannelConversationId,
  messageChannelConversationLocatorSchema,
  messageChannelIngressEnvelopeSchema,
  parseSlackThreadPublicationPermalink,
} from "../../src/index";

describe("Message Channel runtime contracts", () => {
  const larkLocator = {
    provider: "lark",
    connectionId: "connection_123",
    appId: "cli_aad19a1d2f389ed3",
    tenantKey: "tenant_123",
    chatId: "oc_chat_123",
    rootMessageId: "om_message_123",
    threadId: null,
  } as const;

  it("parses typed provider locators and builds stable conversation IDs", () => {
    expect(messageChannelConversationLocatorSchema.parse(larkLocator)).toEqual(
      larkLocator
    );
    expect(
      messageChannelConversationLocatorSchema.parse({
        provider: "slack",
        connectionId: "connection_slack",
        teamId: "T123",
        channelId: "C123",
        rootMessageId: "1710000000.000100",
      })
    ).toMatchObject({ provider: "slack", teamId: "T123" });
    expect(buildMessageChannelConversationId(larkLocator)).toBe(
      "lark:connection_123:oc_chat_123:om_message_123"
    );
    expect(
      buildMessageChannelConversationId({
        ...larkLocator,
        chatId: "chat:with:separator",
      })
    ).toBe("lark:connection_123:chat%3Awith%3Aseparator:om_message_123");
    expect(
      buildMessageChannelConversationId({
        ...larkLocator,
        connectionId: "connection_reinstalled",
      })
    ).not.toBe(buildMessageChannelConversationId(larkLocator));
  });

  it("accepts one bounded normalized ingress event", () => {
    const envelope = {
      v: 1,
      kind: "remote_agent_message_channel_event",
      provider: "lark",
      connectionId: "connection_123",
      providerEventId: "event_123",
      receivedAtMs: 1_784_365_200_000,
      gatewayRequestId: "gateway_request_123",
      event: {
        kind: "message",
        messageId: "om_message_123",
        sentAtMs: 1_784_365_199_000,
        senderId: "ou_user_123",
        senderDisplayName: "Felix",
        locator: larkLocator,
        text: "Please summarize this thread.",
        mention: "direct_message",
        resources: [
          {
            type: "image",
            fileKey: "img_123",
            fileName: "diagram.png",
            mimeType: "image/png",
            sizeBytes: 2048,
          },
        ],
      },
    } as const;

    expect(messageChannelIngressEnvelopeSchema.parse(envelope)).toEqual(
      envelope
    );
  });

  it("rejects provider and connection mismatches or raw provider payloads", () => {
    const baseEnvelope = {
      v: 1,
      kind: "remote_agent_message_channel_event",
      provider: "lark",
      connectionId: "connection_123",
      providerEventId: "event_123",
      receivedAtMs: 1_784_365_200_000,
      gatewayRequestId: "gateway_request_123",
      event: {
        kind: "message",
        messageId: "om_message_123",
        sentAtMs: 1_784_365_199_000,
        senderId: "ou_user_123",
        locator: larkLocator,
        text: "Hello",
        mention: "group_mention",
        resources: [],
      },
    } as const;

    expect(
      messageChannelIngressEnvelopeSchema.safeParse({
        ...baseEnvelope,
        provider: "feishu",
      }).success
    ).toBe(false);
    expect(
      messageChannelIngressEnvelopeSchema.safeParse({
        ...baseEnvelope,
        connectionId: "connection_other",
      }).success
    ).toBe(false);
    expect(
      messageChannelIngressEnvelopeSchema.safeParse({
        ...baseEnvelope,
        rawPayload: { token: "provider-secret" },
      }).success
    ).toBe(false);
  });

  it("derives an exact Slack thread target only from a real message permalink", () => {
    expect(
      parseSlackThreadPublicationPermalink(
        "https://openmeld.slack.com/archives/C_RELEASE/p1786979718343639"
      )
    ).toEqual({
      channelId: "C_RELEASE",
      threadTs: "1786979718.343639",
    });
    expect(
      parseSlackThreadPublicationPermalink(
        "https://openmeld.slack.com/archives/C_RELEASE/p1786979718999999?thread_ts=1786979718.343639&cid=C_RELEASE"
      )
    ).toEqual({
      channelId: "C_RELEASE",
      threadTs: "1786979718.343639",
    });
    expect(
      parseSlackThreadPublicationPermalink(
        "https://openmeld.slack.com/archives/C_RELEASE/p1786979718343639?cid=C_OTHER"
      )
    ).toBeNull();
    expect(
      parseSlackThreadPublicationPermalink(
        "https://example.com/archives/C_RELEASE/p1786979718343639"
      )
    ).toBeNull();
  });
});
