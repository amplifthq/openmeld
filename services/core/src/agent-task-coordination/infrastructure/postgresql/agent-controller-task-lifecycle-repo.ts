import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  agentTaskHandleSchema,
  agentTaskTerminalOutcomeSchema,
  buildAgentTaskKey,
  submitAgentControllerTaskLifecycleEventItemSchema,
} from "@openmeld/schemas";
import type {
  AgentTaskHandle,
  AgentTaskTerminalOutcome,
  SubmitAgentControllerTaskLifecycleEventItem,
} from "@openmeld/schemas/types";

type ControllerTaskHandle = Extract<
  AgentTaskHandle,
  {
    kind: "controller_task";
  }
>;
export type RegisteredAgentControllerTask = {
  agentControllerRef: string;
  hostId: string;
  occurredAtMs: number;
  organizationId: string;
  ownerUserId: string;
  registrationEventId: string;
  registrationSource: SubmitAgentControllerTaskLifecycleEventItem["source"];
  task: ControllerTaskHandle;
  taskId: string;
  updatedAtMs: number;
  openMeldServiceRuntimeId: string;
};
export type AgentControllerTaskLifecycleEventRecord = {
  event: SubmitAgentControllerTaskLifecycleEventItem;
  processedAtMs: number | null;
  task: ControllerTaskHandle;
};
type RegisteredAgentControllerTaskRow = {
  agent_controller_ref: string;
  host_id: string;
  occurred_at_ms: number;
  organization_id: string;
  owner_user_id: string;
  registration_event_id: string;
  registration_source: SubmitAgentControllerTaskLifecycleEventItem["source"];
  task_handle_json: string;
  task_id: string;
  task_key: string;
  updated_at_ms: number;
  openmeld_service_runtime_id: string;
};
type ListedRegisteredAgentControllerTaskRow =
  RegisteredAgentControllerTaskRow & {
    terminal_outcome_json: string | null;
  };
type AgentControllerTaskLifecycleEventRow = {
  event_id: string;
  event_type: SubmitAgentControllerTaskLifecycleEventItem["eventType"];
  occurred_at_ms: number;
  payload_json: string;
  processed_at_ms: number | null;
  source: SubmitAgentControllerTaskLifecycleEventItem["source"];
  task_key: string;
};
export class AgentControllerTaskLifecycleStorageConflictError extends Error {
  readonly code: "event_id_conflict" | "registered_task_identity_conflict";
  constructor(
    code: AgentControllerTaskLifecycleStorageConflictError["code"],
    message: string
  ) {
    super(message);
    this.name = "AgentControllerTaskLifecycleStorageConflictError";
    this.code = code;
  }
}
export async function createAgentControllerTaskLifecycleEvent(input: {
  db: PostgresDatabase;
  event: SubmitAgentControllerTaskLifecycleEventItem;
  hostId: string;
  nowMs: number;
}): Promise<AgentControllerTaskLifecycleEventRecord> {
  const event = submitAgentControllerTaskLifecycleEventItemSchema.parse(
    input.event
  );
  const task = createControllerTaskHandle({
    agentControllerRef: event.agentControllerRef,
    hostId: input.hostId,
    taskId: event.taskId,
  });
  const taskKey = buildAgentTaskKey(task);
  const payloadJson = serializeJson(event);
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."agent_controller_task_lifecycle_events" (
          event_id,
          task_key,
          event_type,
          source,
          payload_json,
          occurred_at_ms,
          observed_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT(event_id) DO NOTHING
      `,
    values: [
      event.eventId,
      taskKey,
      event.eventType,
      event.source,
      payloadJson,
      event.occurredAtMs,
      requireTimestamp(input.nowMs, "nowMs"),
    ],
  });
  const row = await readAgentControllerTaskLifecycleEventRow({
    db: input.db,
    eventId: event.eventId,
  });
  if (!row) {
    throw new Error("Agent Controller task lifecycle event write lost its row");
  }
  if (
    row.task_key !== taskKey ||
    row.event_type !== event.eventType ||
    row.source !== event.source ||
    row.payload_json !== payloadJson ||
    row.occurred_at_ms !== event.occurredAtMs
  ) {
    throw new AgentControllerTaskLifecycleStorageConflictError(
      "event_id_conflict",
      "Agent Controller task lifecycle event ID was reused with different input"
    );
  }
  return {
    event,
    processedAtMs: normalizeNullableTimestamp(row.processed_at_ms),
    task,
  };
}
export async function registerAgentControllerTask(input: {
  db: PostgresDatabase;
  event: SubmitAgentControllerTaskLifecycleEventItem;
  hostId: string;
  nowMs: number;
  ownerUserId: string;
  openMeldServiceRuntimeId: string;
}): Promise<RegisteredAgentControllerTask> {
  if (input.event.eventType !== "registered") {
    throw new Error(
      "Agent Controller task registration requires a registered event"
    );
  }
  const task = createControllerTaskHandle({
    agentControllerRef: input.event.agentControllerRef,
    hostId: input.hostId,
    taskId: input.event.taskId,
  });
  const taskKey = buildAgentTaskKey(task);
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."agent_controller_tasks" (
          task_key,
          organization_id,
          owner_user_id,
          openmeld_service_runtime_id,
          host_id,
          agent_controller_ref,
          task_id,
          task_handle_json,
          registration_event_id,
          registration_source,
          occurred_at_ms,
          observed_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT(task_key) DO NOTHING
      `,
    values: [
      taskKey,
      requireNonEmpty(input.event.organizationId, "organizationId"),
      requireNonEmpty(input.ownerUserId, "ownerUserId"),
      requireNonEmpty(
        input.openMeldServiceRuntimeId,
        "openMeldServiceRuntimeId"
      ),
      task.hostId,
      task.agentControllerRef,
      task.taskId,
      serializeJson(task),
      input.event.eventId,
      input.event.source,
      input.event.occurredAtMs,
      nowMs,
      nowMs,
    ],
  });
  const registered = await readRegisteredAgentControllerTask({
    db: input.db,
    task,
  });
  if (!registered) {
    throw new Error("Agent Controller task registration write lost its row");
  }
  if (
    registered.organizationId !== input.event.organizationId ||
    registered.ownerUserId !== input.ownerUserId ||
    registered.openMeldServiceRuntimeId !== input.openMeldServiceRuntimeId ||
    registered.registrationEventId !== input.event.eventId ||
    registered.registrationSource !== input.event.source ||
    registered.occurredAtMs !== input.event.occurredAtMs
  ) {
    throw new AgentControllerTaskLifecycleStorageConflictError(
      "registered_task_identity_conflict",
      "Agent Controller task was registered with different authority or lifecycle evidence"
    );
  }
  return registered;
}
export async function readRegisteredAgentControllerTask(input: {
  db: PostgresDatabase;
  task: AgentTaskHandle;
}): Promise<RegisteredAgentControllerTask | null> {
  const parsedTask = agentTaskHandleSchema.parse(input.task);
  if (parsedTask.kind !== "controller_task") {
    return null;
  }
  const row = await input.db
    .query<RegisteredAgentControllerTaskRow>({
      text: `
        SELECT *
        FROM "openmeld"."agent_controller_tasks"
        WHERE task_key = $1
        LIMIT 1
      `,
      values: [buildAgentTaskKey(parsedTask)],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? parseRegisteredTaskRow(row) : null;
}
export async function listRegisteredAgentControllerTasks(input: {
  agentControllerRef?: string;
  db: PostgresDatabase;
  limit: number;
  organizationId: string;
  ownerUserId: string;
}): Promise<
  {
    outcome: AgentTaskTerminalOutcome | null;
    registeredTask: RegisteredAgentControllerTask;
  }[]
> {
  const limit = Math.max(1, Math.min(21, Math.trunc(input.limit)));
  const organizationId = requireNonEmpty(
    input.organizationId,
    "organizationId"
  );
  const ownerUserId = requireNonEmpty(input.ownerUserId, "ownerUserId");
  const agentControllerRef = input.agentControllerRef
    ? requireNonEmpty(input.agentControllerRef, "agentControllerRef")
    : null;
  const rows = await input.db.query<ListedRegisteredAgentControllerTaskRow>({
    text: `
        SELECT
          tasks.*,
          outcomes.outcome_json AS terminal_outcome_json
        FROM "openmeld"."agent_controller_tasks" AS tasks
        LEFT JOIN "openmeld"."agent_task_terminal_outcomes" AS outcomes
          ON outcomes.task_key = tasks.task_key
        WHERE tasks.organization_id = $1
          AND tasks.owner_user_id = $2
          AND ($3::text IS NULL OR tasks.agent_controller_ref = $4)
        ORDER BY tasks.occurred_at_ms DESC NULLS LAST, tasks.task_key ASC NULLS FIRST
        LIMIT $5
      `,
    values: [
      organizationId,
      ownerUserId,
      agentControllerRef,
      agentControllerRef,
      limit,
    ],
  });
  return (rows.rows ?? []).map((row) => ({
    outcome:
      row.terminal_outcome_json === null
        ? null
        : agentTaskTerminalOutcomeSchema.parse(
            parseJson(row.terminal_outcome_json)
          ),
    registeredTask: parseRegisteredTaskRow(row),
  }));
}
export async function markAgentControllerTaskLifecycleEventProcessed(input: {
  db: PostgresDatabase;
  eventId: string;
  nowMs: number;
}): Promise<void> {
  const result = await input.db
    .query<{
      event_id: string;
    }>({
      text: `
        UPDATE "openmeld"."agent_controller_task_lifecycle_events"
        SET processed_at_ms = COALESCE(processed_at_ms, $1)
        WHERE event_id = $2
        RETURNING event_id
      `,
      values: [
        requireTimestamp(input.nowMs, "nowMs"),
        requireNonEmpty(input.eventId, "eventId"),
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!result) {
    throw new Error(
      "Agent Controller task lifecycle event processing lost its row"
    );
  }
}
export async function hasAgentControllerTaskLifecycleEvent(input: {
  db: PostgresDatabase;
  eventId: string;
}): Promise<boolean> {
  return (
    (await readAgentControllerTaskLifecycleEventRow({
      db: input.db,
      eventId: input.eventId,
    })) !== null
  );
}
function createControllerTaskHandle(input: {
  agentControllerRef: string;
  hostId: string;
  taskId: string;
}): ControllerTaskHandle {
  const task = agentTaskHandleSchema.parse({
    agentControllerRef: input.agentControllerRef,
    hostId: input.hostId,
    kind: "controller_task",
    taskId: input.taskId,
    v: 1,
  });
  if (task.kind !== "controller_task") {
    throw new Error("Agent Controller task handle changed kind");
  }
  return task;
}
async function readAgentControllerTaskLifecycleEventRow(input: {
  db: PostgresDatabase;
  eventId: string;
}): Promise<AgentControllerTaskLifecycleEventRow | null> {
  return await input.db
    .query<AgentControllerTaskLifecycleEventRow>({
      text: `
        SELECT *
        FROM "openmeld"."agent_controller_task_lifecycle_events"
        WHERE event_id = $1
        LIMIT 1
      `,
      values: [requireNonEmpty(input.eventId, "eventId")],
    })
    .then((result) => result.rows[0] ?? null);
}
function parseRegisteredTaskRow(
  row: RegisteredAgentControllerTaskRow
): RegisteredAgentControllerTask {
  const task = agentTaskHandleSchema.parse(parseJson(row.task_handle_json));
  if (
    task.kind !== "controller_task" ||
    row.task_key !== buildAgentTaskKey(task) ||
    row.host_id !== task.hostId ||
    row.agent_controller_ref !== task.agentControllerRef ||
    row.task_id !== task.taskId
  ) {
    throw new Error(
      "Agent Controller task registration storage is inconsistent"
    );
  }
  return {
    agentControllerRef: task.agentControllerRef,
    hostId: task.hostId,
    occurredAtMs: requireTimestamp(row.occurred_at_ms, "occurredAtMs"),
    organizationId: requireNonEmpty(row.organization_id, "organizationId"),
    ownerUserId: requireNonEmpty(row.owner_user_id, "ownerUserId"),
    registrationEventId: requireNonEmpty(
      row.registration_event_id,
      "registrationEventId"
    ),
    registrationSource: row.registration_source,
    task,
    taskId: task.taskId,
    updatedAtMs: requireTimestamp(row.updated_at_ms, "updatedAtMs"),
    openMeldServiceRuntimeId: requireNonEmpty(
      row.openmeld_service_runtime_id,
      "openMeldServiceRuntimeId"
    ),
  };
}
function requireNonEmpty(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`Agent Controller task lifecycle ${field} is required`);
  }
  return normalized;
}
function requireTimestamp(value: unknown, field: string): number {
  const timestamp = Number(value);
  if (!(Number.isInteger(timestamp) && timestamp >= 0)) {
    throw new Error(
      `Agent Controller task lifecycle ${field} must be a nonnegative integer`
    );
  }
  return timestamp;
}
function normalizeNullableTimestamp(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : requireTimestamp(value, "processedAtMs");
}
function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}
function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
