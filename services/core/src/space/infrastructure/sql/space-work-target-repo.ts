import { centerAgentWorkTargetRecordSchema } from "@openmeld/schemas";
import type {
  CenterAgentWorkTarget,
  CenterAgentWorkTargetRecord,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../../rpc/errors";

/** One goal owner; the other tables contain source receipts and read indexes. */
export function ensureSpaceWorkTargetTable(sql: SqlStorage) {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS space_work_targets (scope_key TEXT PRIMARY KEY, record_json TEXT NOT NULL)"
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS space_work_target_sources (source_signal_id TEXT PRIMARY KEY, source_revision INTEGER NOT NULL, logical_conversation_id TEXT NOT NULL, scope_key TEXT NOT NULL, selection_signature TEXT NOT NULL)"
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS space_work_target_conversations (logical_conversation_id TEXT NOT NULL, actor_profile_id TEXT NOT NULL, scope_key TEXT NOT NULL, PRIMARY KEY(logical_conversation_id, actor_profile_id))"
  );
}

export function readSpaceWorkTarget(sql: SqlStorage, scopeKey: string) {
  const row = sql
    .exec<{ record_json: string }>(
      "SELECT record_json FROM space_work_targets WHERE scope_key = ?",
      scopeKey
    )
    .toArray()[0];
  return row
    ? centerAgentWorkTargetRecordSchema.parse(JSON.parse(row.record_json))
    : null;
}

export function writeSpaceWorkTarget(
  sql: SqlStorage,
  input: {
    scopeKey: string;
    expectedRevision: number;
    target: CenterAgentWorkTarget;
    sourceSignalId: string;
    sourceRevision: number;
    sourceProfileId: string;
    sourceProfileKind: "human" | "agent";
  }
): CenterAgentWorkTargetRecord {
  const current = readSpaceWorkTarget(sql, input.scopeKey);
  if ((current?.revision ?? 0) !== input.expectedRevision) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "center_agent.work_target.revision_conflict",
      reason: "Read the current work target before continuing.",
    });
  }
  const record = centerAgentWorkTargetRecordSchema.parse({
    target: input.target,
    revision: (current?.revision ?? 0) + 1,
    sourceSignalId: input.sourceSignalId,
    sourceRevision: input.sourceRevision,
    sourceProfileId: input.sourceProfileId,
    sourceProfileKind: input.sourceProfileKind,
  });
  sql.exec(
    "INSERT INTO space_work_targets VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET record_json = excluded.record_json",
    input.scopeKey,
    JSON.stringify(record)
  );
  return record;
}

export function readWorkTargetSource(sql: SqlStorage, signalId: string) {
  return (
    sql
      .exec<{
        source_revision: number;
        logical_conversation_id: string;
        scope_key: string;
        selection_signature: string;
      }>(
        "SELECT source_revision, logical_conversation_id, scope_key, selection_signature FROM space_work_target_sources WHERE source_signal_id = ?",
        signalId
      )
      .toArray()[0] ?? null
  );
}

export function readWorkTargetConversationScope(
  sql: SqlStorage,
  conversationId: string,
  actorProfileId: string
) {
  return (
    sql
      .exec<{ scope_key: string }>(
        "SELECT scope_key FROM space_work_target_conversations WHERE logical_conversation_id = ? AND actor_profile_id = ?",
        conversationId,
        actorProfileId
      )
      .toArray()[0]?.scope_key ?? null
  );
}

export function bindWorkTargetSource(
  sql: SqlStorage,
  input: {
    signalId: string;
    sourceRevision: number;
    conversationId: string;
    scope: string;
    signature: string;
    actorProfileId: string;
  }
) {
  sql.exec(
    "INSERT INTO space_work_target_sources VALUES (?, ?, ?, ?, ?)",
    input.signalId,
    input.sourceRevision,
    input.conversationId,
    input.scope,
    input.signature
  );
  sql.exec(
    "INSERT INTO space_work_target_conversations VALUES (?, ?, ?) ON CONFLICT(logical_conversation_id, actor_profile_id) DO UPDATE SET scope_key = excluded.scope_key",
    input.conversationId,
    input.actorProfileId,
    input.scope
  );
}
