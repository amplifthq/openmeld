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
  | "handoff"
  | "completion"
  | "stop"
  | "github_projection";
export type SpaceTaskDelivery = {
  id: string;
  kind: SpaceTaskDeliveryKind;
  receipt: SpaceTaskMutationReceipt;
  actor: SpaceTaskActor | null;
  wakeTargets?: Array<{ sourceSignalId: string; targetProfileId: string }>;
  sourceDispatchChainContext?: SourceDispatchChainContext;
};

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
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_space_task_delivery_due
      ON space_task_delivery_outbox (next_attempt_ms);
    CREATE TABLE IF NOT EXISTS space_task_wake_refs (
      task_id TEXT NOT NULL, source_signal_id TEXT NOT NULL, target_profile_id TEXT NOT NULL,
      PRIMARY KEY (task_id, source_signal_id, target_profile_id)
    );`);
  }

  enqueue(delivery: SpaceTaskDelivery, nowMs: number): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO space_task_delivery_outbox
       (id, task_id, kind, payload_json, next_attempt_ms) VALUES (?, ?, ?, ?, ?)`,
      delivery.id,
      delivery.receipt.task.taskId,
      delivery.kind,
      JSON.stringify(delivery),
      nowMs
    );
  }

  pending(nowMs: number): SpaceTaskDelivery[] {
    return this.sql
      .exec<{ payload_json: string }>(
        `SELECT payload_json FROM space_task_delivery_outbox
       WHERE next_attempt_ms <= ? ORDER BY next_attempt_ms, rowid LIMIT 20`,
        nowMs
      )
      .toArray()
      .map((row) => this.parse(row.payload_json));
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
    this.sql.exec(
      `UPDATE space_task_delivery_outbox SET attempts = attempts + 1,
       next_attempt_ms = ?, last_error = ? WHERE id = ?`,
      terminal ? null : nowMs + 60_000,
      message,
      id
    );
  }

  nextAttempt(): number | null {
    return (
      this.sql
        .exec<{ next: number | null }>(
          "SELECT MIN(next_attempt_ms) AS next FROM space_task_delivery_outbox"
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

  private parse(json: string): SpaceTaskDelivery {
    const value = JSON.parse(json) as SpaceTaskDelivery;
    return {
      ...value,
      receipt: spaceTaskMutationReceiptSchema.parse(value.receipt),
      actor: value.actor ? spaceTaskActorSchema.parse(value.actor) : null,
    };
  }
}
