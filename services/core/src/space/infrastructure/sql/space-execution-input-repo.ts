import {
  remoteAgentWorkerExecutionInputRequestSchema,
  signalTextEnvelopeSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentWorkerExecutionInputRequest,
  RemoteAgentWorkerExecutionInputResponse,
  SignalEnvelope,
} from "@openmeld/schemas/types";

export function ensureSpaceExecutionInputOutbox(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS space_execution_input_outbox (
    input_id TEXT PRIMARY KEY,
    request_json TEXT NOT NULL,
    signal_json TEXT NOT NULL,
    next_attempt_at_ms INTEGER,
    response_json TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0
  )`);
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_execution_input_due ON space_execution_input_outbox(next_attempt_at_ms) WHERE next_attempt_at_ms IS NOT NULL"
  );
}

export function readSpaceExecutionInput(sql: SqlStorage, inputId: string) {
  const row = sql
    .exec<{ request_json: string; signal_json: string }>(
      "SELECT request_json, signal_json FROM space_execution_input_outbox WHERE input_id = ?",
      inputId
    )
    .toArray()[0];
  if (!row) {
    return null;
  }
  return {
    request: remoteAgentWorkerExecutionInputRequestSchema.parse(
      JSON.parse(row.request_json)
    ),
    signal: signalTextEnvelopeSchema.parse(JSON.parse(row.signal_json)),
  };
}

export function insertSpaceExecutionInput(
  sql: SqlStorage,
  input: {
    request: RemoteAgentWorkerExecutionInputRequest;
    signal: SignalEnvelope;
    nowMs: number;
  }
): void {
  sql.exec(
    `INSERT INTO space_execution_input_outbox (input_id, request_json, signal_json, next_attempt_at_ms)
    VALUES (?, ?, ?, ?)`,
    input.request.inputId,
    JSON.stringify(input.request),
    JSON.stringify(input.signal),
    input.nowMs
  );
}

export function listDueSpaceExecutionInputs(sql: SqlStorage, nowMs: number) {
  return sql
    .exec<{
      input_id: string;
      request_json: string;
      signal_json: string;
      attempt_count: number;
    }>(
      `SELECT input_id, request_json, signal_json, attempt_count FROM space_execution_input_outbox
     WHERE next_attempt_at_ms IS NOT NULL AND next_attempt_at_ms <= ? ORDER BY rowid LIMIT 20`,
      nowMs
    )
    .toArray()
    .map((row) => ({
      inputId: row.input_id,
      request: remoteAgentWorkerExecutionInputRequestSchema.parse(
        JSON.parse(row.request_json)
      ),
      signal: signalTextEnvelopeSchema.parse(JSON.parse(row.signal_json)),
      attemptCount: row.attempt_count,
    }));
}

export function updateSpaceExecutionInput(
  sql: SqlStorage,
  input: {
    inputId: string;
    response?: RemoteAgentWorkerExecutionInputResponse;
    nextAttemptAtMs: number | null;
  }
): void {
  sql.exec(
    "UPDATE space_execution_input_outbox SET next_attempt_at_ms = ?, response_json = COALESCE(?, response_json), attempt_count = attempt_count + 1 WHERE input_id = ?",
    input.nextAttemptAtMs,
    input.response ? JSON.stringify(input.response) : null,
    input.inputId
  );
}

export function readNextSpaceExecutionInputAlarm(
  sql: SqlStorage
): number | null {
  return (
    sql
      .exec<{ due: number | null }>(
        "SELECT MIN(next_attempt_at_ms) AS due FROM space_execution_input_outbox"
      )
      .toArray()[0]?.due ?? null
  );
}
