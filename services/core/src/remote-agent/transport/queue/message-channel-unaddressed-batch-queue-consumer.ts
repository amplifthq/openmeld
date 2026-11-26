import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { unaddressedChannelBatchQueueMessageSchema } from "@openmeld/schemas";
import type { CoreBindings } from "../../../lib/bindings";
import { submitUnaddressedLarkPlatformRequest } from "../../application/lark-platform-unaddressed-request-service";
import { submitAdmittedMessageChannelEvent } from "../../application/message-channel-event-service";
import { createConfiguredMessageChannelProviderRegistry } from "../../application/message-channel-provider-runtime";
import {
  createUnaddressedChannelIntakeDependencies,
  flushUnaddressedChannelBatch,
  isUnaddressedChannelIntakeEnabledForConversation,
  UnaddressedChannelIntakeRetryableError,
} from "../../application/message-channel-unaddressed-intake-service";
import { processRemoteAgentSlackEvent } from "../../application/slack-signal-service";
import {
  readUnaddressedSlackWorkspace,
  submitUnaddressedSlackRequest,
} from "../../application/slack-unaddressed-message-service";
import { readRemoteAgentLarkPlatformChannelConnection } from "../../infrastructure/postgresql/lark-platform-channel-connection-repo";

const UNADDRESSED_CHANNEL_BATCH_RETRY_DELAY_SECONDS = 5;

/**
 * Consumes the delayed flush that routes one quiet batch of unaddressed
 * group messages. Returns false when the message is not a batch flush.
 */
export async function handleUnaddressedChannelBatchQueueMessage(input: {
  env: CoreBindings;
  message: Message<unknown>;
}): Promise<boolean> {
  const parsed = unaddressedChannelBatchQueueMessageSchema.safeParse(
    input.message.body
  );
  if (!parsed.success) {
    return false;
  }
  if (
    !isUnaddressedChannelIntakeEnabledForConversation({
      conversationKey: parsed.data.conversationKey,
      env: input.env,
      provider: parsed.data.provider,
    })
  ) {
    // Turning intake off, or unlisting the conversation, stops routing.
    // Waiting messages stay as pending rows;
    // after the pending age limit a later flush expires them, so turning
    // intake back on never routes an old request.
    input.message.ack();
    return true;
  }
  try {
    const db = getPostgresDatabase(input.env);
    const registry = createConfiguredMessageChannelProviderRegistry({
      db,
      env: input.env,
    });
    if (!registry) {
      throw new Error("Message Channel provider registry is unavailable");
    }
    const result = await flushUnaddressedChannelBatch(
      {
        db,
        message: parsed.data,
        nowMs: Date.now(),
        queue: input.env.OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE,
        queueAttempts: input.message.attempts,
      },
      createUnaddressedChannelIntakeDependencies({
        env: input.env,
        async readCurrentConnection({ connectionId, db, provider }) {
          if (provider === "slack") {
            return await readUnaddressedSlackWorkspace({
              db,
              slackTeamId: connectionId,
            });
          }
          const connection = await readRemoteAgentLarkPlatformChannelConnection(
            {
              connectionId,
              db,
            }
          );
          return connection?.provider === provider &&
            connection.status === "connected"
            ? connection
            : null;
        },
        submitRequest(request) {
          if (request.trigger.provider === "slack") {
            return submitUnaddressedSlackRequest(request, {
              processSlackEvent: (payload, context) =>
                processRemoteAgentSlackEvent(input.env, payload, context),
            });
          }
          return submitUnaddressedLarkPlatformRequest(request, {
            readConnection: readRemoteAgentLarkPlatformChannelConnection,
            submitAdmittedEvent: ({ event, source }) =>
              submitAdmittedMessageChannelEvent({
                db,
                env: input.env,
                event,
                identityDb: db,
                registry,
                source,
              }),
          });
        },
      })
    );
    input.message.ack();
    console.info("[core.message_channel.unaddressed_batch_flushed]", {
      batchId: "batchId" in result ? result.batchId : null,
      connectionId: parsed.data.connectionId,
      provider: parsed.data.provider,
      route: "route" in result ? result.route : null,
      status: result.status,
    });
  } catch (error) {
    input.message.retry({
      delaySeconds: UNADDRESSED_CHANNEL_BATCH_RETRY_DELAY_SECONDS,
    });
    console.warn("[core.message_channel.unaddressed_batch_flush_failed]", {
      attempts: input.message.attempts,
      connectionId: parsed.data.connectionId,
      error: error instanceof Error ? error.message : String(error),
      provider: parsed.data.provider,
      reasonCode:
        error instanceof UnaddressedChannelIntakeRetryableError
          ? error.reasonCode
          : "message_channel.unaddressed_batch_flush_failed",
    });
  }
  return true;
}
