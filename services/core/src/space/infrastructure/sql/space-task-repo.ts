import {
  SPACE_TASK_LIST_MAX_ITEMS,
  spaceTaskEventSchema,
  spaceTaskMutationReceiptSchema,
  spaceTaskSchema,
} from "@openmeld/schemas";
import type {
  SpaceTask,
  SpaceTaskEvent,
  SpaceTaskMutationReceipt,
  SpaceTaskPhase,
} from "@openmeld/schemas/types";

type StoredTaskRow = { task_json: string };
type StoredEventRow = { event_json: string };
type StoredOperationRow = { request_json: string; response_json: string };

export function ensureSpaceTaskTables(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS space_tasks (
    task_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    phase TEXT NOT NULL
      CHECK (phase IN ('to_do', 'in_progress', 'in_review', 'done', 'canceled')),
    revision INTEGER NOT NULL,
    task_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS space_task_events (
    event_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE,
    event_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS space_task_operations (
    operation_id TEXT PRIMARY KEY,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  )`);
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_tasks_phase_updated ON space_tasks (phase, updated_at_ms DESC, task_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_task_events_task_created ON space_task_events (task_id, created_at_ms, event_id)"
  );
}

export class SpaceTaskRepository {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  readTask(taskId: string): SpaceTask | null {
    const row = this.sql
      .exec<StoredTaskRow>(
        "SELECT task_json FROM space_tasks WHERE task_id = ? LIMIT 1",
        taskId
      )
      .toArray()[0];
    return row ? parseTask(row.task_json) : null;
  }

  listTasks(phase?: SpaceTaskPhase): SpaceTask[] {
    const rows = phase
      ? this.sql
          .exec<StoredTaskRow>(
            `SELECT task_json FROM space_tasks
             WHERE phase = ?
             ORDER BY updated_at_ms DESC, task_id
             LIMIT ?`,
            phase,
            SPACE_TASK_LIST_MAX_ITEMS + 1
          )
          .toArray()
      : this.sql
          .exec<StoredTaskRow>(
            `SELECT task_json FROM space_tasks
             ORDER BY
               CASE phase
                 WHEN 'in_review' THEN 0
                 WHEN 'in_progress' THEN 1
                 WHEN 'to_do' THEN 2
                 WHEN 'done' THEN 3
                 ELSE 4
               END,
               updated_at_ms DESC,
               task_id
             LIMIT ?`,
            SPACE_TASK_LIST_MAX_ITEMS + 1
          )
          .toArray();
    return rows.map((row) => parseTask(row.task_json));
  }

  listEvents(taskId: string): SpaceTaskEvent[] {
    return this.sql
      .exec<StoredEventRow>(
        `SELECT event_json FROM space_task_events
         WHERE task_id = ?
         ORDER BY created_at_ms, event_id`,
        taskId
      )
      .toArray()
      .map((row) => parseEvent(row.event_json));
  }

  readOperation(operationId: string): {
    requestJson: string;
    receipt: SpaceTaskMutationReceipt;
  } | null {
    const row = this.sql
      .exec<StoredOperationRow>(
        `SELECT request_json, response_json
         FROM space_task_operations
         WHERE operation_id = ?
         LIMIT 1`,
        operationId
      )
      .toArray()[0];
    if (!row) {
      return null;
    }
    return {
      requestJson: row.request_json,
      receipt: spaceTaskMutationReceiptSchema.parse(
        JSON.parse(row.response_json)
      ),
    };
  }

  insertTask(task: SpaceTask): void {
    this.sql.exec(
      `INSERT INTO space_tasks (
         task_id, space_id, phase, revision, task_json, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      task.taskId,
      task.spaceId,
      task.phase,
      task.revision,
      JSON.stringify(task),
      Date.parse(task.createdAt),
      Date.parse(task.updatedAt)
    );
  }

  updateTask(task: SpaceTask, expectedRevision: number): void {
    const result = this.sql.exec(
      `UPDATE space_tasks
       SET phase = ?, revision = ?, task_json = ?, updated_at_ms = ?
       WHERE task_id = ? AND revision = ?`,
      task.phase,
      task.revision,
      JSON.stringify(task),
      Date.parse(task.updatedAt),
      task.taskId,
      expectedRevision
    );
    if (result.rowsWritten !== 1) {
      throw new Error("space_task.concurrent_update");
    }
  }

  appendEvent(event: SpaceTaskEvent): void {
    this.sql.exec(
      `INSERT INTO space_task_events (
         event_id, task_id, operation_id, event_json, created_at_ms
       ) VALUES (?, ?, ?, ?, ?)`,
      event.eventId,
      event.taskId,
      event.operationId,
      JSON.stringify(event),
      Date.parse(event.createdAt)
    );
  }

  recordOperation(input: {
    operationId: string;
    requestJson: string;
    receipt: SpaceTaskMutationReceipt;
  }): void {
    this.sql.exec(
      `INSERT INTO space_task_operations (
         operation_id, request_json, response_json, created_at_ms
       ) VALUES (?, ?, ?, ?)`,
      input.operationId,
      input.requestJson,
      JSON.stringify(input.receipt),
      Date.now()
    );
  }
}

const parseTask = (json: string): SpaceTask =>
  spaceTaskSchema.parse(JSON.parse(json));

const parseEvent = (json: string): SpaceTaskEvent =>
  spaceTaskEventSchema.parse(JSON.parse(json));
