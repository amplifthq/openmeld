import {
  spaceTaskActorSchema,
  spaceTaskMutationReceiptSchema,
} from "@openmeld/schemas";
import type {
  SpaceTaskActor,
  SpaceTaskMutationReceipt,
} from "@openmeld/schemas/types";
import type { SourceDispatchChainContext } from "../../application/types";

export type SpaceTaskDeliveryKind =
  | "inbox_projection"
  | "handoff"
  | "completion"
  | "stop"
  | "github_projection"
  | "project_projection";
export type SpaceTaskDelivery = {
  id: string;
  kind: SpaceTaskDeliveryKind;
  receipt: SpaceTaskMutationReceipt;
  actor: SpaceTaskActor | null;
  wakeTargets?: Array<{ sourceSignalId: string; targetProfileId: string }>;
  sourceDispatchChainContext?: SourceDispatchChainContext;
};

const MAX_DELIVERY_ATTEMPTS = 12;
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Delivery intent and execution references only; Task and runtime retain their owners. */
export class SpaceTaskDeliveryRepository {
  private readonly sql: SqlStorage;
  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  initialize(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS space_task_delivery_outbox (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload_json TEXT NOT NULL, next_attempt_ms INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_space_task_delivery_due
      ON space_task_delivery_outbox (next_attempt_ms);
    CREATE TABLE IF NOT EXISTS space_task_wake_refs (
      task_id TEXT NOT NULL, source_signal_id TEXT NOT NULL, target_profile_id TEXT NOT NULL,
      PRIMARY KEY (task_id, source_signal_id, target_profile_id)
    );`);
    const columns = this.sql
      .exec<{ name: string }>("PRAGMA table_info(space_task_delivery_outbox)")
      .toArray();
    if (!columns.some((column) => column.name === "updated_at_ms")) {
      this.sql.exec(
        "ALTER TABLE space_task_delivery_outbox ADD COLUMN updated_at_ms INTEGER NOT NULL DEFAULT 0"
      );
    }
  }

  enqueue(delivery: SpaceTaskDelivery, nowMs: number): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO space_task_delivery_outbox
       (id, task_id, kind, payload_json, next_attempt_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      delivery.id,
      delivery.receipt.task.taskId,
      delivery.kind,
      JSON.stringify(delivery),
      nowMs,
      nowMs
    );
  }

  pending(nowMs: number): SpaceTaskDelivery[] {
    const rows = this.sql
      .exec<{ id: string; payload_json: string }>(
        `SELECT id, payload_json FROM space_task_delivery_outbox
       WHERE next_attempt_ms <= ? ORDER BY next_attempt_ms, rowid LIMIT 20`,
        nowMs
      )
      .toArray();
    const deliveries: SpaceTaskDelivery[] = [];
    for (const row of rows) {
      try {
        deliveries.push(this.parse(row.payload_json));
      } catch {
        this.fail(
          row.id,
          nowMs,
          "Stored Task delivery cannot be read. Contact support.",
          true
        );
      }
    }
    return deliveries;
  }

  read(id: string): SpaceTaskDelivery | null {
    const row = this.sql
      .exec<{ payload_json: string }>(
        "SELECT payload_json FROM space_task_delivery_outbox WHERE id = ?",
        id
      )
      .toArray()[0];
    return row ? this.parse(row.payload_json) : null;
  }

  complete(id: string): void {
    this.sql.exec("DELETE FROM space_task_delivery_outbox WHERE id = ?", id);
  }

  fail(id: string, nowMs: number, message: string, terminal = false): void {
    const row = this.sql
      .exec<{ attempts: number; kind: SpaceTaskDeliveryKind }>(
        "SELECT attempts, kind FROM space_task_delivery_outbox WHERE id = ?",
        id
      )
      .toArray()[0];
    if (!row) {
      return;
    }
    const attempts = row.attempts + 1;
    // Internal Inbox reconciliation must survive a prolonged database outage.
    // Public delivery actions retain their visible terminal failure policy.
    const exhausted =
      terminal ||
      (row.kind !== "inbox_projection" && attempts >= MAX_DELIVERY_ATTEMPTS);
    const retryDelayMs = Math.min(
      60_000 * 2 ** Math.min(attempts - 1, 6),
      3_600_000
    );
    this.sql.exec(
      `UPDATE space_task_delivery_outbox SET attempts = ?,
       next_attempt_ms = ?, last_error = ?, updated_at_ms = ? WHERE id = ?`,
      attempts,
      exhausted ? null : nowMs + retryDelayMs,
      !terminal && exhausted
        ? "Automatic delivery stopped after repeated failures. Continue from the Space discussion or contact support."
        : message,
      nowMs,
      id
    );
  }

  cleanupTerminal(nowMs: number): void {
    this.sql.exec(
      `DELETE FROM space_task_delivery_outbox WHERE id IN (
         SELECT id FROM space_task_delivery_outbox
         WHERE next_attempt_ms IS NULL AND last_error IS NOT NULL
           AND updated_at_ms + ? <= ?
         ORDER BY updated_at_ms, id LIMIT 20
       )`,
      TERMINAL_RETENTION_MS,
      nowMs
    );
  }

  nextAttempt(): number | null {
    return (
      this.sql
        .exec<{ next: number | null }>(
          `SELECT MIN(CASE WHEN next_attempt_ms IS NOT NULL THEN next_attempt_ms
           WHEN last_error IS NOT NULL THEN updated_at_ms + ? END) AS next
           FROM space_task_delivery_outbox`,
          TERMINAL_RETENTION_MS
        )
        .toArray()[0]?.next ?? null
    );
  }

  status(taskId: string) {
    return this.sql
      .exec<{ kind: SpaceTaskDeliveryKind; last_error: string | null }>(
        "SELECT kind, last_error FROM space_task_delivery_outbox WHERE task_id = ? ORDER BY rowid",
        taskId
      )
      .toArray()
      .map((row) => ({
        kind: row.kind,
        state: row.last_error ? ("failed" as const) : ("pending" as const),
        error: row.last_error,
      }));
  }

  recordWake(
    taskId: string,
    sourceSignalId: string,
    targetProfileId: string
  ): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO space_task_wake_refs VALUES (?, ?, ?)",
      taskId,
      sourceSignalId,
      targetProfileId
    );
  }

  wakeRefs(
    taskId: string
  ): Array<{ sourceSignalId: string; targetProfileId: string }> {
    return this.sql
      .exec<{ source_signal_id: string; target_profile_id: string }>(
        "SELECT source_signal_id, target_profile_id FROM space_task_wake_refs WHERE task_id = ?",
        taskId
      )
      .toArray()
      .map((row) => ({
        sourceSignalId: row.source_signal_id,
        targetProfileId: row.target_profile_id,
      }));
  }

  hasWake(
    taskId: string,
    sourceSignalId: string,
    targetProfileId: string
  ): boolean {
    return (
      this.sql
        .exec<{ present: number }>(
          `SELECT 1 AS present FROM space_task_wake_refs
       WHERE task_id = ? AND source_signal_id = ? AND target_profile_id = ? LIMIT 1`,
          taskId,
          sourceSignalId,
          targetProfileId
        )
        .toArray().length > 0
    );
  }

  /** One source message may seed several Tasks. Only the Task owner's
   * deterministic handoff Signal identifies one exact Task for this Wake. */
  readHandoffTaskId(
    sourceSignalId: string,
    targetProfileId: string
  ): string | null {
    return (
      this.sql
        .exec<{ task_id: string }>(
          `
      SELECT wake.task_id FROM space_task_wake_refs AS wake
      JOIN space_task_events AS event ON event.task_id = wake.task_id
      WHERE wake.source_signal_id = ? AND wake.target_profile_id = ?
        AND wake.source_signal_id = 'space-task-handoff:' || event.event_id
      LIMIT 1`,
          sourceSignalId,
          targetProfileId
        )
        .toArray()[0]?.task_id ?? null
    );
  }

  private parse(json: string): SpaceTaskDelivery {
    const value = JSON.parse(json) as SpaceTaskDelivery;
    return {
      ...value,
      receipt: spaceTaskMutationReceiptSchema.parse(value.receipt),
      actor: value.actor ? spaceTaskActorSchema.parse(value.actor) : null,
    };
  }
}
