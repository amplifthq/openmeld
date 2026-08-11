import { describe, expect, it } from "vitest";
import {
  assertExecutionRecoveryDestinationMatchesDelivery,
  resolveExecutionRecoveryDestination,
} from "../execution-recovery/application/execution-recovery-destination";
import type { RemoteAgentNativeDeliveryRecord } from "../remote-agent/infrastructure/d1/native-delivery-ledger-repo";

const baseDelivery = {
  conversationKind: "space",
  messageChannelLocator: null,
  slackChannelId: null,
  slackTeamId: null,
  slackThreadTs: null,
  spaceId: "space-1",
  threadContext: {
    rootSignalId: "signal-1",
    threadId: "thread-1",
  },
} as unknown as RemoteAgentNativeDeliveryRecord;

describe("execution recovery originating destination", () => {
  it("projects the immutable Slack thread captured at admission", () => {
    const delivery = {
      ...baseDelivery,
      conversationKind: "slack" as const,
      slackChannelId: "channel-1",
      slackTeamId: "team-1",
      slackThreadTs: "123.456",
      threadContext: null,
    };

    expect(
      resolveExecutionRecoveryDestination({
        delivery,
        fallbackSpaceId: "space-1",
        fallbackThreadId: "different-thread",
      })
    ).toEqual({
      conversationId: "channel-1",
      messageId: "123.456",
      spaceId: "space-1",
      surface: "slack",
    });
  });

  it.each([
    "lark",
    "feishu",
  ] as const)("projects the immutable %s conversation as the Lark product surface", (provider) => {
    const delivery = {
      ...baseDelivery,
      conversationKind: "message_channel" as const,
      messageChannelLocator: {
        appId: "app-1",
        chatId: "chat-1",
        connectionId: "connection-1",
        provider,
        rootMessageId: "message-1",
        tenantKey: "tenant-1",
        threadId: null,
      },
      threadContext: null,
    };

    expect(
      resolveExecutionRecoveryDestination({
        delivery,
        fallbackSpaceId: "space-1",
        fallbackThreadId: null,
      })
    ).toEqual({
      conversationId: "chat-1",
      messageId: "message-1",
      spaceId: "space-1",
      surface: "lark",
    });
  });

  it("rejects a caller-selected surface before publication I/O", () => {
    const delivery = {
      ...baseDelivery,
      conversationKind: "slack" as const,
      slackChannelId: "channel-1",
      slackTeamId: "team-1",
      slackThreadTs: "123.456",
      threadContext: null,
    };

    expect(() =>
      assertExecutionRecoveryDestinationMatchesDelivery({
        delivery,
        destination: {
          conversationId: "other-channel",
          messageId: "123.456",
          spaceId: "space-1",
          surface: "slack",
        },
      })
    ).toThrow("execution_recovery.destination_mismatch");
  });
});
