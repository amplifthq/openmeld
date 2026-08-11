import { messageChannelIngressEnvelopeSchema } from "@openmeld/schemas";
import type { MessageChannelIngressEnvelope } from "@openmeld/schemas/types";
import {
  type CoreBindings,
  identityDb,
  localStateDb,
} from "../../../lib/bindings";
import { emitCoreCloudflareRuntimeEvidence } from "../../../shared/observability/cloudflare-runtime-evidence";
import {
  processRemoteAgentMessageChannelEvent,
  RemoteAgentMessageChannelEventRetryableError,
  RemoteAgentMessageChannelEventTerminalError,
} from "../../application/message-channel-event-service";
import { createConfiguredMessageChannelProviderRegistry } from "../../application/message-channel-provider-runtime";

export const REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_QUEUE_NAME =
  "openmeld-message-channel-events";

const REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_RETRY_DELAY_SECONDS = 5;

export async function handleRemoteAgentMessageChannelEventQueueMessage(input: {
  env: CoreBindings;
  message: Message<unknown>;
  queueName: string;
}): Promise<boolean> {
  const parsed = messageChannelIngressEnvelopeSchema.safeParse(
    input.message.body
  );
  if (
    !parsed.success ||
    (parsed.data.provider !== "lark" && parsed.data.provider !== "feishu")
  ) {
    return handleInvalidDedicatedQueueMessage(input);
  }

  const startedAt = Date.now();
  emitQueueEvidence(input, parsed.data, {
    durationMs: 0,
    event: "core.remote_agent.message_channel.queue_message_started",
    status: "started",
  });
  try {
    const db = localStateDb(input.env);
    const memberIdentityDb = identityDb(input.env);
    if (!(db && memberIdentityDb)) {
      throw new Error("Message Channel Queue databases are unavailable");
    }
    const registry = createConfiguredMessageChannelProviderRegistry({
      db,
      env: input.env,
    });
    if (!registry) {
      throw new Error("Message Channel provider registry is unavailable");
    }
    const result = await processRemoteAgentMessageChannelEvent({
      db,
      env: input.env,
      envelope: parsed.data,
      identityDb: memberIdentityDb,
      queueAttempts: input.message.attempts,
      queueMessageId: input.message.id,
      registry,
    });
    input.message.ack();
    emitQueueEvidence(input, parsed.data, {
      durationMs: Date.now() - startedAt,
      event: "core.remote_agent.message_channel.queue_message_succeeded",
      reasonCode: result.status === "duplicate" ? "duplicate_event" : undefined,
      status: "succeeded",
    });
  } catch (error) {
    scheduleQueueRecovery({
      ...input,
      envelope: parsed.data,
      error,
      startedAt,
    });
  }
  return true;
}

function handleInvalidDedicatedQueueMessage(input: {
  env: CoreBindings;
  message: Message<unknown>;
  queueName: string;
}): boolean {
  if (input.queueName !== REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_QUEUE_NAME) {
    return false;
  }
  console.error("[core.remote_agent.message_channel.queue_message_invalid]", {
    queueMessageId: input.message.id,
    queueName: input.queueName,
  });
  input.message.ack();
  return true;
}

function scheduleQueueRecovery(input: {
  envelope: MessageChannelIngressEnvelope;
  env: CoreBindings;
  error: unknown;
  message: Message<unknown>;
  queueName: string;
  startedAt: number;
}): void {
  const terminal =
    input.error instanceof RemoteAgentMessageChannelEventTerminalError;
  if (terminal) {
    input.message.ack();
  } else {
    input.message.retry({
      delaySeconds: resolveRetryDelaySeconds(input.error),
    });
  }
  const reasonCode =
    input.error instanceof RemoteAgentMessageChannelEventRetryableError ||
    input.error instanceof RemoteAgentMessageChannelEventTerminalError
      ? input.error.reasonCode
      : "message_channel.event_processing_failed";
  console.warn("[core.remote_agent.message_channel.queue_message_failed]", {
    attempts: input.message.attempts,
    error: toErrorMessage(input.error),
    gatewayRequestId: input.envelope.gatewayRequestId,
    provider: input.envelope.provider,
    providerEventId: input.envelope.providerEventId,
    queueMessageId: input.message.id,
    reasonCode,
    retryMode: terminal ? "terminal" : "queue_retry",
    retryScheduled: !terminal,
  });
  emitQueueEvidence(input, input.envelope, {
    durationMs: Date.now() - input.startedAt,
    errorName:
      input.error instanceof Error ? input.error.name : typeof input.error,
    event: "core.remote_agent.message_channel.queue_message_failed",
    reasonCode,
    status: "failed",
  });
}

function resolveRetryDelaySeconds(error: unknown): number {
  if (
    !(
      error instanceof RemoteAgentMessageChannelEventRetryableError &&
      error.retryAfterMs !== undefined
    )
  ) {
    return REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_RETRY_DELAY_SECONDS;
  }
  return Math.max(1, Math.min(300, Math.ceil(error.retryAfterMs / 1000)));
}

function emitQueueEvidence(
  input: {
    env: CoreBindings;
    message: Message<unknown>;
    queueName: string;
  },
  envelope: MessageChannelIngressEnvelope,
  evidence: {
    durationMs: number;
    errorName?: string;
    event: string;
    reasonCode?: string;
    status: "failed" | "started" | "succeeded";
  }
): void {
  emitCoreCloudflareRuntimeEvidence(input.env, {
    clientMessageId: envelope.providerEventId,
    dispatchId: envelope.providerEventId,
    durationMs: evidence.durationMs,
    errorName: evidence.errorName,
    event: evidence.event,
    messageCount: 1,
    operation: input.queueName,
    reasonCode: evidence.reasonCode,
    requestId: envelope.gatewayRequestId,
    runtimeKind: "queue",
    status: evidence.status,
    workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
