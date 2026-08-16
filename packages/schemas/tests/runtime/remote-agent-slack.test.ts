import { describe, expect, it } from "vitest";
import {
  remoteAgentSlackAppMentionEventSchema,
  remoteAgentSlackDirectMessageEventSchema,
  remoteAgentSlackEventQueueMessageSchema,
  remoteAgentSlackEventsApiPayloadSchema,
} from "../../src/index";

describe("Remote Agent Slack contracts", () => {
  it("preserves official app_mention event fields for Core processing", () => {
    const payload = remoteAgentSlackEventsApiPayloadSchema.parse({
      token: "verification-token",
      challenge: "ignored-for-events",
      type: "event_callback",
      team_id: "T123",
      api_app_id: "A123",
      event_id: "Ev123",
      event_time: 1_710_000_000,
      event: {
        type: "app_mention",
        user: "U123",
        text: "<@B123> help",
        ts: "1710000000.000100",
        channel: "C123",
        event_ts: "1710000000.000100",
      },
    });

    expect(payload).toMatchObject({
      type: "event_callback",
      event: {
        type: "app_mention",
        user: "U123",
        text: "<@B123> help",
        channel: "C123",
      },
    });
    if (payload.type !== "event_callback") {
      throw new Error("expected event_callback payload");
    }
    expect(remoteAgentSlackAppMentionEventSchema.parse(payload.event)).toEqual(
      expect.objectContaining({
        type: "app_mention",
        user: "U123",
        ts: "1710000000.000100",
      })
    );
  });

  it("accepts only human messages sent directly to the app", () => {
    const directMessage = {
      type: "message",
      channel_type: "im",
      user: "U123",
      text: "What do you know about my work?",
      ts: "1710000000.000100",
      channel: "D123",
    };

    expect(
      remoteAgentSlackDirectMessageEventSchema.parse(directMessage)
    ).toEqual(directMessage);
    expect(
      remoteAgentSlackDirectMessageEventSchema.safeParse({
        ...directMessage,
        bot_id: "B123",
      }).success
    ).toBe(false);
    expect(
      remoteAgentSlackDirectMessageEventSchema.safeParse({
        ...directMessage,
        subtype: "message_changed",
      }).success
    ).toBe(false);
  });

  it("carries Slack retry evidence through the durable Queue ingress", () => {
    expect(
      remoteAgentSlackEventQueueMessageSchema.parse({
        kind: "remote_agent_slack_event",
        v: 1,
        gatewayRequestId: "gw_req_1",
        receivedAtMs: 1_710_000_000_100,
        slackRetryNum: 1,
        slackRetryReason: "http_timeout",
        payload: {
          type: "event_callback",
          team_id: "T123",
          event_id: "Ev123",
          event: {
            type: "app_mention",
            user: "U123",
            text: "<@B123> help",
            ts: "1710000000.000100",
            channel: "C123",
          },
        },
      })
    ).toMatchObject({
      kind: "remote_agent_slack_event",
      gatewayRequestId: "gw_req_1",
      slackRetryNum: 1,
      slackRetryReason: "http_timeout",
    });
  });
});
