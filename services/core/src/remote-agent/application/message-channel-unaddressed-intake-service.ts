import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  classifyUnaddressedChannelBatchResponseSchema,
  MESSAGE_CHANNEL_EVENT_TEXT_MAX_CHARS,
  UNADDRESSED_CHANNEL_BATCH_MAX_MESSAGES,
  UNADDRESSED_CHANNEL_BATCH_MESSAGE_TEXT_MAX_CHARS,
  unaddressedChannelBatchQueueMessageSchema,
} from "@openmeld/schemas";
import type {
  ClassifyUnaddressedChannelBatchInput,
  NormalizedMessageChannelEvent,
  UnaddressedChannelBatchQueueMessage,
  UnaddressedChannelBatchRoute,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../infrastructure/postgresql/lark-platform-channel-connection-repo";
import { readRemoteAgentLarkPlatformContextCursor } from "../infrastructure/postgresql/lark-platform-context-cursor-repo";
import {
  archiveClaimedUnaddressedChannelMessages,
  claimDueUnaddressedChannelBatch,
  expireStaleUnaddressedChannelMessages,
  recordUnaddressedChannelBatchAdmission,
  type recordUnaddressedChannelMessage,
  releaseUnaddressedChannelBatch,
  settleUnaddressedChannelBatch,
  settleUnaddressedChannelMessagesForMention,
  type UnaddressedChannelBatchClaim,
  type UnaddressedChannelMessageRecord,
} from "../infrastructure/postgresql/message-channel-unaddressed-message-repo";

/** A burst is routed once no new message has arrived for this long. */
export const UNADDRESSED_CHANNEL_QUIET_WINDOW_MS = 8000;
/** A steady stream is still routed after its oldest message waits this long. */
export const UNADDRESSED_CHANNEL_MAX_WAIT_MS = 30_000;
const UNADDRESSED_CHANNEL_BATCH_CLAIM_LEASE_MS = 120_000;
export const UNADDRESSED_CHANNEL_BATCH_MAX_QUEUE_ATTEMPTS = 4;
/**
 * A message still waiting after this long is never routed. Normal routing
 * settles within the max wait plus queue retries and one expired claim lease;
 * anything older was orphaned (a lost flush, or intake turned off and on) and
 * must not resurface as a request.
 */
export const UNADDRESSED_CHANNEL_MAX_PENDING_AGE_MS = 10 * 60_000;

type LarkPlatformProvider = "feishu" | "lark";
type MessageEvent = Extract<NormalizedMessageChannelEvent, { kind: "message" }>;
type UnaddressedChannelBatchQueue = {
  send(
    message: UnaddressedChannelBatchQueueMessage,
    options?: { delaySeconds?: number }
  ): Promise<unknown>;
};

export type UnaddressedChannelObservationResult =
  | {
      status: "observed";
    }
  | {
      reasonCode: string;
      status: "ignored";
    };

export type UnaddressedChannelBatchSubmission =
  | {
      deliveryId: string | null;
      status: "submitted";
    }
  | {
      reasonCode: string;
      status: "not_submitted";
    };

export type UnaddressedChannelBatchFlushResult =
  | {
      status: "empty" | "rescheduled" | "superseded";
    }
  | {
      batchId: string;
      route: UnaddressedChannelBatchRoute | "unrouted";
      status: "archived";
    }
  | {
      batchId: string;
      deliveryId: string | null;
      route: "follow_up" | "new_request";
      status: "routed";
    };

export type UnaddressedChannelIntakeDependencies = {
  /** Archives some messages of a claimed batch; the rest keep the claim. */
  archiveClaimedMessages(
    input: Parameters<typeof archiveClaimedUnaddressedChannelMessages>[0]
  ): Promise<number>;
  claimBatch(
    input: Parameters<typeof claimDueUnaddressedChannelBatch>[0]
  ): Promise<UnaddressedChannelBatchClaim>;
  classifyBatch(
    input: ClassifyUnaddressedChannelBatchInput
  ): Promise<UnaddressedChannelBatchRoute>;
  expireStaleMessages(
    input: Parameters<typeof expireStaleUnaddressedChannelMessages>[0]
  ): Promise<number>;
  hasPriorAgentTurn(input: {
    db: PostgresDatabase;
    trigger: UnaddressedChannelMessageRecord;
  }): Promise<boolean>;
  readCurrentConnection(input: {
    db: PostgresDatabase;
    connectionId: string;
    provider: UnaddressedChannelBatchQueueMessage["provider"];
  }): Promise<{
    connectionGeneration: number;
    organizationId: string;
  } | null>;
  /** Stores an admitted batch's route before its request is submitted. */
  recordBatchAdmission(
    input: Parameters<typeof recordUnaddressedChannelBatchAdmission>[0]
  ): Promise<number>;
  releaseBatch(
    input: Parameters<typeof releaseUnaddressedChannelBatch>[0]
  ): Promise<number>;
  settleBatch(
    input: Parameters<typeof settleUnaddressedChannelBatch>[0]
  ): Promise<number>;
  /**
   * Starts one Center Agent turn through the provider's ordinary addressed
   * path, so sender authority, quota, and failure handling stay the same.
   */
  submitRequest(
    input: UnaddressedChannelBatchRequest
  ): Promise<UnaddressedChannelBatchSubmission>;
};

/**
 * The one input for the turn. A batch holds one sender's messages, so that
 * sender is the requester and `text` holds only their words; other people's
 * messages in the thread stay reference material in the conversation.
 */
export type UnaddressedChannelBatchRequest = {
  db: PostgresDatabase;
  /** Stable across retries so the provider path deduplicates the request. */
  requestEventId: string;
  text: string;
  /** Provider downloads are addressed by the owning message, so only the
   * trigger message's own files can be attached to the turn. */
  trigger: UnaddressedChannelMessageRecord;
};

export type UnaddressedChannelObservationDependencies = {
  recordMessage(
    input: Parameters<typeof recordUnaddressedChannelMessage>[0]
  ): Promise<{ inserted: boolean }>;
};

export class UnaddressedChannelIntakeRetryableError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, options: { cause?: unknown } = {}) {
    super(reasonCode);
    this.name = "UnaddressedChannelIntakeRetryableError";
    this.reasonCode = reasonCode;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isUnaddressedChannelIntakeEnabled(
  env: Pick<CoreBindings, "OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_ENABLED">
): boolean {
  return env.OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_ENABLED === "true";
}

export type UnaddressedChannelIntakePolicyEnvironment = Pick<
  CoreBindings,
  | "OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_CONVERSATIONS"
  | "OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_ENABLED"
>;

/**
 * Intake runs only in conversations an operator listed. Each entry of
 * `OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_CONVERSATIONS` is
 * `<provider>:<conversation id>` (a Feishu chat id or a Slack channel id);
 * `*` lists every conversation. An empty list admits none, so turning the
 * flag on alone never starts listening anywhere.
 */
export function isUnaddressedChannelIntakeEnabledForConversation(input: {
  conversationKey: string;
  env: UnaddressedChannelIntakePolicyEnvironment;
  provider: string;
}): boolean {
  if (!isUnaddressedChannelIntakeEnabled(input.env)) {
    return false;
  }
  const conversations = new Set(
    String(
      input.env.OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_CONVERSATIONS ?? ""
    )
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  return (
    conversations.has("*") ||
    conversations.has(`${input.provider}:${input.conversationKey.trim()}`)
  );
}

/**
 * A batch is one person's consecutive messages: their top-level messages in
 * the conversation, or their replies in one thread. Keeping senders apart
 * means a turn only ever carries its own requester's words and authority;
 * the thread's other messages still reach the model as Channel context.
 */
export function buildUnaddressedChannelBatchKey(input: {
  messageId: string;
  rootMessageId: string;
  senderId: string;
}): string {
  return input.rootMessageId === input.messageId
    ? `sender:${input.senderId}`
    : `thread:${input.rootMessageId}:sender:${input.senderId}`;
}

/**
 * Stops the waiting messages that an addressed mention already covers from
 * being routed as a second turn: the mentioning sender's own top-level
 * messages for a top-level mention, or the whole thread for a reply. The
 * mention's turn reads those messages as Channel context.
 */
export async function settleUnaddressedChannelMessagesAnsweredByMention(input: {
  connectionId: string;
  conversationKey: string;
  db: PostgresDatabase;
  messageId: string;
  nowMs: number;
  provider: UnaddressedChannelBatchQueueMessage["provider"];
  rootMessageId: string;
  senderId: string;
  sentAtMs: number;
}): Promise<number> {
  return await settleUnaddressedChannelMessagesForMention({
    connectionId: input.connectionId,
    conversationKey: input.conversationKey,
    db: input.db,
    nowMs: input.nowMs,
    provider: input.provider,
    scope:
      input.rootMessageId === input.messageId
        ? { batchKey: buildUnaddressedChannelBatchKey(input) }
        : { rootMessageId: input.rootMessageId },
    // A Slack message id is its timestamp to the microsecond, so it orders
    // messages that share the mention's millisecond.
    ...(input.provider === "slack"
      ? { sentThroughMessageId: input.messageId }
      : {}),
    sentThroughMs: input.sentAtMs,
  });
}

export function createUnaddressedChannelIntakeDependencies(input: {
  env: CoreBindings;
  readCurrentConnection: UnaddressedChannelIntakeDependencies["readCurrentConnection"];
  submitRequest: UnaddressedChannelIntakeDependencies["submitRequest"];
}): UnaddressedChannelIntakeDependencies {
  return {
    archiveClaimedMessages: archiveClaimedUnaddressedChannelMessages,
    claimBatch: claimDueUnaddressedChannelBatch,
    expireStaleMessages: expireStaleUnaddressedChannelMessages,
    async classifyBatch(request) {
      const worker = input.env.OPENMELD_REMOTE_AGENT_WORKER;
      if (!worker?.classifyUnaddressedChannelBatch) {
        throw new UnaddressedChannelIntakeRetryableError(
          "message_channel.unaddressed_classifier_unavailable"
        );
      }
      const response = classifyUnaddressedChannelBatchResponseSchema.safeParse(
        await worker.classifyUnaddressedChannelBatch(request)
      );
      if (!response.success) {
        throw new UnaddressedChannelIntakeRetryableError(
          "message_channel.unaddressed_classifier_response_invalid"
        );
      }
      return response.data.route;
    },
    async hasPriorAgentTurn({ db, trigger }) {
      // Slack keeps no per-thread record that Core can read here, so a Slack
      // batch is always routed as a new request in its own thread.
      if (
        trigger.provider === "slack" ||
        trigger.connectionGeneration === null
      ) {
        return false;
      }
      const cursor = await readRemoteAgentLarkPlatformContextCursor({
        chatId: trigger.conversationKey,
        connectionGeneration: trigger.connectionGeneration,
        connectionId: trigger.connectionId,
        db,
        organizationId: trigger.organizationId,
        rootMessageId: trigger.rootMessageId,
      });
      return cursor !== null;
    },
    readCurrentConnection: input.readCurrentConnection,
    recordBatchAdmission: recordUnaddressedChannelBatchAdmission,
    releaseBatch: releaseUnaddressedChannelBatch,
    settleBatch: settleUnaddressedChannelBatch,
    submitRequest: input.submitRequest,
  };
}

/**
 * Archives one unaddressed Lark-platform group message and schedules the
 * flush that routes its batch. Nothing is published to the chat here.
 */
export async function observeUnaddressedLarkPlatformMessage(
  input: {
    connectionGeneration: number | undefined;
    connectionId: string;
    db: PostgresDatabase;
    event: MessageEvent;
    nowMs: number;
    provider: LarkPlatformProvider;
    queue: UnaddressedChannelBatchQueue | undefined;
  },
  dependencies: UnaddressedChannelObservationDependencies & {
    readConnection(input: {
      connectionId: string;
      db: PostgresDatabase;
    }): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null>;
  }
): Promise<UnaddressedChannelObservationResult> {
  const locator = input.event.locator;
  if (locator.provider !== input.provider) {
    return {
      reasonCode: "message_channel.unaddressed_locator_mismatch",
      status: "ignored",
    };
  }
  const connection = await dependencies.readConnection({
    connectionId: input.connectionId,
    db: input.db,
  });
  if (
    !connection ||
    connection.provider !== input.provider ||
    connection.status !== "connected"
  ) {
    return {
      reasonCode: "message_channel.unaddressed_connection_unavailable",
      status: "ignored",
    };
  }
  if (
    input.connectionGeneration !== undefined &&
    input.connectionGeneration !== connection.connectionGeneration
  ) {
    return {
      reasonCode: "message_channel.connection_generation_changed",
      status: "ignored",
    };
  }
  return await recordAndScheduleUnaddressedChannelMessage(
    {
      db: input.db,
      message: {
        connectionGeneration: connection.connectionGeneration,
        connectionId: connection.connectionId,
        conversationKey: locator.chatId,
        messageId: input.event.messageId,
        organizationId: connection.organizationId,
        provider: input.provider,
        resources: input.event.resources,
        rootMessageId: locator.rootMessageId,
        senderId: input.event.senderId,
        senderTenantKey: input.event.senderTenantKey ?? null,
        sentAtMs: input.event.sentAtMs,
        text: input.event.text,
        threadId: locator.threadId,
      },
      nowMs: input.nowMs,
      queue: input.queue,
    },
    dependencies
  );
}

/**
 * Archives one unaddressed message and schedules the flush that routes its
 * batch. Nothing is published to the chat here.
 */
export async function recordAndScheduleUnaddressedChannelMessage(
  input: {
    db: PostgresDatabase;
    message: Omit<
      Parameters<typeof recordUnaddressedChannelMessage>[0],
      "batchKey" | "db" | "observedAtMs" | "source"
    >;
    nowMs: number;
    queue: UnaddressedChannelBatchQueue | undefined;
  },
  dependencies: UnaddressedChannelObservationDependencies
): Promise<UnaddressedChannelObservationResult> {
  if (!input.queue) {
    throw new UnaddressedChannelIntakeRetryableError(
      "message_channel.unaddressed_batch_queue_unavailable"
    );
  }
  const batchKey = buildUnaddressedChannelBatchKey({
    messageId: input.message.messageId,
    rootMessageId: input.message.rootMessageId,
    senderId: input.message.senderId,
  });
  await dependencies.recordMessage({
    ...input.message,
    batchKey,
    db: input.db,
    observedAtMs: input.nowMs,
    source: "push",
  });
  // A redelivered event schedules again on purpose: its first flush may have
  // been lost with the failed attempt, and an extra flush finds nothing to do.
  await input.queue.send(
    unaddressedChannelBatchQueueMessageSchema.parse({
      batchKey,
      connectionId: input.message.connectionId,
      conversationKey: input.message.conversationKey,
      kind: "remote_agent_message_channel_unaddressed_batch",
      provider: input.message.provider,
      scheduledByObservedAtMs: input.nowMs,
      v: 1,
    }),
    { delaySeconds: Math.ceil(UNADDRESSED_CHANNEL_QUIET_WINDOW_MS / 1000) }
  );
  return { status: "observed" };
}

/**
 * Routes one quiet batch: chatter stays archived and starts nothing, while a
 * request or a follow-up becomes one Center Agent turn for the person who
 * sent the last message.
 */
export async function flushUnaddressedChannelBatch(
  input: {
    db: PostgresDatabase;
    message: UnaddressedChannelBatchQueueMessage;
    nowMs: number;
    queue: UnaddressedChannelBatchQueue | undefined;
    queueAttempts: number;
  },
  dependencies: UnaddressedChannelIntakeDependencies
): Promise<UnaddressedChannelBatchFlushResult> {
  const { message } = input;
  const expired = await dependencies.expireStaleMessages({
    batchKey: message.batchKey,
    connectionId: message.connectionId,
    conversationKey: message.conversationKey,
    db: input.db,
    nowMs: input.nowMs,
    observedBeforeMs: input.nowMs - UNADDRESSED_CHANNEL_MAX_PENDING_AGE_MS,
    provider: message.provider,
  });
  if (expired > 0) {
    console.warn("[core.message_channel.unaddressed_messages_expired]", {
      batchKey: message.batchKey,
      connectionId: message.connectionId,
      expired,
      provider: message.provider,
    });
  }
  const claim = await dependencies.claimBatch({
    batchId: crypto.randomUUID(),
    batchKey: message.batchKey,
    claimExpiresAtMs: input.nowMs + UNADDRESSED_CHANNEL_BATCH_CLAIM_LEASE_MS,
    connectionId: message.connectionId,
    conversationKey: message.conversationKey,
    db: input.db,
    maxMessages: UNADDRESSED_CHANNEL_BATCH_MAX_MESSAGES,
    maxWaitMs: UNADDRESSED_CHANNEL_MAX_WAIT_MS,
    nowMs: input.nowMs,
    // The expiry above skips a row still held by a live claim. If that claim
    // is released before this one runs, the row must still not be routed.
    observedAtOrAfterMs: input.nowMs - UNADDRESSED_CHANNEL_MAX_PENDING_AGE_MS,
    provider: message.provider,
    quietWindowMs: UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
  });
  if (claim.status === "empty") {
    return { status: "empty" };
  }
  const scheduleFlush = async (
    flush: UnaddressedChannelBatchQueueMessage,
    atMs: number
  ) => {
    if (!input.queue) {
      throw new UnaddressedChannelIntakeRetryableError(
        "message_channel.unaddressed_batch_queue_unavailable"
      );
    }
    await input.queue.send(flush, {
      delaySeconds: Math.max(1, Math.ceil((atMs - input.nowMs) / 1000)),
    });
  };
  if (claim.status === "leased") {
    // Another flush holds the batch. If its worker stopped, nothing else
    // would claim the batch again, so look once more when the lease is over.
    await scheduleFlush(message, claim.leasedUntilMs);
    return { status: "rescheduled" };
  }
  if (claim.status === "not_due") {
    if (claim.newestObservedAtMs > message.scheduledByObservedAtMs) {
      // The newer message's own flush waits a full quiet window. When the
      // maximum wait ends sooner than that, keep a flush at that deadline.
      if (
        claim.dueAtMs <
        claim.newestObservedAtMs + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS
      ) {
        await scheduleFlush(message, claim.dueAtMs);
      }
      return { status: "superseded" };
    }
    await scheduleFlush(message, claim.dueAtMs);
    return { status: "rescheduled" };
  }
  const { batchId } = claim;
  try {
    const result = await routeClaimedUnaddressedChannelBatch({
      batchId,
      db: input.db,
      dependencies,
      messages: claim.messages,
      provider: message.provider,
    });
    if (claim.mayHaveMore) {
      // A batch holds a bounded number of messages, and a retried batch keeps
      // its original ones. Whatever else is waiting gets its own flush.
      await scheduleFlush(
        { ...message, scheduledByObservedAtMs: input.nowMs },
        input.nowMs
      );
    }
    return result;
  } catch (error) {
    if (input.queueAttempts >= UNADDRESSED_CHANNEL_BATCH_MAX_QUEUE_ATTEMPTS) {
      // Routing could not be decided. The messages stay archived and start
      // nothing, because nobody asked the Center Agent to act.
      await dependencies.settleBatch({
        batchId,
        db: input.db,
        nativeDeliveryId: null,
        nowMs: Date.now(),
        route: "unrouted",
        state: "archived",
      });
      console.error("[core.message_channel.unaddressed_batch_unrouted]", {
        batchId,
        connectionId: message.connectionId,
        error: error instanceof Error ? error.message : String(error),
        provider: message.provider,
        queueAttempts: input.queueAttempts,
      });
      return { batchId, route: "unrouted", status: "archived" };
    }
    await dependencies.releaseBatch({
      batchId,
      db: input.db,
      nowMs: Date.now(),
    });
    throw error;
  }
}

async function routeClaimedUnaddressedChannelBatch(input: {
  batchId: string;
  db: PostgresDatabase;
  dependencies: UnaddressedChannelIntakeDependencies;
  messages: readonly UnaddressedChannelMessageRecord[];
  provider: UnaddressedChannelBatchQueueMessage["provider"];
}): Promise<UnaddressedChannelBatchFlushResult> {
  const { batchId, db, dependencies } = input;
  const claimed = input.messages.at(-1);
  if (!claimed) {
    throw new Error("A claimed unaddressed batch has no messages");
  }
  // Authorization may have changed while these messages waited in the queue.
  // Check every claimed row before its content can leave Core. A single claim
  // can contain messages observed on either side of a reconnect: the ones
  // from before it are archived, and the ones after it are still routed.
  const current = await dependencies.readCurrentConnection({
    connectionId: claimed.connectionId,
    db,
    provider: input.provider,
  });
  const messages = current
    ? input.messages.filter(
        (message) =>
          message.connectionGeneration === current.connectionGeneration &&
          message.organizationId === current.organizationId
      )
    : [];
  const trigger = messages.at(-1);
  if (!trigger) {
    await dependencies.settleBatch({
      batchId,
      db,
      nativeDeliveryId: null,
      nowMs: Date.now(),
      route: "unrouted",
      state: "archived",
    });
    return { batchId, route: "unrouted", status: "archived" };
  }
  if (messages.length < input.messages.length) {
    const currentIds = new Set(messages.map((message) => message.messageId));
    await dependencies.archiveClaimedMessages({
      batchId,
      db,
      messageIds: input.messages
        .map((message) => message.messageId)
        .filter((messageId) => !currentIds.has(messageId)),
      nowMs: Date.now(),
      route: "unrouted",
    });
  }
  const route =
    readAdmittedRoute(messages) ??
    (await classifyClaimedUnaddressedChannelBatch({
      batchId,
      db,
      dependencies,
      messages,
      provider: input.provider,
      trigger,
    }));
  if (route === "chatter") {
    await dependencies.settleBatch({
      batchId,
      db,
      nativeDeliveryId: null,
      nowMs: Date.now(),
      route: "chatter",
      state: "archived",
    });
    return { batchId, route: "chatter", status: "archived" };
  }
  const submission = await dependencies.submitRequest({
    db,
    requestEventId: `unaddressed-batch:${trigger.messageId}`,
    text: buildUnaddressedChannelRequestText(messages),
    trigger,
  });
  if (submission.status === "not_submitted") {
    await dependencies.settleBatch({
      batchId,
      db,
      nativeDeliveryId: null,
      nowMs: Date.now(),
      route,
      state: "archived",
    });
    console.warn("[core.message_channel.unaddressed_batch_not_submitted]", {
      batchId,
      connectionId: trigger.connectionId,
      provider: input.provider,
      reasonCode: submission.reasonCode,
      route,
    });
    return { batchId, route, status: "archived" };
  }
  await dependencies.settleBatch({
    batchId,
    db,
    nativeDeliveryId: submission.deliveryId,
    nowMs: Date.now(),
    route,
    state: "routed",
  });
  return {
    batchId,
    deliveryId: submission.deliveryId,
    route,
    status: "routed",
  };
}

/**
 * An earlier attempt may already have admitted this batch and submitted its
 * request. The retry must repeat that decision: asking the classifier again
 * could label the same messages chatter and leave the submitted request
 * unrecorded.
 */
function readAdmittedRoute(
  messages: readonly UnaddressedChannelMessageRecord[]
): "follow_up" | "new_request" | null {
  for (const message of messages) {
    if (message.route === "follow_up" || message.route === "new_request") {
      return message.route;
    }
  }
  return null;
}

async function classifyClaimedUnaddressedChannelBatch(input: {
  batchId: string;
  db: PostgresDatabase;
  dependencies: UnaddressedChannelIntakeDependencies;
  messages: readonly UnaddressedChannelMessageRecord[];
  provider: UnaddressedChannelBatchQueueMessage["provider"];
  trigger: UnaddressedChannelMessageRecord;
}): Promise<UnaddressedChannelBatchRoute> {
  const { batchId, db, dependencies, messages, trigger } = input;
  const hasPriorAgentTurn = await dependencies.hasPriorAgentTurn({
    db,
    trigger,
  });
  const classified = await dependencies.classifyBatch({
    batchId,
    // A claim never holds more messages than the classifier reads, so every
    // message settled afterwards was seen by it.
    messages: messages.map((message) => ({
      attachmentCount: Math.min(
        message.resources.length + message.slackFiles.length,
        10
      ),
      messageId: message.messageId,
      senderId: message.senderId,
      text: message.text.slice(
        0,
        UNADDRESSED_CHANNEL_BATCH_MESSAGE_TEXT_MAX_CHARS
      ),
    })),
    organizationId: trigger.organizationId,
    provider: input.provider,
    thread: {
      hasPriorAgentTurn,
      isThreadReply: trigger.rootMessageId !== trigger.messageId,
    },
  });
  if (classified === "chatter") {
    return "chatter";
  }
  // A follow-up needs earlier Center Agent work in the same thread. Without
  // it the batch is still a request, so it is routed as a new one.
  const route =
    classified === "follow_up" && !hasPriorAgentTurn
      ? "new_request"
      : classified;
  await dependencies.recordBatchAdmission({
    batchId,
    db,
    nowMs: Date.now(),
    route,
  });
  return route;
}

/** Every message in a batch has the same sender, the requester. */
function buildUnaddressedChannelRequestText(
  messages: readonly UnaddressedChannelMessageRecord[]
): string {
  return messages
    .map((message) => message.text)
    .join("\n")
    .slice(-MESSAGE_CHANNEL_EVENT_TEXT_MAX_CHARS)
    .trim();
}
