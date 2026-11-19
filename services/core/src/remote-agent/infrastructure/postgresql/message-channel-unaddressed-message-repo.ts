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
  route: UnaddressedChannelBatchRoute | "unrouted" | null;
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
      dueAtMs: number;
      newestObservedAtMs: number;
      status: "not_due";
    }
  | {
      messages: UnaddressedChannelMessageRecord[];
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
 * Claims every waiting message of one batch once the burst has gone quiet,
 * or once the oldest waiting message has waited the maximum time. A batch
 * whose earlier claim expired without settling is claimed again.
 */
export async function claimDueUnaddressedChannelBatch(
  input: BatchScope & {
    batchId: string;
    claimExpiresAtMs: number;
    db: PostgresDatabase;
    maxWaitMs: number;
    nowMs: number;
    quietWindowMs: number;
  }
): Promise<UnaddressedChannelBatchClaim> {
  const scopeValues = [
    input.provider,
    input.connectionId,
    input.conversationKey,
    input.batchKey,
  ];
  const claimed = await input.db.query<UnaddressedChannelMessageRow>({
    text: `
      WITH candidates AS (
        SELECT message_id, observed_at_ms
        FROM ${TABLE}
        WHERE provider = $1
          AND connection_id = $2
          AND conversation_key = $3
          AND batch_key = $4
          AND (
            state = 'pending'
            OR (state = 'routing' AND claim_expires_at_ms <= $5)
          )
        FOR UPDATE
      ),
      burst AS (
        SELECT
          max(observed_at_ms) AS newest_observed_at_ms,
          min(observed_at_ms) AS oldest_observed_at_ms
        FROM candidates
      )
      UPDATE ${TABLE} AS message
      SET state = 'routing',
          batch_id = $6,
          claim_expires_at_ms = $7,
          updated_at_ms = greatest(message.updated_at_ms, $5)
      FROM burst
      WHERE message.provider = $1
        AND message.connection_id = $2
        AND message.message_id IN (SELECT message_id FROM candidates)
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
    ],
  });
  if (claimed.rows.length > 0) {
    return {
      messages: claimed.rows
        .map(mapUnaddressedChannelMessageRow)
        .sort(compareBySentTime),
      status: "claimed",
    };
  }
  const waiting = await input.db.query<{
    newest_observed_at_ms: number | string | null;
    oldest_observed_at_ms: number | string | null;
  }>({
    text: `
      SELECT
        max(observed_at_ms) AS newest_observed_at_ms,
        min(observed_at_ms) AS oldest_observed_at_ms
      FROM ${TABLE}
      WHERE provider = $1
        AND connection_id = $2
        AND conversation_key = $3
        AND batch_key = $4
        AND state = 'pending'
    `,
    values: scopeValues,
  });
  const window = waiting.rows[0];
  if (
    !window ||
    window.newest_observed_at_ms === null ||
    window.oldest_observed_at_ms === null
  ) {
    return { status: "empty" };
  }
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

/** Returns a claimed batch to the waiting state so a retry can claim it. */
export async function releaseUnaddressedChannelBatch(input: {
  batchId: string;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<number> {
  const result = await input.db.query({
    text: `
      UPDATE ${TABLE}
      SET state = 'pending',
          batch_id = NULL,
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
  route: UnaddressedChannelBatchRoute | "unrouted";
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
