import { beforeEach, describe, expect, it, vi } from "vitest";

const processRemoteAgentMessageChannelEvent = vi.hoisted(() => vi.fn());
const providerRegistry = vi.hoisted(() => ({ require: vi.fn() }));

vi.mock("../src/remote-agent/application/message-channel-event-service", () => {
  class RemoteAgentMessageChannelEventRetryableError extends Error {
    readonly reasonCode: string;
    readonly retryAfterMs: number | undefined;

    constructor(reasonCode: string, options: { retryAfterMs?: number } = {}) {
      super(reasonCode);
      this.reasonCode = reasonCode;
      this.retryAfterMs = options.retryAfterMs;
    }
  }
  class RemoteAgentMessageChannelEventTerminalError extends Error {
    readonly reasonCode: string;

    constructor(reasonCode: string) {
      super(reasonCode);
      this.reasonCode = reasonCode;
    }
  }
  return {
    processRemoteAgentMessageChannelEvent,
    RemoteAgentMessageChannelEventRetryableError,
    RemoteAgentMessageChannelEventTerminalError,
  };
});

vi.mock(
  "../src/remote-agent/application/message-channel-provider-runtime",
  () => ({
    createConfiguredMessageChannelProviderRegistry: vi.fn(
      () => providerRegistry
    ),
  })
);

import {
  RemoteAgentMessageChannelEventRetryableError,
  RemoteAgentMessageChannelEventTerminalError,
} from "../src/remote-agent/application/message-channel-event-service";
import {
  handleRemoteAgentMessageChannelEventQueueMessage,
  REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_QUEUE_NAME,
} from "../src/remote-agent/transport/queue/message-channel-event-queue-consumer";

describe("Remote Agent Message Channel event Queue consumer", () => {
  beforeEach(() => {
    processRemoteAgentMessageChannelEvent.mockReset();
  });

  it("acks only after Core settles a normalized provider event", async () => {
    processRemoteAgentMessageChannelEvent.mockResolvedValue({
      deliveryId: "delivery_lark_1",
      status: "submitted",
    });
    const message = createQueueMessage({ attempts: 1 });
    const db = {} as D1Database;

    await expect(
      handleRemoteAgentMessageChannelEventQueueMessage({
        env: {
          OPENMELD_DB: db,
          OPENMELD_LOCAL_STATE_DB: db,
        } as never,
        message: message.value,
        queueName: REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_QUEUE_NAME,
      })
    ).resolves.toBe(true);

    expect(processRemoteAgentMessageChannelEvent).toHaveBeenCalledWith({
      db,
      env: expect.objectContaining({
        OPENMELD_DB: db,
        OPENMELD_LOCAL_STATE_DB: db,
      }),
      envelope: expect.objectContaining({
        kind: "remote_agent_message_channel_event",
        provider: "lark",
        providerEventId: "event_lark_1",
      }),
      identityDb: db,
      queueAttempts: 1,
      queueMessageId: "queue_message_1",
      registry: providerRegistry,
    });
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries a transient event failure without acknowledging it", async () => {
    processRemoteAgentMessageChannelEvent.mockRejectedValue(
      new RemoteAgentMessageChannelEventRetryableError(
        "message_channel.provider_rate_limited",
        { retryAfterMs: 12_000 }
      )
    );
    const message = createQueueMessage({ attempts: 1 });

    await handleRemoteAgentMessageChannelEventQueueMessage({
      env: createEnv(),
      message: message.value,
      queueName: REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_QUEUE_NAME,
    });

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 12 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("acknowledges a durably terminal event without starting another retry cycle", async () => {
    processRemoteAgentMessageChannelEvent.mockRejectedValue(
      new RemoteAgentMessageChannelEventTerminalError(
        "message_channel.provider_unavailable"
      )
    );
    const message = createQueueMessage({ attempts: 4 });
    const send = vi.fn(async () => undefined);

    await handleRemoteAgentMessageChannelEventQueueMessage({
      env: createEnv({ redriveSend: send }),
      message: message.value,
      queueName: REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_QUEUE_NAME,
    });

    expect(send).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("owns malformed messages on its dedicated Queue without leaking them into dispatch routing", async () => {
    const message = createQueueMessage({
      attempts: 1,
      body: { kind: "unexpected_message" },
    });

    await expect(
      handleRemoteAgentMessageChannelEventQueueMessage({
        env: createEnv(),
        message: message.value,
        queueName: REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_QUEUE_NAME,
      })
    ).resolves.toBe(true);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(processRemoteAgentMessageChannelEvent).not.toHaveBeenCalled();
  });
});

function createEnv(input: { redriveSend?: ReturnType<typeof vi.fn> } = {}) {
  const db = {} as D1Database;
  return {
    OPENMELD_DB: db,
    OPENMELD_LOCAL_STATE_DB: db,
    OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE: input.redriveSend
      ? { send: input.redriveSend }
      : undefined,
  } as never;
}

function createQueueMessage(input: { attempts: number; body?: unknown }): {
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
  value: Message<unknown>;
} {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    ack,
    retry,
    value: {
      ack,
      attempts: input.attempts,
      body: input.body ?? createEnvelope(),
      id: "queue_message_1",
      retry,
      timestamp: new Date(),
    },
  };
}

function createEnvelope() {
  return {
    connectionId: "connection_lark_1",
    event: {
      kind: "message",
      locator: {
        appId: "cli_lark_1",
        chatId: "oc_chat_1",
        connectionId: "connection_lark_1",
        provider: "lark",
        rootMessageId: "om_root_1",
        tenantKey: "tenant_lark_1",
        threadId: null,
      },
      mention: "group_mention",
      messageId: "om_message_1",
      resources: [],
      senderId: "ou_member_1",
      sentAtMs: 3000,
      text: "Prepare the launch brief.",
    },
    gatewayRequestId: "gateway_request_1",
    kind: "remote_agent_message_channel_event",
    provider: "lark",
    providerEventId: "event_lark_1",
    receivedAtMs: 3100,
    v: 1,
  };
}
