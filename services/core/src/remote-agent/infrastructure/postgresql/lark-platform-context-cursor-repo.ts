import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  type RemoteAgentLarkPlatformProvider,
  readRemoteAgentLarkPlatformChannelConnection,
} from "./lark-platform-channel-connection-repo";
export type RemoteAgentLarkPlatformContextCursorRecord = {
  chatId: string;
  connectionGeneration: number;
  connectionId: string;
  createdAtMs: number;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  rootMessageId: string;
  syncedThroughAtMs: number;
  syncedThroughMessageId: string;
  updatedAtMs: number;
};
type RemoteAgentLarkPlatformContextCursorRow = {
  chat_id: string;
  connection_generation: number;
  connection_id: string;
  created_at_ms: number;
  organization_id: string;
  provider: RemoteAgentLarkPlatformProvider;
  root_message_id: string;
  synced_through_at_ms: number;
  synced_through_message_id: string;
  updated_at_ms: number;
};
export async function readRemoteAgentLarkPlatformContextCursor(input: {
  chatId: string;
  connectionGeneration: number;
  connectionId: string;
  db: PostgresDatabase;
  organizationId: string;
  rootMessageId: string;
}): Promise<RemoteAgentLarkPlatformContextCursorRecord | null> {
  const row = await input.db
    .query<RemoteAgentLarkPlatformContextCursorRow>({
      text: `
        SELECT
          organization_id,
          provider,
          connection_id,
          chat_id,
          root_message_id,
          connection_generation,
          synced_through_message_id,
          synced_through_at_ms,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldRemoteAgent_lark_platform_context_cursors"
        WHERE organization_id = $1
          AND connection_id = $2
          AND chat_id = $3
          AND root_message_id = $4
          AND connection_generation = $5
        LIMIT 1
      `,
      values: [
        input.organizationId,
        input.connectionId,
        input.chatId,
        input.rootMessageId,
        input.connectionGeneration,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapContextCursorRow(row) : null;
}
export async function upsertRemoteAgentLarkPlatformContextCursor(input: {
  chatId: string;
  connectionGeneration: number;
  connectionId: string;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  rootMessageId: string;
  syncedThroughAtMs: number;
  syncedThroughMessageId: string;
}): Promise<RemoteAgentLarkPlatformContextCursorRecord> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_context_cursors" (
          organization_id,
          provider,
          connection_id,
          chat_id,
          root_message_id,
          connection_generation,
          synced_through_message_id,
          synced_through_at_ms,
          created_at_ms,
          updated_at_ms
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        WHERE connection_id = $11
          AND organization_id = $12
          AND provider = $13
          AND connection_generation = $14
        ON CONFLICT(
          organization_id,
          connection_id,
          chat_id,
          root_message_id,
          connection_generation
        ) DO UPDATE SET
          synced_through_message_id = excluded.synced_through_message_id,
          synced_through_at_ms = excluded.synced_through_at_ms,
          updated_at_ms = excluded.updated_at_ms
        WHERE excluded.synced_through_at_ms >=
          "openMeldRemoteAgent_lark_platform_context_cursors".synced_through_at_ms
      `,
    values: [
      input.organizationId,
      input.provider,
      input.connectionId,
      input.chatId,
      input.rootMessageId,
      input.connectionGeneration,
      input.syncedThroughMessageId,
      input.syncedThroughAtMs,
      input.nowMs,
      input.nowMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.connectionGeneration,
    ],
  });
  const [connection, record] = await Promise.all([
    readRemoteAgentLarkPlatformChannelConnection({
      connectionId: input.connectionId,
      db: input.db,
    }),
    readRemoteAgentLarkPlatformContextCursor(input),
  ]);
  if (
    !connection ||
    connection.organizationId !== input.organizationId ||
    connection.provider !== input.provider ||
    connection.connectionGeneration !== input.connectionGeneration ||
    !record
  ) {
    throw new Error(
      "Lark-platform context cursor does not match the current connection generation"
    );
  }
  return record;
}
export async function deleteRemoteAgentLarkPlatformContextCursorsForConnection(input: {
  connectionId: string;
  db: PostgresDatabase;
  organizationId: string;
}): Promise<number> {
  const result = await input.db.query({
    text: `
        DELETE FROM "openmeld"."openMeldRemoteAgent_lark_platform_context_cursors"
        WHERE organization_id = $1
          AND connection_id = $2
      `,
    values: [input.organizationId, input.connectionId],
  });
  return Number(result.rowCount ?? 0);
}
function mapContextCursorRow(
  row: RemoteAgentLarkPlatformContextCursorRow
): RemoteAgentLarkPlatformContextCursorRecord {
  return {
    chatId: row.chat_id,
    connectionGeneration: row.connection_generation,
    connectionId: row.connection_id,
    createdAtMs: row.created_at_ms,
    organizationId: row.organization_id,
    provider: row.provider,
    rootMessageId: row.root_message_id,
    syncedThroughAtMs: row.synced_through_at_ms,
    syncedThroughMessageId: row.synced_through_message_id,
    updatedAtMs: row.updated_at_ms,
  };
}
