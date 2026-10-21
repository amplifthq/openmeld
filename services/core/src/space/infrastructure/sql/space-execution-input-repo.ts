import {
  type SpaceExecutionInputRequest,
  signalTextEnvelopeSchema,
  spaceExecutionInputRequestSchema,
} from "@openmeld/schemas";
import type {
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
  const columns = new Set(
    sql
      .exec<{ name: string }>("PRAGMA table_info(space_execution_input_outbox)")
      .toArray()
      .map((row) => row.name)
  );
  for (const [name, definition] of [
    ["queue_state", "TEXT"],
    ["queue_position", "INTEGER"],
    ["queue_claim", "TEXT"],
    ["queue_receipt_due_at_ms", "INTEGER"],
    ["queue_blocked", "INTEGER NOT NULL DEFAULT 0"],
    ["queue_after_dispatch_id", "TEXT"],
  ] as const) {
    if (!columns.has(name)) {
      sql.exec(
        `ALTER TABLE space_execution_input_outbox ADD COLUMN ${name} ${definition}`
      );
    }
  }
  sql.exec(`UPDATE space_execution_input_outbox
    SET queue_after_dispatch_id = json_extract(signal_json, '$.data.meta.centerAgentExecutionInput.dispatchId')
    WHERE queue_state IS NOT NULL AND queue_after_dispatch_id IS NULL`);
}

export function readSpaceExecutionInput(sql: SqlStorage, inputId: string) {
  const row = sql
    .exec<{
      request_json: string;
      signal_json: string;
      queue_state: string | null;
      queue_after_dispatch_id: string | null;
    }>(
      "SELECT request_json, signal_json, queue_state, queue_after_dispatch_id FROM space_execution_input_outbox WHERE input_id = ?",
      inputId
    )
    .toArray()[0];
  if (!row) {
    return null;
  }
  return {
    queued: row.queue_state !== null,
    state: row.queue_state,
    afterDispatchId: row.queue_after_dispatch_id,
    request: spaceExecutionInputRequestSchema.parse(
      JSON.parse(row.request_json)
    ),
    signal: signalTextEnvelopeSchema.parse(JSON.parse(row.signal_json)),
  };
}

export function insertSpaceExecutionInput(
  sql: SqlStorage,
  input: {
    request: SpaceExecutionInputRequest;
    signal: SignalEnvelope;
    nowMs: number;
    queued?: boolean;
  }
): void {
  if (
    input.queued &&
    (input.signal.type !== "signal.text" ||
      !input.signal.data.meta?.centerAgentExecutionInput ||
      input.request.target.spaceId !== input.signal.spaceId ||
      input.request.authorProfileId !== input.signal.profile.profileId ||
      input.request.sourceSignalId !== input.signal.id)
  ) {
    throw new Error("Queued execution input requires its exact Space target.");
  }
  sql.exec(
    `INSERT INTO space_execution_input_outbox (input_id, request_json, signal_json, next_attempt_at_ms, queue_state, queue_position, queue_after_dispatch_id)
    VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(queue_position), 0) + 1 FROM space_execution_input_outbox), ?)`,
    input.request.inputId,
    JSON.stringify(input.request),
    JSON.stringify(input.signal),
    input.queued ? null : input.nowMs,
    input.queued ? "queued" : null,
    input.signal.type === "signal.text"
      ? (input.signal.data.meta?.centerAgentExecutionInput?.dispatchId ?? null)
      : null
  );
}

type QueueClaim = "consume" | "steer";

/** The outbox retains the one input record before and after native delivery. */
export function listQueuedSpaceExecutionInputs(sql: SqlStorage) {
  return sql
    .exec<{
      input_id: string;
      request_json: string;
      signal_json: string;
      queue_state: "queued" | "claimed" | "unconfirmed";
      queue_claim: QueueClaim | null;
      queue_blocked: number;
      queue_after_dispatch_id: string;
      queue_receipt_due_at_ms: number | null;
    }>(`SELECT input_id, request_json, signal_json, queue_state, queue_claim, queue_blocked, queue_after_dispatch_id, queue_receipt_due_at_ms
    FROM space_execution_input_outbox
    WHERE queue_state IN ('queued', 'claimed', 'unconfirmed')
    ORDER BY queue_position`)
    .toArray()
    .map((row) => ({
      inputId: row.input_id,
      request: spaceExecutionInputRequestSchema.parse(
        JSON.parse(row.request_json)
      ),
      signal: signalTextEnvelopeSchema.parse(JSON.parse(row.signal_json)),
      state: row.queue_state,
      claim: row.queue_claim,
      blocked: row.queue_blocked === 1,
      afterDispatchId: row.queue_after_dispatch_id,
      // An unconfirmed input with no receipt read scheduled is undecided:
      // Core could not tell whether the Agent got it.
      delivery: deliveryForQueueState(
        row.queue_state,
        row.queue_receipt_due_at_ms
      ),
    }));
}

function deliveryForQueueState(
  state: "queued" | "claimed" | "unconfirmed",
  receiptDueAtMs: number | null
): "checking" | "undecided" | undefined {
  if (state !== "unconfirmed") {
    return undefined;
  }
  return receiptDueAtMs === null ? "undecided" : "checking";
}

/**
 * The author puts an undecided input back in the queue. It is delivered like
 * any queued input: after the response ends, or by Send now.
 */
export function retryUndecidedSpaceExecutionInput(
  sql: SqlStorage,
  inputId: string,
  authorProfileId: string
): boolean {
  return (
    sql
      .exec(
        `UPDATE space_execution_input_outbox
    SET queue_state = 'queued', queue_claim = NULL, queue_blocked = 0, queue_receipt_due_at_ms = NULL
    WHERE input_id = ? AND queue_state = 'unconfirmed' AND queue_receipt_due_at_ms IS NULL
    AND json_extract(request_json, '$.authorProfileId') = ? RETURNING input_id`,
        inputId,
        authorProfileId
      )
      .toArray().length === 1
  );
}

/** The caller atomically persists the original Signal and its dispatch in this transaction. */
export function completeQueuedSpaceInputHandoff(
  sql: SqlStorage,
  inputId: string,
  dispatchId: string
): void {
  const item = listQueuedSpaceExecutionInputs(sql).find(
    (row) => row.inputId === inputId
  );
  if (
    !(
      item &&
      settleQueuedSpaceExecutionInput(sql, inputId, "consume", "applied")
    )
  ) {
    throw new Error("Queued message handoff lost its claim.");
  }
  sql.exec(
    `UPDATE space_execution_input_outbox SET queue_after_dispatch_id = ?
    WHERE queue_state = 'queued' AND queue_after_dispatch_id = ?
    AND json_extract(request_json, '$.authorProfileId') = ?
    AND json_extract(signal_json, '$.data.meta.centerAgentExecutionInput.targetProfileId') = ?`,
    dispatchId,
    item.afterDispatchId,
    item.request.authorProfileId,
    item.signal.data.meta?.centerAgentExecutionInput?.targetProfileId ?? ""
  );
}

/** Final publication wakes this lane. It never polls or infers native execution state. */
export function listReadySpaceInputIds(sql: SqlStorage): string[] {
  return sql
    .exec<{
      input_id: string;
    }>(`SELECT candidate.input_id FROM space_execution_input_outbox AS candidate
    JOIN space_final_reply_claims AS final ON final.dispatch_id = candidate.queue_after_dispatch_id
      AND final.profile_id = json_extract(candidate.signal_json, '$.data.meta.centerAgentExecutionInput.targetProfileId')
    WHERE candidate.queue_state = 'queued' AND candidate.queue_blocked = 0
    AND NOT EXISTS (SELECT 1 FROM space_execution_input_outbox AS other
      WHERE json_extract(other.signal_json, '$.data.meta.centerAgentExecutionInput.targetProfileId') = json_extract(candidate.signal_json, '$.data.meta.centerAgentExecutionInput.targetProfileId')
      AND other.queue_after_dispatch_id = candidate.queue_after_dispatch_id
      AND (other.queue_state IN ('claimed', 'unconfirmed') OR
        (other.queue_state = 'queued' AND other.queue_position < candidate.queue_position)))
    ORDER BY candidate.queue_position`)
    .toArray()
    .map((row) => row.input_id);
}

export function blockQueuedSpaceInput(sql: SqlStorage, inputId: string): void {
  sql.exec(
    "UPDATE space_execution_input_outbox SET queue_blocked = 1 WHERE input_id = ? AND queue_state = 'queued'",
    inputId
  );
}

/** A failed prerequisite pauses every pending input that depends on it. */
export function blockQueuedSpaceInputsAfterDispatch(
  sql: SqlStorage,
  dispatchId: string,
  targetProfileId: string
): void {
  sql.exec(
    `UPDATE space_execution_input_outbox SET queue_blocked = 1
    WHERE queue_state = 'queued' AND queue_after_dispatch_id = ?
    AND json_extract(signal_json, '$.data.meta.centerAgentExecutionInput.targetProfileId') = ?`,
    dispatchId,
    targetProfileId
  );
}

/** Move only untouched drafts. Delivery receipts and their original bindings never move. */
export function continueQueuedSpaceInputs(
  sql: SqlStorage,
  input: {
    previousDispatchId: string;
    dispatchId: string;
    sourceWakeId: string;
    targetProfileId: string;
    authorProfileId: string;
  }
): void {
  sql.exec(
    `UPDATE space_execution_input_outbox
    SET queue_after_dispatch_id = ?, queue_blocked = 0,
      signal_json = json_set(signal_json, '$.data.contextSelection', json(?))
    WHERE queue_state = 'queued' AND queue_claim IS NULL
      AND queue_after_dispatch_id = ?
      AND json_extract(request_json, '$.kind') = 'local'
      AND json_extract(request_json, '$.authorProfileId') = ?
      AND json_extract(request_json, '$.target.targetProfileId') = ?`,
    input.dispatchId,
    JSON.stringify({ mode: "resume", sourceWakeId: input.sourceWakeId }),
    input.previousDispatchId,
    input.authorProfileId,
    input.targetProfileId
  );
}

/** Compare-and-set before the first delivery to the successor's native turn. */
export function rebindQueuedSpaceInput(
  sql: SqlStorage,
  input: {
    request: SpaceExecutionInputRequest;
    signal: Extract<SignalEnvelope, { type: "signal.text" }>;
    dispatchId: string;
  }
): boolean {
  return (
    sql
      .exec(
        `UPDATE space_execution_input_outbox SET request_json = ?, signal_json = ?
    WHERE input_id = ? AND queue_state = 'queued' AND queue_claim IS NULL
      AND queue_after_dispatch_id = ? RETURNING input_id`,
        JSON.stringify(input.request),
        JSON.stringify(input.signal),
        input.request.inputId,
        input.dispatchId
      )
      .toArray().length === 1
  );
}

export function deleteQueuedSpaceExecutionInput(
  sql: SqlStorage,
  inputId: string,
  authorProfileId: string
): boolean {
  return (
    sql
      .exec(
        `UPDATE space_execution_input_outbox SET queue_state = 'deleted', queue_receipt_due_at_ms = NULL
    WHERE input_id = ? AND (queue_state = 'queued'
      OR (queue_state = 'unconfirmed' AND queue_receipt_due_at_ms IS NULL))
    AND json_extract(request_json, '$.authorProfileId') = ? RETURNING input_id`,
        inputId,
        authorProfileId
      )
      .toArray().length === 1
  );
}

/** Run inside the Space storage transaction together with the caller's authorization. */
export function reorderQueuedSpaceExecutionInputs(
  sql: SqlStorage,
  expectedIds: readonly string[],
  orderedIds: readonly string[],
  authorProfileId?: string
): boolean {
  const rows = sql
    .exec<{ input_id: string; queue_position: number }>(
      "SELECT input_id, queue_position FROM space_execution_input_outbox WHERE queue_state = 'queued' AND (? IS NULL OR json_extract(signal_json, '$.profile.profileId') = ?) ORDER BY queue_position",
      authorProfileId ?? null,
      authorProfileId ?? null
    )
    .toArray();
  if (
    rows.length !== expectedIds.length ||
    rows.some((row, index) => row.input_id !== expectedIds[index]) ||
    orderedIds.length !== rows.length ||
    new Set(orderedIds).size !== rows.length ||
    orderedIds.some((id) => !expectedIds.includes(id))
  ) {
    return false;
  }
  for (const [index, id] of orderedIds.entries()) {
    const row = rows[index];
    if (!row) {
      throw new Error("Queue order changed during transaction.");
    }
    sql.exec(
      "UPDATE space_execution_input_outbox SET queue_position = ? WHERE input_id = ? AND queue_state = 'queued'",
      row.queue_position,
      id
    );
  }
  return true;
}

/** Claim before any await. Unknown delivery holds later inputs in the same task chain. */
export function claimQueuedSpaceExecutionInput(
  sql: SqlStorage,
  inputId: string,
  claim: QueueClaim
): boolean {
  return (
    sql
      .exec(
        `UPDATE space_execution_input_outbox AS candidate
    SET queue_state = 'claimed', queue_claim = ?, queue_receipt_due_at_ms = CASE WHEN ? = 'steer' THEN ? ELSE NULL END
    WHERE input_id = ? AND queue_state = 'queued' AND queue_blocked = 0
    AND NOT EXISTS (SELECT 1 FROM space_execution_input_outbox AS other
      WHERE json_extract(other.signal_json, '$.data.meta.centerAgentExecutionInput.targetProfileId') = json_extract(candidate.signal_json, '$.data.meta.centerAgentExecutionInput.targetProfileId')
      AND other.queue_after_dispatch_id = candidate.queue_after_dispatch_id
      AND (other.queue_state IN ('claimed', 'unconfirmed') OR
        (? = 'consume' AND other.queue_state = 'queued' AND other.queue_position < candidate.queue_position)))
    RETURNING input_id`,
        claim,
        claim,
        Date.now() + 1000,
        inputId,
        claim
      )
      .toArray().length === 1
  );
}

export function settleQueuedSpaceExecutionInput(
  sql: SqlStorage,
  inputId: string,
  claim: QueueClaim,
  outcome: "applied" | "rejected" | "returned" | "unconfirmed"
): boolean {
  // `returned`: a receipt read proved the Agent never got it; it is sendable
  // again. `rejected`: the Agent refused it at apply; it waits for an edit.
  const stateByOutcome = {
    applied: "consumed",
    rejected: "queued",
    returned: "queued",
    unconfirmed: "unconfirmed",
  } as const;
  return (
    sql
      .exec(
        `UPDATE space_execution_input_outbox
    SET queue_state = ?, queue_blocked = ?, queue_receipt_due_at_ms = NULL
    WHERE input_id = ? AND queue_claim = ? AND queue_state IN ('claimed', 'unconfirmed')
    RETURNING input_id`,
        stateByOutcome[outcome],
        outcome === "rejected" ? 1 : 0,
        inputId,
        claim
      )
      .toArray().length === 1
  );
}

export function listDueSpaceExecutionInputs(sql: SqlStorage, nowMs: number) {
  return sql
    .exec<{
      input_id: string;
      request_json: string;
      signal_json: string;
      attempt_count: number;
      queue_claim: QueueClaim | null;
    }>(
      `SELECT input_id, request_json, signal_json, attempt_count, queue_claim FROM space_execution_input_outbox
     WHERE (queue_state IS NULL AND next_attempt_at_ms <= ?)
       OR (queue_claim = 'steer' AND queue_state IN ('claimed', 'unconfirmed') AND queue_receipt_due_at_ms <= ?)
     ORDER BY rowid LIMIT 20`,
      nowMs,
      nowMs
    )
    .toArray()
    .map((row) => ({
      inputId: row.input_id,
      request: spaceExecutionInputRequestSchema.parse(
        JSON.parse(row.request_json)
      ),
      signal: signalTextEnvelopeSchema.parse(JSON.parse(row.signal_json)),
      attemptCount: row.attempt_count,
      queueClaim: row.queue_claim,
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
    `UPDATE space_execution_input_outbox
      SET next_attempt_at_ms = CASE WHEN queue_state IS NULL THEN ? ELSE NULL END,
          queue_receipt_due_at_ms = CASE WHEN queue_state IN ('claimed', 'unconfirmed') THEN ? ELSE NULL END,
          response_json = COALESCE(?, response_json), attempt_count = attempt_count + 1 WHERE input_id = ?`,
    input.nextAttemptAtMs,
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
        `SELECT MIN(CASE WHEN queue_state IS NULL THEN next_attempt_at_ms ELSE queue_receipt_due_at_ms END) AS due FROM space_execution_input_outbox
         WHERE queue_state IS NULL OR (queue_claim = 'steer' AND queue_state IN ('claimed', 'unconfirmed'))`
      )
      .toArray()[0]?.due ?? null
  );
}
