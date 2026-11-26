import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  messageChannelResourceDescriptorSchema,
  remoteAgentSlackEventFileSchema,
} from "@openmeld/schemas";
import type {
  MessageChannelProvider,
  MessageChannelResourceDescriptor,
  RemoteAgentSlackEventFile,
  UnaddressedChannelBatchRoute,
} from "@openmeld/schemas/types";

const TABLE =
  '"openmeld"."openMeldRemoteAgent_message_channel_unaddressed_messages"';

/**
 * Why a message stopped waiting. `addressed`: a later mention by the same
 * sender, or in the same thread, started the turn instead. `expired`: it
 * waited longer than the pending age limit and is never routed.
 */
export type UnaddressedChannelArchiveRoute =
  | UnaddressedChannelBatchRoute
  | "addressed"
  | "expired"
  | "unrouted";

export type UnaddressedChannelMessageRecord = {
  batchId: string | null;
  batchKey: string;
  connectionGeneration: number | null;
  connectionId: string;
  conversationKey: string;
  messageId: string;
  nativeDeliveryId: string | null;
  observedAtMs: number;
  organizationId: string;
  provider: MessageChannelProvider;
  /** Lark and Feishu file references. Empty for Slack. */
  resources: MessageChannelResourceDescriptor[];
  rootMessageId: string;
  route: UnaddressedChannelArchiveRoute | null;
  /** Slack file references. Empty for Lark and Feishu. */
  slackFiles: RemoteAgentSlackEventFile[];
  senderId: string;
  senderTenantKey: string | null;
  sentAtMs: number;
  source: "backfill" | "push";
  state: "archived" | "pending" | "routed" | "routing";
  text: string;
  threadId: string | null;
};
type UnaddressedChannelMessageRow = {
  batch_id: string | null;
  batch_key: string;
  connection_generation: number | string | null;
  connection_id: string;
  conversation_key: string;
  message_id: string;
  message_text: string;
  native_delivery_id: string | null;
  observed_at_ms: number | string;
  organization_id: string;
  provider: MessageChannelProvider;
  provider_files_json: string;
  root_message_id: string;
  route: UnaddressedChannelMessageRecord["route"];
  sender_id: string;
  sender_tenant_key: string | null;
  sent_at_ms: number | string;
  source: UnaddressedChannelMessageRecord["source"];
  state: UnaddressedChannelMessageRecord["state"];
  thread_id: string | null;
};
type BatchScope = {
  batchKey: string;
  connectionId: string;
  conversationKey: string;
  provider: MessageChannelProvider;
};
export type UnaddressedChannelBatchClaim =
  | {
      status: "empty";
    }
  | {
      /** Another flush holds the batch until its claim lease expires. */
      leasedUntilMs: number;
      status: "leased";
    }
  | {
      dueAtMs: number;
      newestObservedAtMs: number;
      status: "not_due";
    }
  | {
      /** The id the batch keeps across retries, not always the one offered. */
      batchId: string;
      messages: UnaddressedChannelMessageRecord[];
      /** True when other waiting messages of the scope may remain. */
      mayHaveMore: boolean;
      status: "claimed";
    };

/**
 * Archives one unaddressed message. A provider redelivery of the same message
 * leaves the first row untouched, so a batch never contains it twice.
 */
export async function recordUnaddressedChannelMessage(input: {
  batchKey: string;
  connectionGeneration: number | null;
  connectionId: string;
  conversationKey: string;
  db: PostgresDatabase;
  messageId: string;
  observedAtMs: number;
  organizationId: string;
  provider: MessageChannelProvider;
  resources: readonly MessageChannelResourceDescriptor[];
  rootMessageId: string;
  senderId: string;
  senderTenantKey: string | null;
  sentAtMs: number;
  slackFiles?: readonly RemoteAgentSlackEventFile[];
  // Backfilled history is reference material only; it never waits for routing.
  source: "backfill" | "push";
  text: string;
  threadId: string | null;
}): Promise<{ inserted: boolean }> {
  const result = await input.db.query({
    text: `
      INSERT INTO ${TABLE} (
        organization_id,
        provider,
        connection_id,
        connection_generation,
        conversation_key,
        message_id,
        root_message_id,
        thread_id,
        sender_id,
        sender_tenant_key,
        message_text,
        provider_files_json,
        sent_at_ms,
        observed_at_ms,
        source,
        batch_key,
        state,
        updated_at_ms
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $14
      )
      ON CONFLICT (provider, connection_id, message_id) DO NOTHING
    `,
    values: [
      input.organizationId,
      input.provider,
      input.connectionId,
      input.connectionGeneration,
      input.conversationKey,
      input.messageId,
      input.rootMessageId,
      input.threadId,
      input.senderId,
      input.senderTenantKey,
      input.text,
      JSON.stringify(
        input.provider === "slack" ? (input.slackFiles ?? []) : input.resources
      ),
      input.sentAtMs,
      input.observedAtMs,
      input.source,
      input.batchKey,
      input.source === "push" ? "pending" : "archived",
    ],
  });
  return { inserted: Number(result.rowCount ?? 0) > 0 };
}

/**
 * Claims the next batch of one scope. A batch that was claimed before and
 * then released, or whose claim lease expired, is claimed again with the same
 * id and the same messages, so a retry repeats the same request. Otherwise
 * the oldest waiting messages, up to `maxMessages`, become a new batch once
 * the burst has gone quiet or its oldest message has waited the maximum
 * time. Messages observed before `observedAtOrAfterMs` are never claimed.
 */
export async function claimDueUnaddressedChannelBatch(
  input: BatchScope & {
    batchId: string;
    claimExpiresAtMs: number;
    db: PostgresDatabase;
    maxMessages: number;
    maxWaitMs: number;
    nowMs: number;
    observedAtOrAfterMs: number;
    quietWindowMs: number;
  }
): Promise<UnaddressedChannelBatchClaim> {
  const scopeValues = [
    input.provider,
    input.connectionId,
    input.conversationKey,
    input.batchKey,
  ];
  const reclaimed = await input.db.query<UnaddressedChannelMessageRow>({
    text: `
      UPDATE ${TABLE} AS message
      SET state = 'routing',
          claim_expires_at_ms = $6,
          updated_at_ms = greatest(message.updated_at_ms, $5)
      WHERE message.provider = $1
        AND message.connection_id = $2
        AND message.conversation_key = $3
        AND message.batch_key = $4
        AND message.observed_at_ms >= $7
        AND (
          message.state = 'pending'
          OR (message.state = 'routing' AND message.claim_expires_at_ms <= $5)
        )
        AND message.batch_id = (
          SELECT prior.batch_id
          FROM ${TABLE} AS prior
          WHERE prior.provider = $1
            AND prior.connection_id = $2
            AND prior.conversation_key = $3
            AND prior.batch_key = $4
            AND prior.batch_id IS NOT NULL
            AND prior.observed_at_ms >= $7
            AND (
              prior.state = 'pending'
              OR (prior.state = 'routing' AND prior.claim_expires_at_ms <= $5)
            )
          ORDER BY prior.observed_at_ms, prior.message_id
          LIMIT 1
        )
      RETURNING message.*
    `,
    values: [
      ...scopeValues,
      input.nowMs,
      input.claimExpiresAtMs,
      input.observedAtOrAfterMs,
    ],
  });
  const reclaimedBatchId = reclaimed.rows[0]?.batch_id;
  if (reclaimedBatchId) {
    return {
      batchId: reclaimedBatchId,
      messages: reclaimed.rows
        .map(mapUnaddressedChannelMessageRow)
        .sort(compareBySentTime),
      mayHaveMore: true,
      status: "claimed",
    };
  }
  const claimed = await input.db.query<UnaddressedChannelMessageRow>({
    text: `
      WITH candidates AS (
        SELECT message_id, observed_at_ms, sent_at_ms
        FROM ${TABLE}
        WHERE provider = $1
          AND connection_id = $2
          AND conversation_key = $3
          AND batch_key = $4
          AND state = 'pending'
          AND batch_id IS NULL
          AND observed_at_ms >= $10
        FOR UPDATE
      ),
      burst AS (
        SELECT
          max(observed_at_ms) AS newest_observed_at_ms,
          min(observed_at_ms) AS oldest_observed_at_ms
        FROM candidates
      ),
      chosen AS (
        SELECT message_id
        FROM candidates
        ORDER BY sent_at_ms, message_id
        LIMIT $11
      )
      UPDATE ${TABLE} AS message
      SET state = 'routing',
          batch_id = $6,
          claim_expires_at_ms = $7,
          updated_at_ms = greatest(message.updated_at_ms, $5)
      FROM burst
      WHERE message.provider = $1
        AND message.connection_id = $2
        AND message.message_id IN (SELECT message_id FROM chosen)
        AND message.state = 'pending'
        AND message.batch_id IS NULL
        AND (
          $5 - burst.newest_observed_at_ms >= $8
          OR $5 - burst.oldest_observed_at_ms >= $9
        )
      RETURNING message.*
    `,
    values: [
      ...scopeValues,
      input.nowMs,
      input.batchId,
      input.claimExpiresAtMs,
      input.quietWindowMs,
      input.maxWaitMs,
      input.observedAtOrAfterMs,
      input.maxMessages,
    ],
  });
  if (claimed.rows.length > 0) {
    return {
      batchId: input.batchId,
      messages: claimed.rows
        .map(mapUnaddressedChannelMessageRow)
        .sort(compareBySentTime),
      mayHaveMore: claimed.rows.length >= input.maxMessages,
      status: "claimed",
    };
  }
  const waiting = await input.db.query<{
    leased_until_ms: number | string | null;
    newest_observed_at_ms: number | string | null;
    oldest_observed_at_ms: number | string | null;
  }>({
    text: `
      SELECT
        max(observed_at_ms) FILTER (
          WHERE state = 'pending' AND batch_id IS NULL
        ) AS newest_observed_at_ms,
        min(observed_at_ms) FILTER (
          WHERE state = 'pending' AND batch_id IS NULL
        ) AS oldest_observed_at_ms,
        max(claim_expires_at_ms) FILTER (
          WHERE state = 'routing' AND claim_expires_at_ms > $5
        ) AS leased_until_ms
      FROM ${TABLE}
      WHERE provider = $1
        AND connection_id = $2
        AND conversation_key = $3
        AND batch_key = $4
        AND observed_at_ms >= $6
    `,
    values: [...scopeValues, input.nowMs, input.observedAtOrAfterMs],
  });
  const window = waiting.rows[0];
  if (
    window &&
    window.newest_observed_at_ms !== null &&
    window.oldest_observed_at_ms !== null
  ) {
    const newestObservedAtMs = Number(window.newest_observed_at_ms);
    return {
      dueAtMs: Math.min(
        newestObservedAtMs + input.quietWindowMs,
        Number(window.oldest_observed_at_ms) + input.maxWaitMs
      ),
      newestObservedAtMs,
      status: "not_due",
    };
  }
  if (window && window.leased_until_ms !== null) {
    return {
      leasedUntilMs: Number(window.leased_until_ms),
      status: "leased",
    };
  }
  return { status: "empty" };
}

/**
 * Archives the waiting messages of one batch scope that are too old to route.
 * A row still being routed under a live claim is left alone.
 */
export async function expireStaleUnaddressedChannelMessages(
  input: BatchScope & {
    db: PostgresDatabase;
    nowMs: number;
    observedBeforeMs: number;
  }
): Promise<number> {
  const result = await input.db.query({
    text: `
      UPDATE ${TABLE}
      SET state = 'archived',
          route = 'expired',
          claim_expires_at_ms = NULL,
          updated_at_ms = greatest(updated_at_ms, $6)
      WHERE provider = $1
        AND connection_id = $2
        AND conversation_key = $3
        AND batch_key = $4
        AND observed_at_ms < $5
        AND (
          state = 'pending'
          OR (state = 'routing' AND claim_expires_at_ms <= $6)
        )
    `,
    values: [
      input.provider,
      input.connectionId,
      input.conversationKey,
      input.batchKey,
      input.observedBeforeMs,
      input.nowMs,
    ],
  });
  return Number(result.rowCount ?? 0);
}

/**
 * Archives the waiting messages that an addressed mention answers, so their
 * batch never starts a second turn. Only messages sent up to the mention are
 * taken; a batch already being routed keeps its claim.
 */
export async function settleUnaddressedChannelMessagesForMention(input: {
  connectionId: string;
  conversationKey: string;
  db: PostgresDatabase;
  nowMs: number;
  provider: MessageChannelProvider;
  scope: { batchKey: string } | { rootMessageId: string };
  /**
   * The mention's own message id, for a provider whose ids order messages
   * more finely than a millisecond (a Slack `ts`). It decides between
   * messages sent in the mention's own millisecond.
   */
  sentThroughMessageId?: string;
  sentThroughMs: number;
}): Promise<number> {
  const byBatch = "batchKey" in input.scope;
  const result = await input.db.query({
    text: `
      UPDATE ${TABLE}
      SET state = 'archived',
          route = 'addressed',
          updated_at_ms = greatest(updated_at_ms, $6)
      WHERE provider = $1
        AND connection_id = $2
        AND conversation_key = $3
        AND state = 'pending'
        AND (
          sent_at_ms < $5
          OR (
            sent_at_ms = $5
            AND ($7::text IS NULL OR message_id COLLATE "C" <= $7::text)
          )
        )
        AND ${byBatch ? "batch_key" : "root_message_id"} = $4
    `,
    values: [
      input.provider,
      input.connectionId,
      input.conversationKey,
      "batchKey" in input.scope
        ? input.scope.batchKey
        : input.scope.rootMessageId,
      input.sentThroughMs,
      input.nowMs,
      input.sentThroughMessageId ?? null,
    ],
  });
  return Number(result.rowCount ?? 0);
}

/**
 * Returns a claimed batch to the waiting state. The messages keep their
 * batch id, so the retry claims the same batch and repeats the same request.
 */
export async function releaseUnaddressedChannelBatch(input: {
  batchId: string;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<number> {
  const result = await input.db.query({
    text: `
      UPDATE ${TABLE}
      SET state = 'pending',
          claim_expires_at_ms = NULL,
          updated_at_ms = greatest(updated_at_ms, $2)
      WHERE batch_id = $1
        AND state = 'routing'
    `,
    values: [input.batchId, input.nowMs],
  });
  return Number(result.rowCount ?? 0);
}

/** Records the routing decision for a claimed batch. Settling is final. */
export async function settleUnaddressedChannelBatch(input: {
  batchId: string;
  db: PostgresDatabase;
  nativeDeliveryId: string | null;
  nowMs: number;
  route: Exclude<UnaddressedChannelArchiveRoute, "addressed" | "expired">;
  state: "archived" | "routed";
}): Promise<number> {
  const result = await input.db.query({
    text: `
      UPDATE ${TABLE}
      SET state = $2,
          route = $3,
          native_delivery_id = $4,
          claim_expires_at_ms = NULL,
          updated_at_ms = greatest(updated_at_ms, $5)
      WHERE batch_id = $1
        AND state = 'routing'
    `,
    values: [
      input.batchId,
      input.state,
      input.route,
      input.nativeDeliveryId,
      input.nowMs,
    ],
  });
  return Number(result.rowCount ?? 0);
}

/**
 * Archives some messages of a claimed batch without routing them, for
 * example those observed under a connection that has since been replaced.
 * The rest of the batch keeps its claim.
 */
export async function archiveClaimedUnaddressedChannelMessages(input: {
  batchId: string;
  db: PostgresDatabase;
  messageIds: readonly string[];
  nowMs: number;
  route: "unrouted";
}): Promise<number> {
  if (input.messageIds.length === 0) {
    return 0;
  }
  const result = await input.db.query({
    text: `
      UPDATE ${TABLE}
      SET state = 'archived',
          route = $2,
          claim_expires_at_ms = NULL,
          updated_at_ms = greatest(updated_at_ms, $3)
      WHERE batch_id = $1
        AND state = 'routing'
        AND message_id IN (SELECT jsonb_array_elements_text($4::jsonb))
    `,
    values: [
      input.batchId,
      input.route,
      input.nowMs,
      JSON.stringify(input.messageIds),
    ],
  });
  return Number(result.rowCount ?? 0);
}

export async function listUnaddressedChannelMessages(input: {
  connectionId: string;
  conversationKey: string;
  db: PostgresDatabase;
  limit: number;
  provider: MessageChannelProvider;
}): Promise<UnaddressedChannelMessageRecord[]> {
  const result = await input.db.query<UnaddressedChannelMessageRow>({
    text: `
      SELECT *
      FROM ${TABLE}
      WHERE provider = $1
        AND connection_id = $2
        AND conversation_key = $3
      ORDER BY sent_at_ms DESC, message_id DESC
      LIMIT $4
    `,
    values: [
      input.provider,
      input.connectionId,
      input.conversationKey,
      input.limit,
    ],
  });
  return result.rows
    .map(mapUnaddressedChannelMessageRow)
    .sort(compareBySentTime);
}

function compareBySentTime(
  first: UnaddressedChannelMessageRecord,
  second: UnaddressedChannelMessageRecord
): number {
  return (
    first.sentAtMs - second.sentAtMs ||
    first.messageId.localeCompare(second.messageId)
  );
}

function mapUnaddressedChannelMessageRow(
  row: UnaddressedChannelMessageRow
): UnaddressedChannelMessageRecord {
  const files: unknown = JSON.parse(row.provider_files_json);
  return {
    batchId: row.batch_id,
    batchKey: row.batch_key,
    connectionGeneration:
      row.connection_generation === null
        ? null
        : Number(row.connection_generation),
    connectionId: row.connection_id,
    conversationKey: row.conversation_key,
    messageId: row.message_id,
    nativeDeliveryId: row.native_delivery_id,
    observedAtMs: Number(row.observed_at_ms),
    organizationId: row.organization_id,
    provider: row.provider,
    resources:
      row.provider === "slack"
        ? []
        : messageChannelResourceDescriptorSchema.array().parse(files),
    rootMessageId: row.root_message_id,
    route: row.route,
    slackFiles:
      row.provider === "slack"
        ? remoteAgentSlackEventFileSchema.array().parse(files)
        : [],
    senderId: row.sender_id,
    senderTenantKey: row.sender_tenant_key,
    sentAtMs: Number(row.sent_at_ms),
    source: row.source,
    state: row.state,
    text: row.message_text,
    threadId: row.thread_id,
  };
}
