import type {
  AgentAccessGranteeKind,
  AgentAccessRequestKind,
} from "@openmeld/schemas";

/**
 * A Wake this Space holds until the Agent owner consents
 * (design-plans/member-agent-program.md §4.6). It is written in the same
 * transaction as the message, so a held Wake is never lost or dispatched
 * early. `sync_state` tracks whether Core's request record has caught up
 * with this row: its creation while held, or its void once closed.
 */
export type SpaceAgentAccessHoldState = "held" | "released" | "closed";
export type SpaceAgentAccessHoldCloseReason =
  | "declined"
  | "withdrawn"
  | "voided"
  // An allow replayed after its grant was revoked.
  | "revoked"
  | "ignored"
  | "replied_by_dm";

export type SpaceAgentAccessHold = {
  requestId: string;
  kind: AgentAccessRequestKind;
  signalId: string | null;
  targetProfileId: string;
  memberAgentId: string | null;
  ownerUserId: string;
  requesterProfileId: string;
  requesterUserId: string;
  requesterKind: AgentAccessGranteeKind;
  // The chain an authoring Agent continued, as JSON; null for a human author.
  requestChainJson: string | null;
  state: SpaceAgentAccessHoldState;
  closeReason: SpaceAgentAccessHoldCloseReason | null;
  syncState: "pending" | "synced";
  createdAtMs: number;
  updatedAtMs: number;
};

const COLUMNS = `request_id AS requestId, kind, signal_id AS signalId,
  target_profile_id AS targetProfileId, member_agent_id AS memberAgentId,
  owner_user_id AS ownerUserId, requester_profile_id AS requesterProfileId,
  requester_user_id AS requesterUserId, requester_kind AS requesterKind,
  request_chain_json AS requestChainJson, state, close_reason AS closeReason, sync_state AS syncState,
  created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs`;

export function ensureSpaceAgentAccessHoldTable(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS space_agent_access_holds (
    request_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    signal_id TEXT,
    target_profile_id TEXT NOT NULL,
    member_agent_id TEXT,
    owner_user_id TEXT NOT NULL,
    requester_profile_id TEXT NOT NULL,
    requester_user_id TEXT NOT NULL,
    requester_kind TEXT NOT NULL,
    request_chain_json TEXT,
    state TEXT NOT NULL,
    close_reason TEXT,
    sync_state TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);
  sql.exec(
    "CREATE INDEX IF NOT EXISTS space_agent_access_holds_signal_idx ON space_agent_access_holds (signal_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS space_agent_access_holds_sync_idx ON space_agent_access_holds (sync_state, created_at_ms)"
  );
}

export function insertSpaceAgentAccessHold(
  sql: SqlStorage,
  hold: Omit<
    SpaceAgentAccessHold,
    "state" | "closeReason" | "syncState" | "updatedAtMs"
  >
): void {
  sql.exec(
    `INSERT OR IGNORE INTO space_agent_access_holds (
      request_id, kind, signal_id, target_profile_id, member_agent_id,
      owner_user_id, requester_profile_id, requester_user_id, requester_kind,
      request_chain_json, state, close_reason, sync_state, created_at_ms,
      updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', NULL, 'pending', ?, ?)`,
    hold.requestId,
    hold.kind,
    hold.signalId,
    hold.targetProfileId,
    hold.memberAgentId,
    hold.ownerUserId,
    hold.requesterProfileId,
    hold.requesterUserId,
    hold.requesterKind,
    hold.requestChainJson,
    hold.createdAtMs,
    hold.createdAtMs
  );
}

export function readSpaceAgentAccessHold(
  sql: SqlStorage,
  requestId: string
): SpaceAgentAccessHold | null {
  return (
    sql
      .exec<SpaceAgentAccessHold>(
        `SELECT ${COLUMNS} FROM space_agent_access_holds WHERE request_id = ?`,
        requestId
      )
      .toArray()[0] ?? null
  );
}

export function listHeldSpaceAgentAccessHoldsForSignal(
  sql: SqlStorage,
  signalId: string
): SpaceAgentAccessHold[] {
  return sql
    .exec<SpaceAgentAccessHold>(
      `SELECT ${COLUMNS} FROM space_agent_access_holds
       WHERE signal_id = ? AND state = 'held'`,
      signalId
    )
    .toArray();
}

/** A held Session request by this requester for this Agent. */
export function readHeldDirectMessageAgentAccessHold(
  sql: SqlStorage,
  input: { requesterUserId: string; targetProfileId: string }
): SpaceAgentAccessHold | null {
  return (
    sql
      .exec<SpaceAgentAccessHold>(
        `SELECT ${COLUMNS} FROM space_agent_access_holds
         WHERE kind = 'direct_message' AND state = 'held'
           AND requester_user_id = ? AND target_profile_id = ?
         ORDER BY created_at_ms LIMIT 1`,
        input.requesterUserId,
        input.targetProfileId
      )
      .toArray()[0] ?? null
  );
}

/** Whether `ownerUserId` owns an Agent with a held Space request here. */
export function hasHeldSpaceJoinHoldForOwner(
  sql: SqlStorage,
  ownerUserId: string
): boolean {
  return (
    sql
      .exec<{ found: number }>(
        `SELECT 1 AS found FROM space_agent_access_holds
         WHERE kind = 'space_join' AND state = 'held' AND owner_user_id = ?
         LIMIT 1`,
        ownerUserId
      )
      .toArray().length > 0
  );
}

/**
 * Whether this message's Wake of `targetProfileId` waits, or waited and
 * ended, on its owner's consent. Such a Wake has no dispatch and is not in
 * progress; the request carries its state.
 */
export function isAgentAccessHeldOrClosed(
  sql: SqlStorage,
  input: { signalId: string; targetProfileId: string }
): boolean {
  return (
    sql
      .exec<{ found: number }>(
        `SELECT 1 AS found FROM space_agent_access_holds
         WHERE signal_id = ? AND target_profile_id = ? AND state <> 'released'
         LIMIT 1`,
        input.signalId,
        input.targetProfileId
      )
      .toArray().length > 0
  );
}

/** Agents that joined because their owner let them; the owner observes. */
export function listOwnerApprovedJoinProfileIds(
  sql: SqlStorage
): ReadonlySet<string> {
  return new Set(
    sql
      .exec<{ profileId: string }>(
        `SELECT DISTINCT target_profile_id AS profileId
         FROM space_agent_access_holds
         WHERE kind = 'space_join' AND state = 'released'`
      )
      .toArray()
      .map((row) => row.profileId)
  );
}

export function readHeldSpaceJoinHold(
  sql: SqlStorage,
  input: { targetProfileId: string; signalId: string | null }
): SpaceAgentAccessHold | null {
  return (
    sql
      .exec<SpaceAgentAccessHold>(
        `SELECT ${COLUMNS} FROM space_agent_access_holds
         WHERE kind = 'space_join' AND state = 'held'
           AND target_profile_id = ? AND signal_id IS ?
         LIMIT 1`,
        input.targetProfileId,
        input.signalId
      )
      .toArray()[0] ?? null
  );
}

export function listUnsyncedSpaceAgentAccessHolds(
  sql: SqlStorage,
  limit = 25
): SpaceAgentAccessHold[] {
  return sql
    .exec<SpaceAgentAccessHold>(
      `SELECT ${COLUMNS} FROM space_agent_access_holds
       WHERE sync_state = 'pending' ORDER BY created_at_ms LIMIT ?`,
      limit
    )
    .toArray();
}

export function hasUnsyncedSpaceAgentAccessHolds(sql: SqlStorage): boolean {
  return (
    sql
      .exec<{ found: number }>(
        "SELECT 1 AS found FROM space_agent_access_holds WHERE sync_state = 'pending' LIMIT 1"
      )
      .toArray().length > 0
  );
}

/** Marks the row synced only if it did not change while Core was written. */
export function markSpaceAgentAccessHoldSynced(
  sql: SqlStorage,
  input: { requestId: string; updatedAtMs: number }
): void {
  sql.exec(
    `UPDATE space_agent_access_holds SET sync_state = 'synced'
     WHERE request_id = ? AND updated_at_ms = ?`,
    input.requestId,
    input.updatedAtMs
  );
}

export function releaseSpaceAgentAccessHold(
  sql: SqlStorage,
  input: { requestId: string; nowMs: number }
): void {
  sql.exec(
    `UPDATE space_agent_access_holds
     SET state = 'released', sync_state = 'synced', updated_at_ms = ?
     WHERE request_id = ? AND state = 'held'`,
    input.nowMs,
    input.requestId
  );
}

/**
 * Closes a held row. A void (edited or deleted message) starts here, so
 * Core still has to learn it: `syncPending` keeps it in the outbox.
 */
export function closeSpaceAgentAccessHold(
  sql: SqlStorage,
  input: {
    requestId: string;
    reason: SpaceAgentAccessHoldCloseReason;
    nowMs: number;
    syncPending: boolean;
  }
): void {
  sql.exec(
    `UPDATE space_agent_access_holds
     SET state = 'closed', close_reason = ?, updated_at_ms = MAX(updated_at_ms + 1, ?),
       sync_state = CASE WHEN ? THEN 'pending' ELSE sync_state END
     WHERE request_id = ? AND state = 'held'`,
    input.reason,
    input.nowMs,
    input.syncPending ? 1 : 0,
    input.requestId
  );
}
