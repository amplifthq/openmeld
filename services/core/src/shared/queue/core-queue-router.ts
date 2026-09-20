import { handleAgentProfileCreationMessage } from "../../agent-profile-creation-request/agent-profile-creation-execution";
import { handleDispatchQueueBatch } from "../../dispatch/transport/queue/dispatch-queue-consumer";
import type { CoreBindings } from "../../lib/bindings";
import { handleRemoteAgentMessageChannelEventQueueMessage } from "../../remote-agent/transport/queue/message-channel-event-queue-consumer";
import { handleRemoteAgentSlackEventQueueMessage } from "../../remote-agent/transport/queue/slack-event-queue-consumer";

export async function handleCoreQueueBatch(input: {
  batch: MessageBatch<unknown>;
  ctx: ExecutionContext;
  env: CoreBindings;
}): Promise<void> {
  const dispatchMessages: Message<unknown>[] = [];
  const creationMessages: Message<unknown>[] = [];

  for (const message of input.batch.messages) {
    if (
      message.body &&
      typeof message.body === "object" &&
      "kind" in message.body &&
      message.body.kind === "agent_profile_creation"
    ) {
      creationMessages.push(message);
      continue;
    }
    const handled = await handleRemoteAgentSlackEventQueueMessage({
      env: input.env,
      message,
      queueName: input.batch.queue,
    });
    const messageChannelHandled = handled
      ? true
      : await handleRemoteAgentMessageChannelEventQueueMessage({
          env: input.env,
          message,
          queueName: input.batch.queue,
        });
    if (!messageChannelHandled) {
      dispatchMessages.push(message);
    }
  }

  await Promise.all([
    ...creationMessages.map((message) =>
      handleAgentProfileCreationMessage({ env: input.env, message })
    ),
    ...(dispatchMessages.length === 0
      ? []
      : [
          handleDispatchQueueBatch({
            batch: createFilteredMessageBatch({
              messages: dispatchMessages,
              metadata: input.batch.metadata,
              queue: input.batch.queue,
            }),
            ctx: input.ctx,
            env: input.env,
          }),
        ]),
  ]);
}

function createFilteredMessageBatch(input: {
  messages: Message<unknown>[];
  metadata: MessageBatch<unknown>["metadata"];
  queue: string;
}): MessageBatch<unknown> {
  return {
    ackAll() {
      for (const message of input.messages) {
        message.ack();
      }
    },
    messages: input.messages,
    metadata: input.metadata,
    queue: input.queue,
    retryAll(options) {
      for (const message of input.messages) {
        message.retry(options);
      }
    },
  };
}
