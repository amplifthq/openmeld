import type { UnaddressedChannelBatchQueueMessage } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import type {
  UnaddressedChannelBatchRequest,
  UnaddressedChannelIntakeDependencies,
} from "../src/remote-agent/application/message-channel-unaddressed-intake-service";

const processRemoteAgentSlackEvent = vi.hoisted(() => vi.fn());
const flushUnaddressedChannelBatch = vi.hoisted(() => vi.fn());

vi.mock("@openmeld/db/postgresql", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openmeld/db/postgresql")>()),
  getPostgresDatabase: () => ({}),
}));

vi.mock(
  "../src/remote-agent/application/slack-signal-service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/remote-agent/application/slack-signal-service")
    >()),
    processRemoteAgentSlackEvent,
  })
);

vi.mock(
  "../src/remote-agent/application/message-channel-unaddressed-intake-service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/remote-agent/application/message-channel-unaddressed-intake-service")
    >()),
    flushUnaddressedChannelBatch,
  })
);

import { handleUnaddressedChannelBatchQueueMessage } from "../src/remote-agent/transport/queue/message-channel-unaddressed-batch-queue-consumer";

describe("unaddressed Channel batch queue consumer without Lark or Feishu", () => {
  const classifyUnaddressedChannelBatch = vi.fn();
  // Slack intake is on; both Lark-platform providers are off, so no provider
  // registry exists.
  const env = {
    OPENMELD_FEISHU_CHANNEL_ENABLED: "false",
    OPENMELD_LARK_CHANNEL_ENABLED: "false",
    OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_CONVERSATIONS: "*",
    OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_ENABLED: "true",
    OPENMELD_REMOTE_AGENT_WORKER: { classifyUnaddressedChannelBatch },
  } as unknown as CoreBindings;

  beforeEach(() => {
    processRemoteAgentSlackEvent.mockReset();
    processRemoteAgentSlackEvent.mockResolvedValue({ status: "processed" });
    classifyUnaddressedChannelBatch.mockReset();
    classifyUnaddressedChannelBatch.mockResolvedValue({ route: "new_request" });
    flushUnaddressedChannelBatch.mockReset();
    // Stands in for the flush: classify, then submit the one claimed message.
    flushUnaddressedChannelBatch.mockImplementation(
      async (
        input: { message: UnaddressedChannelBatchQueueMessage },
        dependencies: UnaddressedChannelIntakeDependencies
      ) => {
        const trigger = createTrigger(input.message.provider);
        const route = await dependencies.classifyBatch({
          batchId: "batch_1",
          messages: [
            {
              attachmentCount: 0,
              messageId: trigger.messageId,
              senderId: trigger.senderId,
              text: trigger.text,
            },
          ],
          organizationId: trigger.organizationId,
          provider: input.message.provider,
          thread: { hasPriorAgentTurn: false, isThreadReply: false },
        });
        const submission = await dependencies.submitRequest({
          db: {} as UnaddressedChannelBatchRequest["db"],
          requestEventId: `unaddressed-batch:${trigger.messageId}`,
          text: trigger.text,
          trigger,
        });
        return { batchId: "batch_1", route, status: submission.status };
      }
    );
  });

  it("classifies and submits a Slack batch", async () => {
    const message = createQueueMessage("slack");
    await expect(
      handleUnaddressedChannelBatchQueueMessage({ env, message })
    ).resolves.toBe(true);
    expect(classifyUnaddressedChannelBatch).toHaveBeenCalledOnce();
    expect(processRemoteAgentSlackEvent).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        event: expect.objectContaining({
          channel: "C123",
          text: "the export job is failing again",
        }),
        team_id: "T123",
      }),
      expect.objectContaining({
        addressed: false,
        archivedUnder: { connectionGeneration: 7, organizationId: "org_1" },
      })
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries a Feishu batch, which cannot be submitted without the registry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const message = createQueueMessage("feishu");
    await expect(
      handleUnaddressedChannelBatchQueueMessage({ env, message })
    ).resolves.toBe(true);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 5 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(processRemoteAgentSlackEvent).not.toHaveBeenCalled();
    // Classification ran; the missing registry is what stopped submission.
    expect(classifyUnaddressedChannelBatch).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[core.message_channel.unaddressed_batch_flush_failed]",
      expect.objectContaining({
        error: "Message Channel provider registry is unavailable",
      })
    );
    warn.mockRestore();
  });
});

function createTrigger(
  provider: UnaddressedChannelBatchQueueMessage["provider"]
): UnaddressedChannelBatchRequest["trigger"] {
  const slack = provider === "slack";
  return {
    batchId: "batch_1",
    batchKey: "sender:U123",
    connectionGeneration: 7,
    connectionId: slack ? "T123" : "connection_feishu_1",
    conversationKey: slack ? "C123" : "oc_chat_1",
    messageId: slack ? "1710000000.000100" : "om_1",
    nativeDeliveryId: null,
    observedAtMs: 1000,
    organizationId: "org_1",
    provider,
    resources: [],
    rootMessageId: slack ? "1710000000.000100" : "om_1",
    route: null,
    senderId: "U123",
    senderTenantKey: null,
    sentAtMs: 1000,
    slackFiles: [],
    source: "push",
    state: "routing",
    text: "the export job is failing again",
    threadId: null,
  };
}

function createQueueMessage(
  provider: UnaddressedChannelBatchQueueMessage["provider"]
) {
  return {
    ack: vi.fn(),
    attempts: 1,
    body: {
      batchKey: "sender:U123",
      connectionId: provider === "slack" ? "T123" : "connection_feishu_1",
      conversationKey: provider === "slack" ? "C123" : "oc_chat_1",
      kind: "remote_agent_message_channel_unaddressed_batch",
      provider,
      scheduledByObservedAtMs: 1000,
      v: 1,
    },
    id: "queue_message_1",
    retry: vi.fn(),
    timestamp: new Date(1000),
  } satisfies Message<unknown>;
}
