type PendingWakeStop = {
  sourceProfileId: string;
  clientMessageId: string;
  targetProfileId: string;
};

/** A sender-scoped admission fence, never evidence about a running execution. */
export function ensurePendingWakeStopTable(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS space_pending_wake_stops (
    source_profile_id TEXT NOT NULL,
    client_message_id TEXT NOT NULL,
    target_profile_id TEXT NOT NULL,
    requested_at_ms INTEGER NOT NULL,
    PRIMARY KEY (source_profile_id, client_message_id, target_profile_id)
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS space_wake_stop_outcome_outbox (
    dispatch_id TEXT PRIMARY KEY,
    client_message_id TEXT NOT NULL,
    target_profile_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    occurred_at_ms INTEGER NOT NULL
  )`);
}

export type PendingWakeStopOutcome = {
  dispatchId: string;
  clientMessageId: string;
  targetProfileId: string;
  signalId: string;
  occurredAtMs: number;
};

export function enqueueWakeStopOutcome(
  sql: SqlStorage,
  input: PendingWakeStopOutcome
): void {
  sql.exec(
    `INSERT OR IGNORE INTO space_wake_stop_outcome_outbox
    (dispatch_id, client_message_id, target_profile_id, signal_id, occurred_at_ms)
    VALUES (?, ?, ?, ?, ?)`,
    input.dispatchId,
    input.clientMessageId,
    input.targetProfileId,
    input.signalId,
    input.occurredAtMs
  );
}

export function listPendingWakeStopOutcomes(
  sql: SqlStorage,
  limit = 50
): PendingWakeStopOutcome[] {
  return sql
    .exec<PendingWakeStopOutcome>(
      `SELECT dispatch_id AS dispatchId,
    client_message_id AS clientMessageId, target_profile_id AS targetProfileId,
    signal_id AS signalId, occurred_at_ms AS occurredAtMs
    FROM space_wake_stop_outcome_outbox ORDER BY occurred_at_ms LIMIT ?`,
      limit
    )
    .toArray();
}

export function completeWakeStopOutcome(
  sql: SqlStorage,
  dispatchId: string
): void {
  sql.exec(
    "DELETE FROM space_wake_stop_outcome_outbox WHERE dispatch_id = ?",
    dispatchId
  );
}

export function recordPendingWakeStop(
  sql: SqlStorage,
  input: PendingWakeStop & { requestedAtMs: number }
): void {
  sql.exec(
    `INSERT OR IGNORE INTO space_pending_wake_stops
      (source_profile_id, client_message_id, target_profile_id, requested_at_ms)
      VALUES (?, ?, ?, ?)`,
    input.sourceProfileId,
    input.clientMessageId,
    input.targetProfileId,
    input.requestedAtMs
  );
}

export function hasPendingWakeStop(
  sql: SqlStorage,
  input: PendingWakeStop
): boolean {
  return (
    sql
      .exec(
        `SELECT 1 FROM space_pending_wake_stops
      WHERE source_profile_id = ? AND client_message_id = ? AND target_profile_id = ?`,
        input.sourceProfileId,
        input.clientMessageId,
        input.targetProfileId
      )
      .toArray().length > 0
  );
}
