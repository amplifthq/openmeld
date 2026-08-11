import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAgentSlackSubmissionOutcomeUnknownError } from "../src/remote-agent/application/native-delivery-service";

const processRemoteAgentSlackEvent = vi.hoisted(() => vi.fn());

vi.mock("../src/remote-agent/application/slack-signal-service", () => {
  return {
    processRemoteAgentSlackEvent,
    REMOTE_AGENT_SLACK_EVENT_MAX_QUEUE_ATTEMPTS: 4,
  };
});

import { handleRemoteAgentSlackEventQueueMessage } from "../src/remote-agent/transport/queue/slack-event-queue-consumer";

describe("Remote Agent Slack event queue consumer", () => {
  beforeEach(() => {
    processRemoteAgentSlackEvent.mockReset();
  });

  it("acks a processed event and forwards queue and Slack retry evidence", async () => {
    processRemoteAgentSlackEvent.mockResolvedValue({ status: "processed" });
    const message = createQueueMessage({ attempts: 2 });

    await handleRemoteAgentSlackEventQueueMessage({
      env: {} as never,
      message: message.value,
      queueName: "openmeld-daemon-dispatch",
    });

    expect(processRemoteAgentSlackEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ event_id: "Ev123" }),
      expect.objectContaining({
        finalAttempt: false,
        gatewayRequestId: "gateway-request-1",
        queueAttempts: 2,
        queueMessageId: "queue-message-1",
        slackRetryNum: 1,
        slackRetryReason: "http_timeout",
      })
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries an ambiguous worker submission without acknowledging it", async () => {
    processRemoteAgentSlackEvent.mockRejectedValue(
      new RemoteAgentSlackSubmissionOutcomeUnknownError("RPC disconnected")
    );
    const message = createQueueMessage({ attempts: 1 });

    await handleRemoteAgentSlackEventQueueMessage({
      env: {} as never,
      message: message.value,
      queueName: "openmeld-daemon-dispatch",
    });

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 5 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("retries ordinary transient failures without acknowledging them", async () => {
    processRemoteAgentSlackEvent.mockRejectedValue(
      new Error("D1 temporarily unavailable")
    );
    const message = createQueueMessage({ attempts: 1 });

    await handleRemoteAgentSlackEventQueueMessage({
      env: {} as never,
      message: message.value,
      queueName: "openmeld-daemon-dispatch",
    });

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 5 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("durably redrives an unsettled failure before acknowledging the final Queue attempt", async () => {
    processRemoteAgentSlackEvent.mockRejectedValue(
      new RemoteAgentSlackSubmissionOutcomeUnknownError("RPC disconnected")
    );
    const message = createQueueMessage({ attempts: 4 });
    const send = vi.fn().mockResolvedValue(undefined);

    await handleRemoteAgentSlackEventQueueMessage({
      env: { OPENMELD_DAEMON_DISPATCH_QUEUE: { send } } as never,
      message: message.value,
      queueName: "openmeld-daemon-dispatch",
    });

    expect(processRemoteAgentSlackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ OPENMELD_DAEMON_DISPATCH_QUEUE: { send } }),
      expect.anything(),
      expect.objectContaining({ finalAttempt: true })
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayRequestId: "gateway-request-1",
        payload: expect.objectContaining({ event_id: "Ev123" }),
      }),
      { delaySeconds: 60 }
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("acks a failure only after its visible failure result is settled", async () => {
    processRemoteAgentSlackEvent.mockResolvedValue({ status: "failed" });
    const message = createQueueMessage({ attempts: 4 });

    await handleRemoteAgentSlackEventQueueMessage({
      env: {} as never,
      message: message.value,
      queueName: "openmeld-daemon-dispatch",
    });

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("durably re-enqueues a failed ingress before acknowledging the exhausted message", async () => {
    processRemoteAgentSlackEvent.mockResolvedValue({
      status: "recovery_pending",
    });
    const message = createQueueMessage({ attempts: 4 });
    const send = vi.fn().mockResolvedValue(undefined);

    await handleRemoteAgentSlackEventQueueMessage({
      env: { OPENMELD_DAEMON_DISPATCH_QUEUE: { send } } as never,
      message: message.value,
      queueName: "openmeld-daemon-dispatch",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayRequestId: "gateway-request-1",
        payload: expect.objectContaining({ event_id: "Ev123" }),
      }),
      { delaySeconds: 60 }
    );
    const redriveBody = send.mock.calls[0]?.[0];
    expect(redriveBody?.payload).not.toHaveProperty("token");
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });
});

function createQueueMessage(input: { attempts: number }): {
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
      body: {
        gatewayRequestId: "gateway-request-1",
        kind: "remote_agent_slack_event",
        payload: {
          api_app_id: "A123",
          event: {
            channel: "C123",
            event_ts: "1710000000.000100",
            text: "<@B123> help",
            ts: "1710000000.000100",
            type: "app_mention",
            user: "U123",
          },
          event_id: "Ev123",
          event_time: 1_710_000_000,
          team_id: "T123",
          token: "verification-token",
          type: "event_callback",
        },
        receivedAtMs: 1_710_000_000_000,
        slackRetryNum: 1,
        slackRetryReason: "http_timeout",
        v: 1,
      },
      id: "queue-message-1",
      retry,
      timestamp: new Date(),
    },
  };
}
