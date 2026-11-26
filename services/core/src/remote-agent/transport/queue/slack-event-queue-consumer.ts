import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { remoteAgentSlackEventQueueMessageSchema } from "@openmeld/schemas";
import type { RemoteAgentSlackEventQueueMessage } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../../lib/bindings";
import { emitCoreCloudflareRuntimeEvidence } from "../../../shared/observability/cloudflare-runtime-evidence";
import {
  isUnaddressedChannelIntakeEnabled,
  isUnaddressedChannelIntakeEnabledForConversation,
  settleUnaddressedChannelMessagesAnsweredByMention,
} from "../../application/message-channel-unaddressed-intake-service";
import { RemoteAgentSlackSubmissionOutcomeUnknownError } from "../../application/native-delivery-service";
import {
  processRemoteAgentSlackEvent,
  REMOTE_AGENT_SLACK_EVENT_MAX_QUEUE_ATTEMPTS,
} from "../../application/slack-signal-service";
import {
  observeUnaddressedSlackChannelMessage,
  readUnaddressedSlackWorkspace,
  settleUnaddressedSlackMessagesForMention,
} from "../../application/slack-unaddressed-message-service";
import { recordUnaddressedChannelMessage } from "../../infrastructure/postgresql/message-channel-unaddressed-message-repo";

const REMOTE_AGENT_SLACK_EVENT_RETRY_DELAY_SECONDS = 5;
const REMOTE_AGENT_SLACK_EVENT_REDRIVE_DELAY_SECONDS = 60;

// receivedAtMs survives fresh Queue messages and does not require a healthy
// database. Slow an old unsettled event without changing its identity or
// discarding the durable recovery obligation.
function recoveryDelay(receivedAtMs: number, minimum: number): number {
  const ageSeconds = Math.max(0, (Date.now() - receivedAtMs) / 1000);
  return Math.min(3600, Math.max(minimum, Math.floor(ageSeconds / 4)));
}

export async function handleRemoteAgentSlackEventQueueMessage(input: {
  env: CoreBindings;
  message: Message<unknown>;
  queueName: string;
}): Promise<boolean> {
  const parsed = remoteAgentSlackEventQueueMessageSchema.safeParse(
    input.message.body
  );
  if (!parsed.success) {
    return false;
  }

  if (await handleUnaddressedSlackChannelMessage(input, parsed.data)) {
    return true;
  }

  const startedAt = Date.now();
  const eventId = parsed.data.payload.event_id ?? null;
  emitCoreCloudflareRuntimeEvidence(input.env, {
    clientMessageId: eventId,
    dispatchId: eventId,
    durationMs: 0,
    event: "core.remote_agent.slack_event.queue_message_started",
    messageCount: 1,
    operation: input.queueName,
    requestId: parsed.data.gatewayRequestId,
    runtimeKind: "queue",
    status: "started",
    workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
  });

  try {
    const outcome = await processRemoteAgentSlackEvent(
      input.env,
      parsed.data.payload,
      {
        finalAttempt:
          input.message.attempts >= REMOTE_AGENT_SLACK_EVENT_MAX_QUEUE_ATTEMPTS,
        gatewayRequestId: parsed.data.gatewayRequestId,
        queueAttempts: input.message.attempts,
        queueMessageId: input.message.id,
        receivedAtMs: parsed.data.receivedAtMs,
        slackRetryNum: parsed.data.slackRetryNum,
        slackRetryReason: parsed.data.slackRetryReason,
      }
    );
    if (outcome.status === "recovery_pending") {
      await enqueueRemoteAgentSlackEventRedrive(input.env, parsed.data);
    }
    input.message.ack();
    emitCoreCloudflareRuntimeEvidence(input.env, {
      clientMessageId: eventId,
      dispatchId: eventId,
      durationMs: Date.now() - startedAt,
      event: "core.remote_agent.slack_event.queue_message_succeeded",
      messageCount: 1,
      operation: input.queueName,
      reasonCode:
        outcome.status === "duplicate" ? "duplicate_event" : undefined,
      requestId: parsed.data.gatewayRequestId,
      runtimeKind: "queue",
      status: "succeeded",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
    });
    return true;
  } catch (error) {
    const finalAttempt =
      input.message.attempts >= REMOTE_AGENT_SLACK_EVENT_MAX_QUEUE_ATTEMPTS;
    const retryMode = finalAttempt ? "fresh_redrive" : "queue_retry";
    try {
      if (finalAttempt) {
        await enqueueRemoteAgentSlackEventRedrive(input.env, parsed.data);
        input.message.ack();
      } else {
        input.message.retry({
          delaySeconds: recoveryDelay(
            parsed.data.receivedAtMs,
            REMOTE_AGENT_SLACK_EVENT_RETRY_DELAY_SECONDS
          ),
        });
      }
    } catch (redriveError) {
      console.error("[core.remote_agent.slack_event.redrive_enqueue_failed]", {
        attempts: input.message.attempts,
        error: toErrorMessage(error),
        eventId,
        gatewayRequestId: parsed.data.gatewayRequestId,
        queueMessageId: input.message.id,
        redriveError: toErrorMessage(redriveError),
      });
      throw redriveError;
    }
    console.warn("[core.remote_agent.slack_event.queue_message_failed]", {
      attempts: input.message.attempts,
      error: toErrorMessage(error),
      eventId,
      gatewayRequestId: parsed.data.gatewayRequestId,
      queueMessageId: input.message.id,
      reasonCode:
        error instanceof RemoteAgentSlackSubmissionOutcomeUnknownError
          ? error.reasonCode
          : "remote_agent.slack_event_processing_failed",
      retryMode,
      retryScheduled: true,
      slackRetryNum: parsed.data.slackRetryNum,
      slackRetryReason: parsed.data.slackRetryReason,
    });
    emitCoreCloudflareRuntimeEvidence(input.env, {
      clientMessageId: eventId,
      dispatchId: eventId,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : typeof error,
      event: "core.remote_agent.slack_event.queue_message_failed",
      messageCount: 1,
      operation: input.queueName,
      reasonCode:
        error instanceof RemoteAgentSlackSubmissionOutcomeUnknownError
          ? error.reasonCode
          : "remote_agent.slack_event_processing_failed",
      requestId: parsed.data.gatewayRequestId,
      runtimeKind: "queue",
      status: "failed",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
    });
    return true;
  }
}

/**
 * Archives an ordinary channel message nobody addressed to the app. Returns
 * false for every other event, which then takes the addressed Slack path.
 */
async function handleUnaddressedSlackChannelMessage(
  input: { env: CoreBindings; message: Message<unknown> },
  queueMessage: RemoteAgentSlackEventQueueMessage
): Promise<boolean> {
  if (!isUnaddressedChannelIntakeEnabled(input.env)) {
    return false;
  }
  const eventId = queueMessage.payload.event_id ?? null;
  // A real app mention owns the turn for what it covers. Settle the waiting
  // messages before the turn starts; if that keeps failing, the mention still
  // gets its turn and the waiting batch may start a second one.
  try {
    await settleUnaddressedSlackMessagesForMention(
      {
        getDb: () => getPostgresDatabase(input.env),
        nowMs: Date.now(),
        payload: queueMessage.payload,
      },
      { settle: settleUnaddressedChannelMessagesAnsweredByMention }
    );
  } catch (error) {
    const finalAttempt =
      input.message.attempts >= REMOTE_AGENT_SLACK_EVENT_MAX_QUEUE_ATTEMPTS;
    console.warn("[core.remote_agent.slack_event.unaddressed_settle_failed]", {
      attempts: input.message.attempts,
      error: toErrorMessage(error),
      eventId,
      proceeding: finalAttempt,
    });
    if (!finalAttempt) {
      input.message.retry({
        delaySeconds: REMOTE_AGENT_SLACK_EVENT_RETRY_DELAY_SECONDS,
      });
      return true;
    }
  }
  try {
    const observation = await observeUnaddressedSlackChannelMessage(
      {
        getDb: () => getPostgresDatabase(input.env),
        isConversationAllowed: (channel) =>
          isUnaddressedChannelIntakeEnabledForConversation({
            conversationKey: channel,
            env: input.env,
            provider: "slack",
          }),
        nowMs: Date.now(),
        payload: queueMessage.payload,
        queue: input.env.OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE,
      },
      {
        readWorkspace: readUnaddressedSlackWorkspace,
        recordMessage: recordUnaddressedChannelMessage,
      }
    );
    if (!observation) {
      return false;
    }
    input.message.ack();
    console.info("[core.remote_agent.slack_event.unaddressed_message]", {
      eventId,
      reasonCode: "reasonCode" in observation ? observation.reasonCode : null,
      status: observation.status,
    });
  } catch (error) {
    // Archiving is best effort: nobody is waiting for a reply to this
    // message, so a message that still cannot be archived is dropped.
    const finalAttempt =
      input.message.attempts >= REMOTE_AGENT_SLACK_EVENT_MAX_QUEUE_ATTEMPTS;
    if (finalAttempt) {
      input.message.ack();
    } else {
      input.message.retry({
        delaySeconds: REMOTE_AGENT_SLACK_EVENT_RETRY_DELAY_SECONDS,
      });
    }
    console.warn("[core.remote_agent.slack_event.unaddressed_message_failed]", {
      attempts: input.message.attempts,
      dropped: finalAttempt,
      error: toErrorMessage(error),
      eventId,
      gatewayRequestId: queueMessage.gatewayRequestId,
    });
  }
  return true;
}

async function enqueueRemoteAgentSlackEventRedrive(
  env: CoreBindings,
  message: RemoteAgentSlackEventQueueMessage
): Promise<void> {
  const redriveQueue = env.OPENMELD_DAEMON_DISPATCH_QUEUE;
  if (!redriveQueue) {
    throw new Error("Remote Agent Slack recovery queue is unavailable");
  }
  await redriveQueue.send(message, {
    delaySeconds: recoveryDelay(
      message.receivedAtMs,
      REMOTE_AGENT_SLACK_EVENT_REDRIVE_DELAY_SECONDS
    ),
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
