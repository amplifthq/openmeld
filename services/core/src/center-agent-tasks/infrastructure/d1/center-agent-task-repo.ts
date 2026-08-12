import {
  agentTaskHandleSchema,
  buildAgentTaskKey,
  centerAgentTaskAttemptSchema,
  centerAgentTaskEventSchema,
  centerAgentTaskSchema,
  isCenterAgentTaskTerminalStatus,
} from "@openmeld/schemas";
import type {
  AgentTaskHandle,
  CenterAgentTask,
  CenterAgentTaskAttempt,
  CenterAgentTaskEvent,
  CenterAgentTaskEventActor,
  CenterAgentTaskEventKind,
  CenterAgentTaskOrigin,
  CenterAgentTaskStatus,
} from "@openmeld/schemas/types";

type TaskRow = {
  active_attempt_generation: number | null;
  created_at_ms: number;
  finished_at_ms: number | null;
  goal: string;
  id: string;
  idempotency_key: string;
  organization_id: string;
  origin_destination_json: string | null;
  origin_attribution_json: string | null;
  origin_kind: string;
  requester_user_id: string | null;
  status: string;
  title: string;
  updated_at_ms: number;
  version: number;
};

type AttemptRow = {
  created_at_ms: number;
  failure_code: string | null;
  finished_at_ms: number | null;
  generation: number;
  id: string;
  idempotency_key: string;
  organization_id: string;
  started_at_ms: number | null;
  status: string;
  task_handle_json: string;
  task_id: string;
  updated_at_ms: number;
};

type EventRow = {
  actor: string;
  attempt_generation: number | null;
  id: string;
  idempotency_key: string;
  kind: string;
  observed_at_ms: number;
  occurred_at_ms: number;
  organization_id: string;
  task_id: string;
  text: string;
};

type AdmissionOutboxRow = {
  attempt_count: number;
  attempt_generation: number;
  created_at_ms: number;
  delivery_id: string;
  instruction: string;
  last_attempt_at_ms: number | null;
  last_failure_code: string | null;
  operation_idempotency_key: string;
  organization_id: string;
  parent_id: string;
  parent_kind: "delivery" | "submission";
  requester_user_id: string;
  state: "delivered" | "failed" | "pending";
  task_event_id: string;
  task_id: string;
  updated_at_ms: number;
};

export type CenterAgentTaskAdmissionOutboxRecord = {
  attemptCount: number;
  attemptGeneration: number;
  createdAtMs: number;
  deliveryId: string;
  instruction: string;
  lastAttemptAtMs: number | null;
  lastFailureCode: string | null;
  operationIdempotencyKey: string;
  organizationId: string;
  parent:
    | { deliveryId: string; kind: "delivery" }
    | { kind: "submission"; submissionId: string };
  requesterUserId: string;
  state: "delivered" | "failed" | "pending";
  taskEventId: string;
  taskId: string;
  updatedAtMs: number;
};

export type CenterAgentTaskStoppingAttemptRecord = {
  allowAlreadyTerminal: boolean;
  attemptGeneration: number;
  deliveryId: string;
  organizationId: string;
  requesterUserId: string;
  stopRequestedAtMs: number;
  taskId: string;
  taskVersion: number;
};

type StoredEvent = {
  event: CenterAgentTaskEvent;
  idempotencyKey: string;
  observedAtMs: number;
  organizationId: string;
};

const TASK_SELECT_COLUMNS = `
  id,
  organization_id,
  requester_user_id,
  idempotency_key,
  title,
  goal,
  origin_kind,
  origin_destination_json,
  origin_attribution_json,
  status,
  active_attempt_generation,
  version,
  created_at_ms,
  updated_at_ms,
  finished_at_ms
`;

const ATTEMPT_SELECT_COLUMNS = `
  id,
  task_id,
  organization_id,
  idempotency_key,
  generation,
  task_handle_json,
  status,
  failure_code,
  created_at_ms,
  started_at_ms,
  finished_at_ms,
  updated_at_ms
`;

const EVENT_SELECT_COLUMNS = `
  id,
  task_id,
  organization_id,
  idempotency_key,
  attempt_generation,
  kind,
  actor,
  text,
  occurred_at_ms,
  observed_at_ms
`;

const ADMISSION_OUTBOX_SELECT_COLUMNS = `
  task_id,
  organization_id,
  attempt_generation,
  delivery_id,
  operation_idempotency_key,
  task_event_id,
  requester_user_id,
  instruction,
  parent_kind,
  parent_id,
  state,
  attempt_count,
  last_attempt_at_ms,
  last_failure_code,
  created_at_ms,
  updated_at_ms
`;

export class CenterAgentTaskConflictError extends Error {
  readonly code = "center_agent_task_conflict" as const;

  constructor(message: string) {
    super(message);
    this.name = "CenterAgentTaskConflictError";
  }
}

export class CenterAgentTaskEventConflictError extends Error {
  readonly code = "center_agent_task_event_conflict" as const;

  constructor(message: string) {
    super(message);
    this.name = "CenterAgentTaskEventConflictError";
  }
}

export class CenterAgentTaskAttemptConflictError extends Error {
  readonly code = "center_agent_task_attempt_conflict" as const;

  constructor(message: string) {
    super(message);
    this.name = "CenterAgentTaskAttemptConflictError";
  }
}

export class CenterAgentTaskVersionConflictError extends Error {
  readonly code = "center_agent_task_version_conflict" as const;
  readonly actualVersion: number;
  readonly expectedVersion: number;

  constructor(input: { actualVersion: number; expectedVersion: number }) {
    super(
      `Center Agent Task version conflict: expected ${input.expectedVersion}, found ${input.actualVersion}.`
    );
    this.name = "CenterAgentTaskVersionConflictError";
    this.actualVersion = input.actualVersion;
    this.expectedVersion = input.expectedVersion;
  }
}

export class CenterAgentTaskNotFoundError extends Error {
  readonly code = "center_agent_task_not_found" as const;

  constructor(taskId: string) {
    super(`Center Agent Task ${taskId} was not found.`);
    this.name = "CenterAgentTaskNotFoundError";
  }
}

export async function createCenterAgentTask(input: {
  db: D1Database;
  goal: string;
  idempotencyKey: string;
  nowMs: number;
  organizationId: string;
  origin: CenterAgentTaskOrigin;
  requesterUserId: string | null;
  taskId: string;
  title: string;
}): Promise<
  | { outcome: "created"; task: CenterAgentTask }
  | { outcome: "replay"; task: CenterAgentTask }
> {
  const nowMs = parseTimestampMs(input.nowMs, "nowMs");
  const idempotencyKey = parseRequiredText(
    input.idempotencyKey,
    "idempotencyKey"
  );
  const candidate = centerAgentTaskSchema.parse({
    activeAttemptGeneration: null,
    createdAt: toIsoDateTime(nowMs),
    finishedAt: null,
    goal: input.goal,
    id: input.taskId,
    organizationId: input.organizationId,
    origin: input.origin,
    requesterUserId: input.requesterUserId,
    status: "queued",
    title: input.title,
    updatedAt: toIsoDateTime(nowMs),
    version: 1,
  });
  const originDestinationJson =
    candidate.origin.kind === "message_channel"
      ? JSON.stringify(candidate.origin.destination)
      : null;
  const originAttributionJson = serializeTaskOriginAttribution(
    candidate.origin
  );
  const inserted = await input.db
    .prepare(
      `
        INSERT OR IGNORE INTO center_agent_tasks (
          id,
          organization_id,
          requester_user_id,
          idempotency_key,
          title,
          goal,
          origin_kind,
          origin_destination_json,
          origin_attribution_json,
          status,
          active_attempt_generation,
          version,
          created_at_ms,
          updated_at_ms,
          finished_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, 1, ?, ?, NULL)
      `
    )
    .bind(
      candidate.id,
      candidate.organizationId,
      candidate.requesterUserId,
      idempotencyKey,
      candidate.title,
      candidate.goal,
      candidate.origin.kind,
      originDestinationJson,
      originAttributionJson,
      nowMs,
      nowMs
    )
    .run();

  if (changedExactlyOneRow(inserted)) {
    return { outcome: "created", task: candidate };
  }
  const existing = await readTaskByIdempotencyKey({
    db: input.db,
    idempotencyKey,
    organizationId: candidate.organizationId,
    requesterUserId: candidate.requesterUserId,
  });
  if (!(existing && isSameTaskCreation(existing, candidate))) {
    throw new CenterAgentTaskConflictError(
      "The task id or idempotency key is already bound to different task data."
    );
  }
  return { outcome: "replay", task: existing };
}

export async function createCenterAgentTaskWithInitialAttempt(input: {
  admission: {
    deliveryId: string;
    instruction: string;
    operationIdempotencyKey: string;
    parent:
      | { deliveryId: string; kind: "delivery" }
      | { kind: "submission"; submissionId: string };
    requesterUserId: string;
    taskEventId: string;
  };
  attemptId: string;
  attemptIdempotencyKey: string;
  db: D1Database;
  event: CenterAgentTaskAttemptEventInput;
  goal: string;
  nowMs: number;
  organizationId: string;
  origin: CenterAgentTaskOrigin;
  requesterUserId: string;
  taskHandle: AgentTaskHandle;
  taskId: string;
  taskIdempotencyKey: string;
  title: string;
}): Promise<{
  attempt: CenterAgentTaskAttempt;
  event: CenterAgentTaskEvent;
  outcome: "created" | "replay";
  task: CenterAgentTask;
}> {
  const nowMs = parseTimestampMs(input.nowMs, "nowMs");
  const taskIdempotencyKey = parseRequiredText(
    input.taskIdempotencyKey,
    "taskIdempotencyKey"
  );
  const attemptIdempotencyKey = parseRequiredText(
    input.attemptIdempotencyKey,
    "attemptIdempotencyKey"
  );
  const taskHandle = agentTaskHandleSchema.parse(input.taskHandle);
  const candidateTask = centerAgentTaskSchema.parse({
    activeAttemptGeneration: null,
    createdAt: toIsoDateTime(nowMs),
    finishedAt: null,
    goal: input.goal,
    id: input.taskId,
    organizationId: input.organizationId,
    origin: input.origin,
    requesterUserId: input.requesterUserId,
    status: "queued",
    title: input.title,
    updatedAt: toIsoDateTime(nowMs),
    version: 1,
  });
  const candidateAttempt = centerAgentTaskAttemptSchema.parse({
    createdAt: toIsoDateTime(nowMs),
    failureCode: null,
    finishedAt: null,
    generation: 1,
    id: input.attemptId,
    startedAt: null,
    status: "queued",
    taskHandle,
    taskId: input.taskId,
  });
  const preparedEvent = prepareAttemptStartEvent(input, input.event);
  const admission = prepareCenterAgentTaskAdmissionOutbox({
    admission: input.admission,
    attemptGeneration: 1,
    nowMs,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
  const replay = await readInitialCenterAgentTaskReplay({
    admission,
    attemptId: input.attemptId,
    attemptIdempotencyKey,
    candidateTask,
    db: input.db,
    preparedEvent,
    taskHandle,
    taskIdempotencyKey,
  });
  if (replay) {
    return replay;
  }
  const startInput: CenterAgentTaskAttemptStartInput = {
    admission: input.admission,
    attemptId: input.attemptId,
    db: input.db,
    event: input.event,
    expectedTaskVersion: 1,
    idempotencyKey: attemptIdempotencyKey,
    nowMs,
    organizationId: input.organizationId,
    taskHandle,
    taskId: input.taskId,
  };
  const preparedStart: PreparedCenterAgentTaskAttemptStart = {
    admission,
    candidateAttempt,
    existingEvent: null,
    idempotencyKey: attemptIdempotencyKey,
    nowMs,
    preparedEvent,
    replacedAttemptGeneration: null,
    taskHandle,
  };
  const originDestinationJson =
    candidateTask.origin.kind === "message_channel"
      ? JSON.stringify(candidateTask.origin.destination)
      : null;
  const originAttributionJson = serializeTaskOriginAttribution(
    candidateTask.origin
  );
  try {
    const results = await input.db.batch([
      input.db
        .prepare(
          `
            INSERT INTO center_agent_tasks (
              id,
              organization_id,
              requester_user_id,
              idempotency_key,
              title,
              goal,
              origin_kind,
              origin_destination_json,
              origin_attribution_json,
              status,
              active_attempt_generation,
              version,
              created_at_ms,
              updated_at_ms,
              finished_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, 1, ?, ?, NULL)
          `
        )
        .bind(
          candidateTask.id,
          candidateTask.organizationId,
          candidateTask.requesterUserId,
          taskIdempotencyKey,
          candidateTask.title,
          candidateTask.goal,
          candidateTask.origin.kind,
          originDestinationJson,
          originAttributionJson,
          nowMs,
          nowMs
        ),
      ...buildCenterAgentTaskAttemptStartStatements(startInput, preparedStart),
    ]);
    if (results.some((result) => !changedExactlyOneRow(result))) {
      throw new CenterAgentTaskConflictError(
        "The initial Task transaction did not commit every required row."
      );
    }
  } catch (error) {
    const accepted = await readInitialCenterAgentTaskReplay({
      admission,
      attemptId: input.attemptId,
      attemptIdempotencyKey,
      candidateTask,
      db: input.db,
      preparedEvent,
      taskHandle,
      taskIdempotencyKey,
    });
    if (accepted) {
      return accepted;
    }
    throw error;
  }
  return {
    attempt: candidateAttempt,
    event: preparedEvent.event,
    outcome: "created",
    task: await requireTask(input),
  };
}

export async function readCenterAgentTask(input: {
  db: D1Database;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTask | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${TASK_SELECT_COLUMNS}
        FROM center_agent_tasks
        WHERE id = ? AND organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.taskId, input.organizationId)
    .first<TaskRow>();
  return row ? mapTaskRow(row) : null;
}

export async function claimCenterAgentTaskMutation(input: {
  db: D1Database;
  expectedTaskVersion: number;
  nowMs: number;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTask> {
  const nowMs = parseTimestampMs(input.nowMs, "nowMs");
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_tasks
        SET
          version = version + 1,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE id = ?
          AND organization_id = ?
          AND version = ?
      `
    )
    .bind(nowMs, input.taskId, input.organizationId, input.expectedTaskVersion)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    const current = await requireTask(input);
    throw new CenterAgentTaskVersionConflictError({
      actualVersion: current.version,
      expectedVersion: input.expectedTaskVersion,
    });
  }
  return await requireTask(input);
}

export async function listCenterAgentTasksByRequesterUserId(input: {
  cursor?: { id: string; updatedAtMs: number };
  db: D1Database;
  limit: number;
  organizationId: string;
  requesterUserId: string;
  status?: CenterAgentTaskStatus;
}): Promise<CenterAgentTask[]> {
  const requesterUserId = parseRequiredText(
    input.requesterUserId,
    "requesterUserId"
  );
  const limit = parseListLimit(input.limit);
  const filters = ["organization_id = ?", "requester_user_id = ?"];
  const bindings: Array<number | string> = [
    input.organizationId,
    requesterUserId,
  ];
  if (input.status) {
    filters.push("status = ?");
    bindings.push(input.status);
  }
  if (input.cursor) {
    filters.push("(updated_at_ms < ? OR (updated_at_ms = ? AND id < ?))");
    bindings.push(
      input.cursor.updatedAtMs,
      input.cursor.updatedAtMs,
      input.cursor.id
    );
  }
  bindings.push(limit);
  const result = await input.db
    .prepare(
      `
        SELECT ${TASK_SELECT_COLUMNS}
        FROM center_agent_tasks
        WHERE ${filters.join(" AND ")}
        ORDER BY updated_at_ms DESC, id DESC
        LIMIT ?
      `
    )
    .bind(...bindings)
    .all<TaskRow>();
  return result.results.map(mapTaskRow);
}

export async function appendCenterAgentTaskEvent(input: {
  actor: CenterAgentTaskEventActor;
  attemptGeneration: number | null;
  db: D1Database;
  eventId: string;
  expectedTaskVersion: number;
  idempotencyKey: string;
  kind: CenterAgentTaskEventKind;
  observedAtMs: number;
  occurredAtMs: number;
  organizationId: string;
  taskId: string;
  text: string;
}): Promise<
  | { event: CenterAgentTaskEvent; outcome: "appended" }
  | { event: CenterAgentTaskEvent; outcome: "replay" }
> {
  const occurredAtMs = parseTimestampMs(input.occurredAtMs, "occurredAtMs");
  const observedAtMs = parseTimestampMs(input.observedAtMs, "observedAtMs");
  const idempotencyKey = parseRequiredText(
    input.idempotencyKey,
    "idempotencyKey"
  );
  const candidate = centerAgentTaskEventSchema.parse({
    actor: input.actor,
    attemptGeneration: input.attemptGeneration,
    id: input.eventId,
    kind: input.kind,
    occurredAt: toIsoDateTime(occurredAtMs),
    taskId: input.taskId,
    text: input.text,
  });
  if (observedAtMs < occurredAtMs) {
    throw new RangeError("observedAtMs must not be before occurredAtMs.");
  }

  const existing = await readEventByIdempotencyKey({
    db: input.db,
    idempotencyKey,
    taskId: candidate.taskId,
  });
  if (existing) {
    if (!isSameEvent(existing, candidate, input.organizationId, observedAtMs)) {
      throw new CenterAgentTaskEventConflictError(
        "The event idempotency key is already bound to different event data."
      );
    }
    return { event: existing.event, outcome: "replay" };
  }

  const task = await requireTask(input);
  requireExpectedVersion(task, input.expectedTaskVersion);
  if (candidate.attemptGeneration !== null) {
    await requireAttemptGeneration({
      db: input.db,
      generation: candidate.attemptGeneration,
      organizationId: input.organizationId,
      taskId: input.taskId,
    });
  }

  try {
    const [insert, bump] = await input.db.batch([
      input.db
        .prepare(
          `
            INSERT INTO center_agent_task_events (
              id,
              task_id,
              organization_id,
              idempotency_key,
              attempt_generation,
              kind,
              actor,
              text,
              occurred_at_ms,
              observed_at_ms
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            FROM center_agent_tasks
            WHERE id = ? AND organization_id = ? AND version = ?
          `
        )
        .bind(
          candidate.id,
          candidate.taskId,
          input.organizationId,
          idempotencyKey,
          candidate.attemptGeneration,
          candidate.kind,
          candidate.actor,
          candidate.text,
          occurredAtMs,
          observedAtMs,
          input.taskId,
          input.organizationId,
          input.expectedTaskVersion
        ),
      input.db
        .prepare(
          `
            UPDATE center_agent_tasks
            SET version = version + 1, updated_at_ms = max(updated_at_ms, ?)
            WHERE id = ?
              AND organization_id = ?
              AND version = ?
              AND EXISTS (
                SELECT 1
                FROM center_agent_task_events
                WHERE id = ?
                  AND task_id = ?
                  AND organization_id = ?
                  AND idempotency_key = ?
              )
          `
        )
        .bind(
          observedAtMs,
          input.taskId,
          input.organizationId,
          input.expectedTaskVersion,
          candidate.id,
          candidate.taskId,
          input.organizationId,
          idempotencyKey
        ),
    ]);
    if (!(changedExactlyOneRow(insert) && changedExactlyOneRow(bump))) {
      const current = await requireTask(input);
      throw new CenterAgentTaskVersionConflictError({
        actualVersion: current.version,
        expectedVersion: input.expectedTaskVersion,
      });
    }
  } catch (error) {
    if (error instanceof CenterAgentTaskVersionConflictError) {
      throw error;
    }
    const conflicting = await readEventByIdOrIdempotencyKey({
      db: input.db,
      eventId: candidate.id,
      idempotencyKey,
      taskId: candidate.taskId,
    });
    if (conflicting) {
      throw new CenterAgentTaskEventConflictError(
        "The event id or idempotency key is already bound to different event data."
      );
    }
    throw error;
  }
  return { event: candidate, outcome: "appended" };
}

type CenterAgentTaskAttemptEventInput = {
  actor: CenterAgentTaskEventActor;
  attemptGeneration: number | null;
  eventId: string;
  idempotencyKey: string;
  kind: CenterAgentTaskEventKind;
  observedAtMs: number;
  occurredAtMs: number;
  text: string;
};

export async function projectCenterAgentTaskAttemptEvent(input: {
  db: D1Database;
  event: CenterAgentTaskAttemptEventInput;
  expectedTaskVersion: number;
  failureCode: string | null;
  generation: number;
  nowMs: number;
  organizationId: string;
  status: Exclude<CenterAgentTaskStatus, "queued" | "running" | "stopping">;
  taskId: string;
}): Promise<{
  attempt: CenterAgentTaskAttempt;
  event: CenterAgentTaskEvent;
  outcome: "projected" | "replay" | "stale_generation" | "terminal_conflict";
  task: CenterAgentTask;
}> {
  const nowMs = parseTimestampMs(input.nowMs, "nowMs");
  const occurredAtMs = parseTimestampMs(
    input.event.occurredAtMs,
    "event.occurredAtMs"
  );
  const observedAtMs = parseTimestampMs(
    input.event.observedAtMs,
    "event.observedAtMs"
  );
  if (observedAtMs < occurredAtMs) {
    throw new RangeError(
      "event.observedAtMs must not be before event.occurredAtMs."
    );
  }
  const eventIdempotencyKey = parseRequiredText(
    input.event.idempotencyKey,
    "event.idempotencyKey"
  );
  const candidateEvent = centerAgentTaskEventSchema.parse({
    actor: input.event.actor,
    attemptGeneration: input.event.attemptGeneration,
    id: input.event.eventId,
    kind: input.event.kind,
    occurredAt: toIsoDateTime(occurredAtMs),
    taskId: input.taskId,
    text: input.event.text,
  });
  if (candidateEvent.attemptGeneration !== input.generation) {
    throw new TypeError(
      "The projected Task event must belong to the projected attempt generation."
    );
  }
  if (input.status === "failed") {
    parseRequiredText(input.failureCode ?? "", "failureCode");
  } else if (input.failureCode !== null) {
    throw new TypeError("failureCode is only valid for failed attempts.");
  }

  const existingEvent = await readEventByIdempotencyKey({
    db: input.db,
    idempotencyKey: eventIdempotencyKey,
    taskId: input.taskId,
  });
  if (existingEvent) {
    if (
      !isSameProjectedAttemptEvent(
        existingEvent,
        candidateEvent,
        input.organizationId
      )
    ) {
      throw new CenterAgentTaskEventConflictError(
        "The event idempotency key is already bound to different event data."
      );
    }
    return {
      attempt: await requireAttemptGeneration(input),
      event: existingEvent.event,
      outcome: "replay",
      task: await requireTask(input),
    };
  }

  const task = await requireTask(input);
  const attempt = await requireAttemptGeneration(input);
  if (task.activeAttemptGeneration !== input.generation) {
    return {
      attempt,
      event: candidateEvent,
      outcome: "stale_generation",
      task,
    };
  }
  if (
    isCenterAgentTaskTerminalStatus(attempt.status) &&
    (attempt.status !== input.status ||
      attempt.failureCode !== input.failureCode)
  ) {
    return {
      attempt,
      event: candidateEvent,
      outcome: "terminal_conflict",
      task,
    };
  }
  requireExpectedVersion(task, input.expectedTaskVersion);

  const startedAtMs =
    attempt.startedAt === null ? nowMs : Date.parse(attempt.startedAt);
  const terminal = isCenterAgentTaskTerminalStatus(input.status);
  const finishedAtMs = terminal ? nowMs : null;
  const [eventInsert, attemptUpdate, taskUpdate] = await input.db.batch([
    input.db
      .prepare(
        `
          INSERT INTO center_agent_task_events (
            id,
            task_id,
            organization_id,
            idempotency_key,
            attempt_generation,
            kind,
            actor,
            text,
            occurred_at_ms,
            observed_at_ms
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM center_agent_tasks
          WHERE id = ?
            AND organization_id = ?
            AND version = ?
            AND active_attempt_generation = ?
        `
      )
      .bind(
        candidateEvent.id,
        candidateEvent.taskId,
        input.organizationId,
        eventIdempotencyKey,
        candidateEvent.attemptGeneration,
        candidateEvent.kind,
        candidateEvent.actor,
        candidateEvent.text,
        occurredAtMs,
        observedAtMs,
        input.taskId,
        input.organizationId,
        input.expectedTaskVersion,
        input.generation
      ),
    input.db
      .prepare(
        `
          UPDATE center_agent_task_attempts
          SET
            status = ?,
            failure_code = ?,
            started_at_ms = ?,
            finished_at_ms = ?,
            updated_at_ms = max(updated_at_ms, ?)
          WHERE task_id = ?
            AND organization_id = ?
            AND generation = ?
            AND status IN ('queued', 'running', 'stopping', 'needs_attention', 'succeeded', 'failed', 'stopped')
            AND EXISTS (
              SELECT 1
              FROM center_agent_task_events
              WHERE id = ?
                AND task_id = ?
                AND organization_id = ?
                AND idempotency_key = ?
            )
        `
      )
      .bind(
        input.status,
        input.failureCode,
        startedAtMs,
        finishedAtMs,
        nowMs,
        input.taskId,
        input.organizationId,
        input.generation,
        candidateEvent.id,
        input.taskId,
        input.organizationId,
        eventIdempotencyKey
      ),
    input.db
      .prepare(
        `
          UPDATE center_agent_tasks
          SET
            status = ?,
            version = version + 1,
            updated_at_ms = max(updated_at_ms, ?),
            finished_at_ms = ?
          WHERE id = ?
            AND organization_id = ?
            AND version = ?
            AND active_attempt_generation = ?
            AND EXISTS (
              SELECT 1
              FROM center_agent_task_attempts
              WHERE task_id = ?
                AND organization_id = ?
                AND generation = ?
                AND status = ?
                AND failure_code IS ?
            )
            AND EXISTS (
              SELECT 1
              FROM center_agent_task_events
              WHERE id = ?
                AND task_id = ?
                AND organization_id = ?
                AND idempotency_key = ?
            )
        `
      )
      .bind(
        input.status,
        nowMs,
        finishedAtMs,
        input.taskId,
        input.organizationId,
        input.expectedTaskVersion,
        input.generation,
        input.taskId,
        input.organizationId,
        input.generation,
        input.status,
        input.failureCode,
        candidateEvent.id,
        input.taskId,
        input.organizationId,
        eventIdempotencyKey
      ),
  ]);
  if (
    !(
      changedExactlyOneRow(eventInsert) &&
      changedExactlyOneRow(attemptUpdate) &&
      changedExactlyOneRow(taskUpdate)
    )
  ) {
    const current = await requireTask(input);
    if (current.version !== input.expectedTaskVersion) {
      throw new CenterAgentTaskVersionConflictError({
        actualVersion: current.version,
        expectedVersion: input.expectedTaskVersion,
      });
    }
    throw new CenterAgentTaskAttemptConflictError(
      "The Task attempt event could not be projected from its current state."
    );
  }
  return {
    attempt: await requireAttemptGeneration(input),
    event: candidateEvent,
    outcome: "projected",
    task: await requireTask(input),
  };
}

type CenterAgentTaskStopRequestInput = {
  actor: CenterAgentTaskEventActor;
  attemptGeneration: number;
  db: D1Database;
  eventId: string;
  expectedTaskVersion: number;
  idempotencyKey: string;
  nowMs: number;
  organizationId: string;
  replacementInstruction?: {
    eventId: string;
    idempotencyKey: string;
    occurredAtMs: number;
    text: string;
  };
  taskId: string;
  text: string;
};

type CenterAgentTaskStopRequestResult = {
  attempt: CenterAgentTaskAttempt;
  event: CenterAgentTaskEvent;
  outcome: "replay" | "requested";
  replacementEvent?: CenterAgentTaskEvent;
  task: CenterAgentTask;
};

type PreparedCenterAgentTaskStopRequest = {
  candidate: CenterAgentTaskEvent;
  idempotencyKey: string;
  nowMs: number;
  replacementCandidate: CenterAgentTaskEvent | null;
  replacementIdempotencyKey: string | null;
  replacementOccurredAtMs: number | null;
};

export async function requestCenterAgentTaskStop(
  input: CenterAgentTaskStopRequestInput
): Promise<CenterAgentTaskStopRequestResult> {
  const prepared = prepareCenterAgentTaskStopRequest(input);
  const existing = await readCenterAgentTaskStopRequestReplay(input, prepared);
  if (existing) {
    return existing;
  }

  const attempt = await requireStopRequestableAttempt(input);
  const startedAtMs =
    attempt.startedAt === null ? prepared.nowMs : Date.parse(attempt.startedAt);

  try {
    await executeCenterAgentTaskStopRequest({
      input,
      prepared,
      startedAtMs,
    });
  } catch (error) {
    if (error instanceof CenterAgentTaskVersionConflictError) {
      throw error;
    }
    const replay = await readCenterAgentTaskStopRequestReplay(input, prepared);
    if (replay) {
      return replay;
    }
    throw error;
  }

  return {
    attempt: await requireAttemptGeneration({
      db: input.db,
      generation: input.attemptGeneration,
      organizationId: input.organizationId,
      taskId: input.taskId,
    }),
    event: prepared.candidate,
    outcome: "requested",
    ...(prepared.replacementCandidate
      ? { replacementEvent: prepared.replacementCandidate }
      : {}),
    task: await requireTask(input),
  };
}

function prepareCenterAgentTaskStopRequest(
  input: CenterAgentTaskStopRequestInput
): PreparedCenterAgentTaskStopRequest {
  const nowMs = parseTimestampMs(input.nowMs, "nowMs");
  const idempotencyKey = parseRequiredText(
    input.idempotencyKey,
    "idempotencyKey"
  );
  const candidate = centerAgentTaskEventSchema.parse({
    actor: input.actor,
    attemptGeneration: input.attemptGeneration,
    id: input.eventId,
    kind: "stop_requested",
    occurredAt: toIsoDateTime(nowMs),
    taskId: input.taskId,
    text: input.text,
  });
  const replacementInstruction = input.replacementInstruction;
  const replacementIdempotencyKey = replacementInstruction
    ? parseRequiredText(
        replacementInstruction.idempotencyKey,
        "replacementInstruction.idempotencyKey"
      )
    : null;
  const replacementOccurredAtMs = replacementInstruction
    ? parseTimestampMs(
        replacementInstruction.occurredAtMs,
        "replacementInstruction.occurredAtMs"
      )
    : null;
  if (replacementOccurredAtMs !== null && replacementOccurredAtMs < nowMs) {
    throw new RangeError(
      "replacementInstruction.occurredAtMs must not precede the Stop intent."
    );
  }
  const replacementCandidate = replacementInstruction
    ? centerAgentTaskEventSchema.parse({
        actor: "requester",
        attemptGeneration: null,
        id: replacementInstruction.eventId,
        kind: "requester_message",
        occurredAt: toIsoDateTime(replacementOccurredAtMs ?? nowMs),
        taskId: input.taskId,
        text: replacementInstruction.text,
      })
    : null;
  return {
    candidate,
    idempotencyKey,
    nowMs,
    replacementCandidate,
    replacementIdempotencyKey,
    replacementOccurredAtMs,
  };
}

async function readCenterAgentTaskStopRequestReplay(
  input: CenterAgentTaskStopRequestInput,
  prepared: PreparedCenterAgentTaskStopRequest
): Promise<CenterAgentTaskStopRequestResult | null> {
  const existing = await readEventByIdempotencyKey({
    db: input.db,
    idempotencyKey: prepared.idempotencyKey,
    taskId: input.taskId,
  });
  if (!existing) {
    return null;
  }
  assertSameStopIntent(existing, prepared.candidate, input.organizationId);
  const replacementEvent = prepared.replacementCandidate
    ? await requireReplacementInstructionReplay({
        candidate: prepared.replacementCandidate,
        db: input.db,
        idempotencyKey: prepared.replacementIdempotencyKey ?? "",
        organizationId: input.organizationId,
        taskId: input.taskId,
      })
    : undefined;
  return {
    attempt: await requireAttemptGeneration({
      db: input.db,
      generation: input.attemptGeneration,
      organizationId: input.organizationId,
      taskId: input.taskId,
    }),
    event: existing.event,
    outcome: "replay",
    ...(replacementEvent ? { replacementEvent } : {}),
    task: await requireTask(input),
  };
}

async function requireStopRequestableAttempt(
  input: CenterAgentTaskStopRequestInput
): Promise<CenterAgentTaskAttempt> {
  const task = await requireTask(input);
  requireExpectedVersion(task, input.expectedTaskVersion);
  if (
    task.activeAttemptGeneration !== input.attemptGeneration ||
    !isStopRequestableStatus(task.status)
  ) {
    throw new CenterAgentTaskConflictError(
      "The Task does not have an active attempt that can be stopped."
    );
  }
  const attempt = await requireAttemptGeneration({
    db: input.db,
    generation: input.attemptGeneration,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
  if (!isStopRequestableStatus(attempt.status)) {
    throw new CenterAgentTaskAttemptConflictError(
      "The active Task attempt cannot enter Stopping."
    );
  }
  return attempt;
}

async function executeCenterAgentTaskStopRequest(input: {
  input: CenterAgentTaskStopRequestInput;
  prepared: PreparedCenterAgentTaskStopRequest;
  startedAtMs: number;
}): Promise<void> {
  const { candidate, idempotencyKey, nowMs } = input.prepared;
  const request = input.input;
  const replacementCandidate = input.prepared.replacementCandidate;
  const replacementIdempotencyKey = input.prepared.replacementIdempotencyKey;
  const replacementOccurredAtMs = input.prepared.replacementOccurredAtMs;
  const statements = [
    request.db
      .prepare(
        `
            INSERT INTO center_agent_task_events (
              id,
              task_id,
              organization_id,
              idempotency_key,
              attempt_generation,
              kind,
              actor,
              text,
              occurred_at_ms,
              observed_at_ms
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            FROM center_agent_tasks AS task
            JOIN center_agent_task_attempts AS attempt
              ON attempt.task_id = task.id
              AND attempt.organization_id = task.organization_id
              AND attempt.generation = task.active_attempt_generation
            WHERE task.id = ?
              AND task.organization_id = ?
              AND task.version = ?
              AND task.active_attempt_generation = ?
              AND task.status IN ('queued', 'running', 'needs_attention')
              AND attempt.status IN ('queued', 'running', 'needs_attention')
          `
      )
      .bind(
        candidate.id,
        candidate.taskId,
        request.organizationId,
        idempotencyKey,
        candidate.attemptGeneration,
        candidate.kind,
        candidate.actor,
        candidate.text,
        nowMs,
        nowMs,
        request.taskId,
        request.organizationId,
        request.expectedTaskVersion,
        request.attemptGeneration
      ),
  ];
  if (replacementCandidate) {
    statements.push(
      request.db
        .prepare(
          `
              INSERT INTO center_agent_task_events (
                id,
                task_id,
                organization_id,
                idempotency_key,
                attempt_generation,
                kind,
                actor,
                text,
                occurred_at_ms,
                observed_at_ms
              )
              SELECT ?, ?, ?, ?, NULL, 'requester_message', 'requester', ?, ?, ?
              FROM center_agent_tasks AS task
              JOIN center_agent_task_attempts AS attempt
                ON attempt.task_id = task.id
                AND attempt.organization_id = task.organization_id
                AND attempt.generation = task.active_attempt_generation
              WHERE task.id = ?
                AND task.organization_id = ?
                AND task.version = ?
                AND task.active_attempt_generation = ?
                AND task.status IN ('queued', 'running', 'needs_attention')
                AND attempt.status IN ('queued', 'running', 'needs_attention')
                AND EXISTS (
                  SELECT 1
                  FROM center_agent_task_events
                  WHERE id = ?
                    AND task_id = ?
                    AND organization_id = ?
                    AND kind = 'stop_requested'
                )
            `
        )
        .bind(
          replacementCandidate.id,
          replacementCandidate.taskId,
          request.organizationId,
          replacementIdempotencyKey,
          replacementCandidate.text,
          replacementOccurredAtMs,
          replacementOccurredAtMs,
          request.taskId,
          request.organizationId,
          request.expectedTaskVersion,
          request.attemptGeneration,
          candidate.id,
          request.taskId,
          request.organizationId
        )
    );
  }
  statements.push(
    request.db
      .prepare(
        `
            UPDATE center_agent_task_attempts
            SET
              status = 'stopping',
              started_at_ms = ?,
              finished_at_ms = NULL,
              updated_at_ms = max(updated_at_ms, ?)
            WHERE task_id = ?
              AND organization_id = ?
              AND generation = ?
              AND status IN ('queued', 'running', 'needs_attention')
              AND EXISTS (
                SELECT 1
                FROM center_agent_task_events
                WHERE id = ?
                  AND task_id = ?
                  AND organization_id = ?
                  AND kind = 'stop_requested'
              )
          `
      )
      .bind(
        input.startedAtMs,
        nowMs,
        request.taskId,
        request.organizationId,
        request.attemptGeneration,
        candidate.id,
        request.taskId,
        request.organizationId
      ),
    request.db
      .prepare(
        `
            UPDATE center_agent_tasks
            SET
              status = 'stopping',
              version = version + ?,
              updated_at_ms = max(updated_at_ms, ?),
              finished_at_ms = NULL
            WHERE id = ?
              AND organization_id = ?
              AND version = ?
              AND active_attempt_generation = ?
              AND status IN ('queued', 'running', 'needs_attention')
              AND EXISTS (
                SELECT 1
                FROM center_agent_task_attempts
                WHERE task_id = ?
                  AND organization_id = ?
                  AND generation = ?
                  AND status = 'stopping'
              )
              AND EXISTS (
                SELECT 1
                FROM center_agent_task_events
                WHERE id = ?
                  AND task_id = ?
                  AND organization_id = ?
                  AND kind = 'stop_requested'
              )
              ${
                replacementCandidate
                  ? `AND EXISTS (
                      SELECT 1
                      FROM center_agent_task_events
                      WHERE id = ?
                        AND task_id = ?
                        AND organization_id = ?
                        AND kind = 'requester_message'
                    )`
                  : ""
              }
          `
      )
      .bind(
        replacementCandidate ? 2 : 1,
        replacementOccurredAtMs ?? nowMs,
        request.taskId,
        request.organizationId,
        request.expectedTaskVersion,
        request.attemptGeneration,
        request.taskId,
        request.organizationId,
        request.attemptGeneration,
        candidate.id,
        request.taskId,
        request.organizationId,
        ...(replacementCandidate
          ? [replacementCandidate.id, request.taskId, request.organizationId]
          : [])
      )
  );
  const results = await request.db.batch(statements);
  const stopInsert = results[0];
  const replacementInsert = replacementCandidate ? results[1] : undefined;
  const attemptUpdate = results[replacementCandidate ? 2 : 1];
  const taskUpdate = results[replacementCandidate ? 3 : 2];
  if (
    changedExactlyOneRow(stopInsert) &&
    (!replacementCandidate || changedExactlyOneRow(replacementInsert)) &&
    changedExactlyOneRow(attemptUpdate) &&
    changedExactlyOneRow(taskUpdate)
  ) {
    return;
  }
  const current = await requireTask(request);
  throw new CenterAgentTaskVersionConflictError({
    actualVersion: current.version,
    expectedVersion: request.expectedTaskVersion,
  });
}

export async function readActiveCenterAgentTaskStopIntentByDeliveryId(input: {
  db: D1Database;
  deliveryId: string;
}): Promise<{
  attemptGeneration: number;
  eventId: string;
  taskId: string;
} | null> {
  const taskKey = buildAgentTaskKey({
    deliveryId: parseRequiredText(input.deliveryId, "deliveryId"),
    kind: "native_delivery",
    v: 1,
  });
  const row = await input.db
    .prepare(
      `
        SELECT
          event.id AS event_id,
          task.id AS task_id,
          attempt.generation AS attempt_generation
        FROM center_agent_task_attempts AS attempt
        JOIN center_agent_tasks AS task
          ON task.id = attempt.task_id
          AND task.organization_id = attempt.organization_id
          AND task.active_attempt_generation = attempt.generation
        JOIN center_agent_task_events AS event
          ON event.task_id = task.id
          AND event.organization_id = task.organization_id
          AND event.attempt_generation = attempt.generation
          AND event.kind = 'stop_requested'
        WHERE attempt.execution_task_key = ?
          AND attempt.status IN ('stopping', 'needs_attention')
          AND task.status IN ('stopping', 'needs_attention')
        ORDER BY event.observed_at_ms DESC, event.id DESC
        LIMIT 1
      `
    )
    .bind(taskKey)
    .first<{
      attempt_generation: number;
      event_id: string;
      task_id: string;
    }>();
  return row
    ? {
        attemptGeneration: Number(row.attempt_generation),
        eventId: row.event_id,
        taskId: row.task_id,
      }
    : null;
}

const CENTER_AGENT_TASK_REPLACEMENT_STOP_IDEMPOTENCY_PREFIX =
  "center-agent-task-replacement-stop:";

export function buildCenterAgentTaskReplacementStopIdempotencyKey(
  replacementEventId: string
): string {
  return `${CENTER_AGENT_TASK_REPLACEMENT_STOP_IDEMPOTENCY_PREFIX}${parseRequiredText(
    replacementEventId,
    "replacementEventId"
  )}`;
}

export async function readCenterAgentTaskPendingReplacement(input: {
  db: D1Database;
  deliveryId: string;
  organizationId: string;
  taskId: string;
}): Promise<{
  event: CenterAgentTaskEvent;
  operationIdempotencyKey: string;
  requesterUserId: string;
} | null> {
  const taskKey = buildAgentTaskKey({
    deliveryId: parseRequiredText(input.deliveryId, "deliveryId"),
    kind: "native_delivery",
    v: 1,
  });
  const row = await input.db
    .prepare(
      `
        SELECT
          replacement.id,
          replacement.task_id,
          replacement.organization_id,
          replacement.idempotency_key,
          replacement.attempt_generation,
          replacement.kind,
          replacement.actor,
          replacement.text,
          replacement.occurred_at_ms,
          replacement.observed_at_ms,
          task.requester_user_id
        FROM center_agent_task_attempts AS attempt
        JOIN center_agent_tasks AS task
          ON task.id = attempt.task_id
          AND task.organization_id = attempt.organization_id
          AND task.active_attempt_generation = attempt.generation
        JOIN center_agent_task_events AS stop_event
          ON stop_event.task_id = task.id
          AND stop_event.organization_id = task.organization_id
          AND stop_event.attempt_generation = attempt.generation
          AND stop_event.kind = 'stop_requested'
        JOIN center_agent_task_events AS replacement
          ON replacement.task_id = task.id
          AND replacement.organization_id = task.organization_id
          AND replacement.id = substr(stop_event.idempotency_key, ?)
          AND replacement.attempt_generation IS NULL
          AND replacement.kind = 'requester_message'
        WHERE attempt.execution_task_key = ?
          AND attempt.status = 'stopped'
          AND task.status = 'stopped'
          AND task.id = ?
          AND task.organization_id = ?
          AND task.requester_user_id IS NOT NULL
          AND stop_event.idempotency_key LIKE ?
        ORDER BY
          stop_event.observed_at_ms DESC,
          stop_event.id DESC
        LIMIT 1
      `
    )
    .bind(
      CENTER_AGENT_TASK_REPLACEMENT_STOP_IDEMPOTENCY_PREFIX.length + 1,
      taskKey,
      input.taskId,
      input.organizationId,
      `${CENTER_AGENT_TASK_REPLACEMENT_STOP_IDEMPOTENCY_PREFIX}%`
    )
    .first<EventRow & { requester_user_id: string }>();
  if (!row) {
    return null;
  }
  const stored = mapStoredEventRow(row);
  return {
    event: stored.event,
    operationIdempotencyKey: stored.idempotencyKey,
    requesterUserId: row.requester_user_id,
  };
}

export async function listCenterAgentTaskEvents(input: {
  db: D1Database;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTaskEvent[]> {
  const result = await input.db
    .prepare(
      `
        SELECT ${EVENT_SELECT_COLUMNS}
        FROM center_agent_task_events
        WHERE task_id = ? AND organization_id = ?
        ORDER BY occurred_at_ms ASC, observed_at_ms ASC, id ASC
      `
    )
    .bind(input.taskId, input.organizationId)
    .all<EventRow>();
  return result.results.map((row) => mapStoredEventRow(row).event);
}

export async function listCenterAgentTaskEventsBefore(input: {
  beforeEventId: string;
  db: D1Database;
  limit: number;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTaskEvent[] | null> {
  const result = await input.db
    .prepare(
      `
        WITH anchor AS (
          SELECT occurred_at_ms, observed_at_ms, id
          FROM center_agent_task_events
          WHERE id = ? AND task_id = ? AND organization_id = ?
          LIMIT 1
        )
        SELECT
          event.id,
          event.task_id,
          event.organization_id,
          event.idempotency_key,
          event.attempt_generation,
          event.kind,
          event.actor,
          event.text,
          event.occurred_at_ms,
          event.observed_at_ms
        FROM center_agent_task_events AS event
        CROSS JOIN anchor
        WHERE event.task_id = ?
          AND event.organization_id = ?
          AND (
            event.occurred_at_ms < anchor.occurred_at_ms
            OR (
              event.occurred_at_ms = anchor.occurred_at_ms
              AND event.observed_at_ms < anchor.observed_at_ms
            )
            OR (
              event.occurred_at_ms = anchor.occurred_at_ms
              AND event.observed_at_ms = anchor.observed_at_ms
              AND event.id < anchor.id
            )
          )
        ORDER BY
          event.occurred_at_ms DESC,
          event.observed_at_ms DESC,
          event.id DESC
        LIMIT ?
      `
    )
    .bind(
      input.beforeEventId,
      input.taskId,
      input.organizationId,
      input.taskId,
      input.organizationId,
      input.limit
    )
    .all<EventRow>();
  if (result.results.length === 0) {
    const anchor = await input.db
      .prepare(
        `
          SELECT 1 AS found
          FROM center_agent_task_events
          WHERE id = ? AND task_id = ? AND organization_id = ?
          LIMIT 1
        `
      )
      .bind(input.beforeEventId, input.taskId, input.organizationId)
      .first<{ found: number }>();
    if (!anchor) {
      return null;
    }
  }
  return result.results.toReversed().map((row) => mapStoredEventRow(row).event);
}

export async function createCenterAgentTaskAttempt(input: {
  attemptId: string;
  db: D1Database;
  expectedTaskVersion: number;
  idempotencyKey: string;
  nowMs: number;
  organizationId: string;
  taskHandle: AgentTaskHandle;
  taskId: string;
}): Promise<
  | {
      attempt: CenterAgentTaskAttempt;
      outcome: "created";
      task: CenterAgentTask;
    }
  | {
      attempt: CenterAgentTaskAttempt;
      outcome: "replay";
      task: CenterAgentTask;
    }
> {
  const nowMs = parseTimestampMs(input.nowMs, "nowMs");
  const idempotencyKey = parseRequiredText(
    input.idempotencyKey,
    "idempotencyKey"
  );
  const taskHandle = agentTaskHandleSchema.parse(input.taskHandle);
  const existing = await readAttemptByIdempotencyKey({
    db: input.db,
    idempotencyKey,
    taskId: input.taskId,
  });
  if (existing) {
    if (
      existing.id !== input.attemptId ||
      buildAgentTaskKey(existing.taskHandle) !== buildAgentTaskKey(taskHandle)
    ) {
      throw new CenterAgentTaskAttemptConflictError(
        "The attempt idempotency key is already bound to different attempt data."
      );
    }
    return {
      attempt: existing,
      outcome: "replay",
      task: await requireTask(input),
    };
  }

  const task = await requireTask(input);
  requireExpectedVersion(task, input.expectedTaskVersion);
  if (
    task.activeAttemptGeneration !== null &&
    !isCenterAgentTaskTerminalStatus(task.status)
  ) {
    throw new CenterAgentTaskAttemptConflictError(
      "The task already has an active non-terminal attempt."
    );
  }
  const generation = (task.activeAttemptGeneration ?? 0) + 1;
  const candidate = centerAgentTaskAttemptSchema.parse({
    createdAt: toIsoDateTime(nowMs),
    failureCode: null,
    finishedAt: null,
    generation,
    id: input.attemptId,
    startedAt: null,
    status: "queued",
    taskHandle,
    taskId: input.taskId,
  });
  const taskHandleJson = JSON.stringify(taskHandle);

  try {
    const [insert, update] = await input.db.batch([
      input.db
        .prepare(
          `
            INSERT INTO center_agent_task_attempts (
              id,
              task_id,
              organization_id,
              idempotency_key,
              generation,
              execution_task_key,
              task_handle_json,
              status,
              failure_code,
              created_at_ms,
              started_at_ms,
              finished_at_ms,
              updated_at_ms
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, ?, NULL, NULL, ?
            FROM center_agent_tasks
            WHERE id = ?
              AND organization_id = ?
              AND version = ?
              AND (
                active_attempt_generation IS NULL
                OR status IN ('succeeded', 'failed', 'stopped')
              )
          `
        )
        .bind(
          candidate.id,
          candidate.taskId,
          input.organizationId,
          idempotencyKey,
          generation,
          buildAgentTaskKey(taskHandle),
          taskHandleJson,
          nowMs,
          nowMs,
          input.taskId,
          input.organizationId,
          input.expectedTaskVersion
        ),
      input.db
        .prepare(
          `
            UPDATE center_agent_tasks
            SET
              status = 'queued',
              active_attempt_generation = ?,
              version = version + 1,
              updated_at_ms = max(updated_at_ms, ?),
              finished_at_ms = NULL
            WHERE id = ?
              AND organization_id = ?
              AND version = ?
              AND EXISTS (
                SELECT 1
                FROM center_agent_task_attempts
                WHERE id = ?
                  AND task_id = ?
                  AND organization_id = ?
                  AND generation = ?
                  AND idempotency_key = ?
              )
          `
        )
        .bind(
          generation,
          nowMs,
          input.taskId,
          input.organizationId,
          input.expectedTaskVersion,
          candidate.id,
          input.taskId,
          input.organizationId,
          generation,
          idempotencyKey
        ),
    ]);
    if (!(changedExactlyOneRow(insert) && changedExactlyOneRow(update))) {
      const current = await requireTask(input);
      throw new CenterAgentTaskVersionConflictError({
        actualVersion: current.version,
        expectedVersion: input.expectedTaskVersion,
      });
    }
  } catch (error) {
    if (error instanceof CenterAgentTaskVersionConflictError) {
      throw error;
    }
    const current = await requireTask(input);
    if (current.version !== input.expectedTaskVersion) {
      throw new CenterAgentTaskVersionConflictError({
        actualVersion: current.version,
        expectedVersion: input.expectedTaskVersion,
      });
    }
    const conflicting = await readAttemptByIdOrIdempotencyKey({
      attemptId: candidate.id,
      db: input.db,
      idempotencyKey,
      taskId: input.taskId,
    });
    if (conflicting) {
      throw new CenterAgentTaskAttemptConflictError(
        "The attempt id, idempotency key, generation, or task handle is already in use."
      );
    }
    throw error;
  }
  return {
    attempt: candidate,
    outcome: "created",
    task: await requireTask(input),
  };
}

export async function startCenterAgentTaskAttempt(input: {
  admission: {
    deliveryId: string;
    instruction: string;
    operationIdempotencyKey: string;
    parent:
      | { deliveryId: string; kind: "delivery" }
      | { kind: "submission"; submissionId: string };
    requesterUserId: string;
    taskEventId: string;
  };
  attemptId: string;
  db: D1Database;
  event?: CenterAgentTaskAttemptEventInput;
  expectedTaskVersion: number;
  idempotencyKey: string;
  nowMs: number;
  organizationId: string;
  replacedAttemptGeneration?: number;
  taskHandle: AgentTaskHandle;
  taskId: string;
}): Promise<{
  attempt: CenterAgentTaskAttempt;
  event: CenterAgentTaskEvent | null;
  outcome: "created" | "replay";
  task: CenterAgentTask;
}> {
  const nowMs = parseTimestampMs(input.nowMs, "nowMs");
  const idempotencyKey = parseRequiredText(
    input.idempotencyKey,
    "idempotencyKey"
  );
  const taskHandle = agentTaskHandleSchema.parse(input.taskHandle);
  const replay = await readCenterAgentTaskAttemptStartReplay({
    ...input,
    idempotencyKey,
    taskHandle,
  });
  if (replay) {
    return replay;
  }
  const prepared = await prepareCenterAgentTaskAttemptStart({
    ...input,
    idempotencyKey,
    nowMs,
    taskHandle,
  });
  await executeCenterAgentTaskAttemptStart(input, prepared);
  return {
    attempt: prepared.candidateAttempt,
    event:
      prepared.preparedEvent?.event ?? prepared.existingEvent?.event ?? null,
    outcome: "created",
    task: await requireTask(input),
  };
}

type CenterAgentTaskAttemptStartInput = Parameters<
  typeof startCenterAgentTaskAttempt
>[0];

type PreparedCenterAgentTaskAttemptStart = {
  admission: CenterAgentTaskAdmissionOutboxRecord;
  candidateAttempt: CenterAgentTaskAttempt;
  existingEvent: StoredEvent | null;
  idempotencyKey: string;
  nowMs: number;
  preparedEvent: ReturnType<typeof prepareAttemptStartEvent> | null;
  replacedAttemptGeneration: number | null;
  taskHandle: AgentTaskHandle;
};

async function readInitialCenterAgentTaskReplay(input: {
  admission: CenterAgentTaskAdmissionOutboxRecord;
  attemptId: string;
  attemptIdempotencyKey: string;
  candidateTask: CenterAgentTask;
  db: D1Database;
  preparedEvent: ReturnType<typeof prepareAttemptStartEvent>;
  taskHandle: AgentTaskHandle;
  taskIdempotencyKey: string;
}): Promise<{
  attempt: CenterAgentTaskAttempt;
  event: CenterAgentTaskEvent;
  outcome: "replay";
  task: CenterAgentTask;
} | null> {
  const existingTask = await readTaskByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.taskIdempotencyKey,
    organizationId: input.candidateTask.organizationId,
    requesterUserId: input.candidateTask.requesterUserId,
  });
  if (!existingTask) {
    return null;
  }
  if (!isSameTaskCreation(existingTask, input.candidateTask)) {
    throw new CenterAgentTaskConflictError(
      "The Task creation operation is already bound to different Task data."
    );
  }
  const existingAttempt = await readAttemptByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.attemptIdempotencyKey,
    taskId: input.candidateTask.id,
  });
  const existingEvent = await readEventByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.preparedEvent.idempotencyKey,
    taskId: input.candidateTask.id,
  });
  const existingAdmission = await readCenterAgentTaskAdmissionOutbox({
    attemptGeneration: 1,
    db: input.db,
    organizationId: input.candidateTask.organizationId,
    taskId: input.candidateTask.id,
  });
  if (
    !existingAttempt ||
    existingAttempt.id !== input.attemptId ||
    buildAgentTaskKey(existingAttempt.taskHandle) !==
      buildAgentTaskKey(input.taskHandle) ||
    !existingEvent ||
    existingEvent.event.id !== input.preparedEvent.event.id ||
    existingEvent.event.actor !== input.preparedEvent.event.actor ||
    existingEvent.event.attemptGeneration !==
      input.preparedEvent.event.attemptGeneration ||
    existingEvent.event.kind !== input.preparedEvent.event.kind ||
    existingEvent.event.text !== input.preparedEvent.event.text ||
    !existingAdmission ||
    !isSameCenterAgentTaskAdmissionOutbox(existingAdmission, input.admission)
  ) {
    throw new CenterAgentTaskConflictError(
      "The accepted Task creation is missing its exact event, attempt, or admission intent."
    );
  }
  return {
    attempt: existingAttempt,
    event: existingEvent.event,
    outcome: "replay",
    task: existingTask,
  };
}

async function readCenterAgentTaskAttemptStartReplay(
  input: CenterAgentTaskAttemptStartInput & {
    idempotencyKey: string;
    taskHandle: AgentTaskHandle;
  }
): Promise<{
  attempt: CenterAgentTaskAttempt;
  event: CenterAgentTaskEvent | null;
  outcome: "replay";
  task: CenterAgentTask;
} | null> {
  const existingAttempt = await readAttemptByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    taskId: input.taskId,
  });
  if (!existingAttempt) {
    return null;
  }
  if (
    existingAttempt.id !== input.attemptId ||
    buildAgentTaskKey(existingAttempt.taskHandle) !==
      buildAgentTaskKey(input.taskHandle)
  ) {
    throw new CenterAgentTaskAttemptConflictError(
      "The attempt idempotency key is already bound to different attempt data."
    );
  }
  const existingEvent = input.event
    ? await requireMatchingAttemptStartEvent(input, input.event)
    : null;
  await requireMatchingCenterAgentTaskAdmissionOutbox({
    admission: input.admission,
    attemptGeneration: existingAttempt.generation,
    db: input.db,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
  return {
    attempt: existingAttempt,
    event: existingEvent,
    outcome: "replay",
    task: await requireTask(input),
  };
}

async function prepareCenterAgentTaskAttemptStart(
  input: CenterAgentTaskAttemptStartInput & {
    idempotencyKey: string;
    nowMs: number;
    taskHandle: AgentTaskHandle;
  }
): Promise<PreparedCenterAgentTaskAttemptStart> {
  const task = await requireTask(input);
  requireExpectedVersion(task, input.expectedTaskVersion);
  const replacedAttemptGeneration = input.replacedAttemptGeneration ?? null;
  if (replacedAttemptGeneration === null) {
    if (
      task.activeAttemptGeneration !== null &&
      !isCenterAgentTaskTerminalStatus(task.status)
    ) {
      throw new CenterAgentTaskAttemptConflictError(
        "The Task already has an active non-terminal attempt."
      );
    }
  } else {
    await requireReplaceableNeedsAttentionAttempt({
      ...input,
      replacedAttemptGeneration,
      task,
    });
  }

  const generation = (task.activeAttemptGeneration ?? 0) + 1;
  const candidateAttempt = centerAgentTaskAttemptSchema.parse({
    createdAt: toIsoDateTime(input.nowMs),
    failureCode: null,
    finishedAt: null,
    generation,
    id: input.attemptId,
    startedAt: null,
    status: "queued",
    taskHandle: input.taskHandle,
    taskId: input.taskId,
  });
  const preparedEvent = input.event
    ? prepareAttemptStartEvent(input, input.event)
    : null;
  const existingEvent = preparedEvent
    ? await readEventByIdempotencyKey({
        db: input.db,
        idempotencyKey: preparedEvent.idempotencyKey,
        taskId: input.taskId,
      })
    : null;
  if (
    existingEvent &&
    preparedEvent &&
    !isSameEvent(
      existingEvent,
      preparedEvent.event,
      input.organizationId,
      preparedEvent.observedAtMs
    )
  ) {
    throw new CenterAgentTaskEventConflictError(
      "The attempt event idempotency key is already bound to different event data."
    );
  }
  const admission = prepareCenterAgentTaskAdmissionOutbox({
    admission: input.admission,
    attemptGeneration: generation,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
  return {
    admission,
    candidateAttempt,
    existingEvent,
    idempotencyKey: input.idempotencyKey,
    nowMs: input.nowMs,
    preparedEvent,
    replacedAttemptGeneration,
    taskHandle: input.taskHandle,
  };
}

async function requireReplaceableNeedsAttentionAttempt(input: {
  db: D1Database;
  organizationId: string;
  replacedAttemptGeneration: number;
  task: CenterAgentTask;
  taskId: string;
}): Promise<void> {
  if (
    input.task.activeAttemptGeneration !== input.replacedAttemptGeneration ||
    input.task.status !== "needs_attention"
  ) {
    throw new CenterAgentTaskAttemptConflictError(
      "The Task does not have the Needs action attempt being replaced."
    );
  }
  const replacedAttempt = await requireAttemptGeneration({
    db: input.db,
    generation: input.replacedAttemptGeneration,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
  if (replacedAttempt.status !== "needs_attention") {
    throw new CenterAgentTaskAttemptConflictError(
      "The Task attempt is no longer waiting for the requester."
    );
  }
}

function buildCenterAgentTaskAttemptStartStatements(
  input: CenterAgentTaskAttemptStartInput,
  prepared: PreparedCenterAgentTaskAttemptStart
): D1PreparedStatement[] {
  const {
    admission,
    candidateAttempt,
    existingEvent,
    idempotencyKey,
    nowMs,
    preparedEvent,
    replacedAttemptGeneration,
    taskHandle,
  } = prepared;
  const generation = candidateAttempt.generation;
  const statements: D1PreparedStatement[] = [];
  if (replacedAttemptGeneration !== null) {
    statements.push(
      input.db
        .prepare(
          `
            UPDATE center_agent_task_attempts
            SET
              status = 'stopped',
              failure_code = NULL,
              started_at_ms = coalesce(started_at_ms, ?),
              finished_at_ms = ?,
              updated_at_ms = max(updated_at_ms, ?)
            WHERE task_id = ?
              AND organization_id = ?
              AND generation = ?
              AND status = 'needs_attention'
              AND EXISTS (
                SELECT 1
                FROM center_agent_tasks
                WHERE id = ?
                  AND organization_id = ?
                  AND version = ?
                  AND active_attempt_generation = ?
                  AND status = 'needs_attention'
              )
          `
        )
        .bind(
          nowMs,
          nowMs,
          nowMs,
          input.taskId,
          input.organizationId,
          replacedAttemptGeneration,
          input.taskId,
          input.organizationId,
          input.expectedTaskVersion,
          replacedAttemptGeneration
        )
    );
  }
  if (preparedEvent && !existingEvent) {
    statements.push(
      input.db
        .prepare(
          `
            INSERT INTO center_agent_task_events (
              id,
              task_id,
              organization_id,
              idempotency_key,
              attempt_generation,
              kind,
              actor,
              text,
              occurred_at_ms,
              observed_at_ms
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            FROM center_agent_tasks
            WHERE id = ?
              AND organization_id = ?
              AND version = ?
          `
        )
        .bind(
          preparedEvent.event.id,
          preparedEvent.event.taskId,
          input.organizationId,
          preparedEvent.idempotencyKey,
          preparedEvent.event.attemptGeneration,
          preparedEvent.event.kind,
          preparedEvent.event.actor,
          preparedEvent.event.text,
          preparedEvent.occurredAtMs,
          preparedEvent.observedAtMs,
          input.taskId,
          input.organizationId,
          input.expectedTaskVersion
        )
    );
  }
  statements.push(
    input.db
      .prepare(
        `
          INSERT INTO center_agent_task_attempts (
            id,
            task_id,
            organization_id,
            idempotency_key,
            generation,
            execution_task_key,
            task_handle_json,
            status,
            failure_code,
            created_at_ms,
            started_at_ms,
            finished_at_ms,
            updated_at_ms
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, ?, NULL, NULL, ?
          FROM center_agent_tasks
          WHERE id = ?
            AND organization_id = ?
            AND version = ?
            AND (
              (? IS NULL AND (active_attempt_generation IS NULL OR status IN ('succeeded', 'failed', 'stopped')))
              OR (
                ? IS NOT NULL
                AND active_attempt_generation = ?
                AND status = 'needs_attention'
                AND EXISTS (
                  SELECT 1
                  FROM center_agent_task_attempts
                  WHERE task_id = ?
                    AND organization_id = ?
                    AND generation = ?
                    AND status = 'stopped'
                )
              )
            )
        `
      )
      .bind(
        candidateAttempt.id,
        candidateAttempt.taskId,
        input.organizationId,
        idempotencyKey,
        generation,
        buildAgentTaskKey(taskHandle),
        JSON.stringify(taskHandle),
        nowMs,
        nowMs,
        input.taskId,
        input.organizationId,
        input.expectedTaskVersion,
        replacedAttemptGeneration,
        replacedAttemptGeneration,
        replacedAttemptGeneration,
        input.taskId,
        input.organizationId,
        replacedAttemptGeneration
      ),
    input.db
      .prepare(
        `
          INSERT INTO center_agent_task_admission_outbox (
            task_id,
            organization_id,
            attempt_generation,
            delivery_id,
            operation_idempotency_key,
            task_event_id,
            requester_user_id,
            instruction,
            parent_kind,
            parent_id,
            state,
            attempt_count,
            last_attempt_at_ms,
            last_failure_code,
            created_at_ms,
            updated_at_ms
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?
          FROM center_agent_task_attempts AS attempt
          WHERE attempt.id = ?
            AND attempt.task_id = ?
            AND attempt.organization_id = ?
            AND attempt.generation = ?
            AND attempt.status = 'queued'
            AND EXISTS (
              SELECT 1
              FROM center_agent_task_events
              WHERE id = ?
                AND task_id = ?
                AND organization_id = ?
            )
        `
      )
      .bind(
        admission.taskId,
        admission.organizationId,
        admission.attemptGeneration,
        admission.deliveryId,
        admission.operationIdempotencyKey,
        admission.taskEventId,
        admission.requesterUserId,
        admission.instruction,
        admission.parent.kind,
        admission.parent.kind === "delivery"
          ? admission.parent.deliveryId
          : admission.parent.submissionId,
        admission.createdAtMs,
        admission.updatedAtMs,
        candidateAttempt.id,
        input.taskId,
        input.organizationId,
        generation,
        admission.taskEventId,
        input.taskId,
        input.organizationId
      ),
    input.db
      .prepare(
        `
          UPDATE center_agent_tasks
          SET
            status = 'queued',
            active_attempt_generation = ?,
            version = version + 1,
            updated_at_ms = max(updated_at_ms, ?),
            finished_at_ms = NULL
          WHERE id = ?
            AND organization_id = ?
            AND version = ?
            AND EXISTS (
              SELECT 1
              FROM center_agent_task_attempts
              WHERE id = ?
                AND task_id = ?
                AND organization_id = ?
                AND generation = ?
                AND idempotency_key = ?
                AND status = 'queued'
            )
            AND EXISTS (
              SELECT 1
              FROM center_agent_task_admission_outbox
              WHERE task_id = ?
                AND organization_id = ?
                AND attempt_generation = ?
                AND delivery_id = ?
                AND state = 'pending'
            )
            ${
              preparedEvent
                ? `AND EXISTS (
                    SELECT 1
                    FROM center_agent_task_events
                    WHERE id = ?
                      AND task_id = ?
                      AND organization_id = ?
                      AND idempotency_key = ?
                  )`
                : ""
            }
        `
      )
      .bind(
        generation,
        nowMs,
        input.taskId,
        input.organizationId,
        input.expectedTaskVersion,
        candidateAttempt.id,
        input.taskId,
        input.organizationId,
        generation,
        idempotencyKey,
        admission.taskId,
        admission.organizationId,
        admission.attemptGeneration,
        admission.deliveryId,
        ...(preparedEvent
          ? [
              preparedEvent.event.id,
              input.taskId,
              input.organizationId,
              preparedEvent.idempotencyKey,
            ]
          : [])
      )
  );
  return statements;
}

async function executeCenterAgentTaskAttemptStart(
  input: CenterAgentTaskAttemptStartInput,
  prepared: PreparedCenterAgentTaskAttemptStart
): Promise<void> {
  try {
    const results = await input.db.batch(
      buildCenterAgentTaskAttemptStartStatements(input, prepared)
    );
    if (results.some((result) => !changedExactlyOneRow(result))) {
      const current = await requireTask(input);
      throw new CenterAgentTaskVersionConflictError({
        actualVersion: current.version,
        expectedVersion: input.expectedTaskVersion,
      });
    }
  } catch (error) {
    if (error instanceof CenterAgentTaskVersionConflictError) {
      throw error;
    }
    const current = await requireTask(input);
    if (current.version !== input.expectedTaskVersion) {
      throw new CenterAgentTaskVersionConflictError({
        actualVersion: current.version,
        expectedVersion: input.expectedTaskVersion,
      });
    }
    const conflicting = await readAttemptByIdOrIdempotencyKey({
      attemptId: prepared.candidateAttempt.id,
      db: input.db,
      idempotencyKey: prepared.idempotencyKey,
      taskId: input.taskId,
    });
    if (conflicting) {
      throw new CenterAgentTaskAttemptConflictError(
        "The attempt id, idempotency key, generation, or task handle is already in use."
      );
    }
    throw error;
  }
}

function prepareCenterAgentTaskAdmissionOutbox(input: {
  admission: CenterAgentTaskAttemptStartInput["admission"];
  attemptGeneration: number;
  nowMs: number;
  organizationId: string;
  taskId: string;
}): CenterAgentTaskAdmissionOutboxRecord {
  const parent =
    input.admission.parent.kind === "delivery"
      ? {
          deliveryId: parseRequiredText(
            input.admission.parent.deliveryId,
            "admission.parent.deliveryId"
          ),
          kind: "delivery" as const,
        }
      : {
          kind: "submission" as const,
          submissionId: parseRequiredText(
            input.admission.parent.submissionId,
            "admission.parent.submissionId"
          ),
        };
  return {
    attemptCount: 0,
    attemptGeneration: input.attemptGeneration,
    createdAtMs: input.nowMs,
    deliveryId: parseRequiredText(
      input.admission.deliveryId,
      "admission.deliveryId"
    ),
    instruction: parseRequiredText(
      input.admission.instruction,
      "admission.instruction"
    ),
    lastAttemptAtMs: null,
    lastFailureCode: null,
    operationIdempotencyKey: parseRequiredText(
      input.admission.operationIdempotencyKey,
      "admission.operationIdempotencyKey"
    ),
    organizationId: input.organizationId,
    parent,
    requesterUserId: parseRequiredText(
      input.admission.requesterUserId,
      "admission.requesterUserId"
    ),
    state: "pending",
    taskEventId: parseRequiredText(
      input.admission.taskEventId,
      "admission.taskEventId"
    ),
    taskId: input.taskId,
    updatedAtMs: input.nowMs,
  };
}

async function requireMatchingCenterAgentTaskAdmissionOutbox(input: {
  admission: CenterAgentTaskAttemptStartInput["admission"];
  attemptGeneration: number;
  db: D1Database;
  organizationId: string;
  taskId: string;
}): Promise<void> {
  const row = await input.db
    .prepare(
      `
        SELECT ${ADMISSION_OUTBOX_SELECT_COLUMNS}
        FROM center_agent_task_admission_outbox
        WHERE task_id = ? AND attempt_generation = ?
        LIMIT 1
      `
    )
    .bind(input.taskId, input.attemptGeneration)
    .first<AdmissionOutboxRow>();
  const expected = prepareCenterAgentTaskAdmissionOutbox({
    admission: input.admission,
    attemptGeneration: input.attemptGeneration,
    nowMs: row?.created_at_ms ?? 0,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
  if (
    !(
      row &&
      isSameCenterAgentTaskAdmissionOutbox(mapAdmissionOutboxRow(row), expected)
    )
  ) {
    throw new CenterAgentTaskAttemptConflictError(
      "The Task attempt admission is missing or bound to different operation data."
    );
  }
}

function isSameCenterAgentTaskAdmissionOutbox(
  actual: CenterAgentTaskAdmissionOutboxRecord,
  expected: CenterAgentTaskAdmissionOutboxRecord
): boolean {
  const actualParentId =
    actual.parent.kind === "delivery"
      ? actual.parent.deliveryId
      : actual.parent.submissionId;
  const expectedParentId =
    expected.parent.kind === "delivery"
      ? expected.parent.deliveryId
      : expected.parent.submissionId;
  return (
    actual.taskId === expected.taskId &&
    actual.organizationId === expected.organizationId &&
    actual.attemptGeneration === expected.attemptGeneration &&
    actual.deliveryId === expected.deliveryId &&
    actual.operationIdempotencyKey === expected.operationIdempotencyKey &&
    actual.taskEventId === expected.taskEventId &&
    actual.requesterUserId === expected.requesterUserId &&
    actual.instruction === expected.instruction &&
    actual.parent.kind === expected.parent.kind &&
    actualParentId === expectedParentId
  );
}

export async function listPendingCenterAgentTaskAdmissions(input: {
  db: D1Database;
  limit: number;
}): Promise<CenterAgentTaskAdmissionOutboxRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT ${ADMISSION_OUTBOX_SELECT_COLUMNS}
        FROM center_agent_task_admission_outbox AS admission
        WHERE admission.state = 'pending'
        ORDER BY admission.updated_at_ms ASC, admission.task_id ASC
        LIMIT ?
      `
    )
    .bind(parseListLimit(input.limit))
    .all<AdmissionOutboxRow>();
  return result.results.map(mapAdmissionOutboxRow);
}

export async function recordCenterAgentTaskAdmissionAttempt(input: {
  attemptGeneration: number;
  db: D1Database;
  failureCode: string | null;
  nowMs: number;
  organizationId: string;
  taskId: string;
}): Promise<void> {
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_task_admission_outbox
        SET
          attempt_count = attempt_count + 1,
          last_attempt_at_ms = ?,
          last_failure_code = ?,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE task_id = ?
          AND organization_id = ?
          AND attempt_generation = ?
          AND state = 'pending'
      `
    )
    .bind(
      input.nowMs,
      input.failureCode,
      input.nowMs,
      input.taskId,
      input.organizationId,
      input.attemptGeneration
    )
    .run();
  if (!changedExactlyOneRow(result)) {
    const existing = await readCenterAgentTaskAdmissionOutbox(input);
    if (existing?.state === "pending") {
      throw new CenterAgentTaskAttemptConflictError(
        "The Task admission attempt could not be recorded."
      );
    }
  }
}

export async function settleCenterAgentTaskAdmission(input: {
  attemptGeneration: number;
  db: D1Database;
  failureCode?: string | null;
  nowMs: number;
  organizationId: string;
  state: "delivered" | "failed";
  taskId: string;
}): Promise<void> {
  const failureCode = input.failureCode ?? null;
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_task_admission_outbox
        SET
          state = ?,
          last_failure_code = ?,
          updated_at_ms = max(updated_at_ms, ?)
        WHERE task_id = ?
          AND organization_id = ?
          AND attempt_generation = ?
          AND state = 'pending'
      `
    )
    .bind(
      input.state,
      failureCode,
      input.nowMs,
      input.taskId,
      input.organizationId,
      input.attemptGeneration
    )
    .run();
  if (!changedExactlyOneRow(result)) {
    const existing = await readCenterAgentTaskAdmissionOutbox(input);
    if (
      !existing ||
      existing.state !== input.state ||
      existing.lastFailureCode !== failureCode
    ) {
      throw new CenterAgentTaskAttemptConflictError(
        "The Task admission could not be settled consistently."
      );
    }
  }
}

export async function readCenterAgentTaskAdmissionOutbox(input: {
  attemptGeneration: number;
  db: D1Database;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTaskAdmissionOutboxRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${ADMISSION_OUTBOX_SELECT_COLUMNS}
        FROM center_agent_task_admission_outbox
        WHERE task_id = ?
          AND organization_id = ?
          AND attempt_generation = ?
        LIMIT 1
      `
    )
    .bind(input.taskId, input.organizationId, input.attemptGeneration)
    .first<AdmissionOutboxRow>();
  return row ? mapAdmissionOutboxRow(row) : null;
}

export async function listStoppingCenterAgentTaskAttempts(input: {
  db: D1Database;
  limit: number;
}): Promise<CenterAgentTaskStoppingAttemptRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
          task.id AS task_id,
          task.organization_id,
          task.requester_user_id,
          task.version AS task_version,
          attempt.generation AS attempt_generation,
          json_extract(attempt.task_handle_json, '$.deliveryId') AS delivery_id,
          stop_event.occurred_at_ms AS stop_requested_at_ms,
          EXISTS (
            SELECT 1
            FROM center_agent_task_events AS attention
            WHERE attention.task_id = task.id
              AND attention.organization_id = task.organization_id
              AND attention.attempt_generation = attempt.generation
              AND attention.kind = 'needs_attention'
              AND attention.occurred_at_ms <= stop_event.occurred_at_ms
          ) AS allow_already_terminal
        FROM center_agent_tasks AS task
        JOIN center_agent_task_attempts AS attempt
          ON attempt.task_id = task.id
          AND attempt.organization_id = task.organization_id
          AND attempt.generation = task.active_attempt_generation
        JOIN center_agent_task_events AS stop_event
          ON stop_event.task_id = task.id
          AND stop_event.organization_id = task.organization_id
          AND stop_event.attempt_generation = attempt.generation
          AND stop_event.kind = 'stop_requested'
          AND stop_event.id = (
            SELECT latest_stop_event.id
            FROM center_agent_task_events AS latest_stop_event
            WHERE latest_stop_event.task_id = task.id
              AND latest_stop_event.organization_id = task.organization_id
              AND latest_stop_event.attempt_generation = attempt.generation
              AND latest_stop_event.kind = 'stop_requested'
            ORDER BY
              latest_stop_event.occurred_at_ms DESC,
              latest_stop_event.observed_at_ms DESC,
              latest_stop_event.id DESC
            LIMIT 1
          )
        WHERE task.status = 'stopping'
          AND attempt.status = 'stopping'
          AND task.requester_user_id IS NOT NULL
          AND json_extract(attempt.task_handle_json, '$.kind') = 'native_delivery'
        ORDER BY stop_event.occurred_at_ms ASC, task.id ASC
        LIMIT ?
      `
    )
    .bind(parseListLimit(input.limit))
    .all<{
      allow_already_terminal: boolean | number;
      attempt_generation: number;
      delivery_id: string;
      organization_id: string;
      requester_user_id: string;
      stop_requested_at_ms: number;
      task_id: string;
      task_version: number;
    }>();
  return result.results.map((row) => ({
    allowAlreadyTerminal:
      row.allow_already_terminal === true || row.allow_already_terminal === 1,
    attemptGeneration: row.attempt_generation,
    deliveryId: row.delivery_id,
    organizationId: row.organization_id,
    requesterUserId: row.requester_user_id,
    stopRequestedAtMs: row.stop_requested_at_ms,
    taskId: row.task_id,
    taskVersion: row.task_version,
  }));
}

function mapAdmissionOutboxRow(
  row: AdmissionOutboxRow
): CenterAgentTaskAdmissionOutboxRecord {
  return {
    attemptCount: row.attempt_count,
    attemptGeneration: row.attempt_generation,
    createdAtMs: row.created_at_ms,
    deliveryId: row.delivery_id,
    instruction: row.instruction,
    lastAttemptAtMs: row.last_attempt_at_ms,
    lastFailureCode: row.last_failure_code,
    operationIdempotencyKey: row.operation_idempotency_key,
    organizationId: row.organization_id,
    parent:
      row.parent_kind === "delivery"
        ? { deliveryId: row.parent_id, kind: "delivery" }
        : { kind: "submission", submissionId: row.parent_id },
    requesterUserId: row.requester_user_id,
    state: row.state,
    taskEventId: row.task_event_id,
    taskId: row.task_id,
    updatedAtMs: row.updated_at_ms,
  };
}

function prepareAttemptStartEvent(
  input: { organizationId: string; taskId: string },
  event: CenterAgentTaskAttemptEventInput
): {
  event: CenterAgentTaskEvent;
  idempotencyKey: string;
  observedAtMs: number;
  occurredAtMs: number;
} {
  const occurredAtMs = parseTimestampMs(
    event.occurredAtMs,
    "event.occurredAtMs"
  );
  const observedAtMs = parseTimestampMs(
    event.observedAtMs,
    "event.observedAtMs"
  );
  if (observedAtMs < occurredAtMs) {
    throw new RangeError(
      "event.observedAtMs must not be before event.occurredAtMs."
    );
  }
  return {
    event: centerAgentTaskEventSchema.parse({
      actor: event.actor,
      attemptGeneration: event.attemptGeneration,
      id: event.eventId,
      kind: event.kind,
      occurredAt: toIsoDateTime(occurredAtMs),
      taskId: input.taskId,
      text: event.text,
    }),
    idempotencyKey: parseRequiredText(
      event.idempotencyKey,
      "event.idempotencyKey"
    ),
    observedAtMs,
    occurredAtMs,
  };
}

async function requireMatchingAttemptStartEvent(
  input: { db: D1Database; organizationId: string; taskId: string },
  event: CenterAgentTaskAttemptEventInput
): Promise<CenterAgentTaskEvent> {
  const prepared = prepareAttemptStartEvent(input, event);
  const existing = await readEventByIdempotencyKey({
    db: input.db,
    idempotencyKey: prepared.idempotencyKey,
    taskId: input.taskId,
  });
  if (
    !(
      existing &&
      isSameEvent(
        existing,
        prepared.event,
        input.organizationId,
        prepared.observedAtMs
      )
    )
  ) {
    throw new CenterAgentTaskEventConflictError(
      "The attempt replay is missing its exact accepted Task event."
    );
  }
  return existing.event;
}

export async function listCenterAgentTaskAttempts(input: {
  db: D1Database;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTaskAttempt[]> {
  const result = await input.db
    .prepare(
      `
        SELECT ${ATTEMPT_SELECT_COLUMNS}
        FROM center_agent_task_attempts
        WHERE task_id = ? AND organization_id = ?
        ORDER BY generation ASC, id ASC
      `
    )
    .bind(input.taskId, input.organizationId)
    .all<AttemptRow>();
  return result.results.map(mapAttemptRow);
}

const RUNNING_ATTEMPT_LOOKUP_CHUNK_SIZE = 40;

export async function listRunningCenterAgentTaskAttempts(input: {
  db: D1Database;
  organizationId: string;
  tasks: readonly { generation: number; taskId: string }[];
}): Promise<CenterAgentTaskAttempt[]> {
  const attempts: CenterAgentTaskAttempt[] = [];
  for (
    let offset = 0;
    offset < input.tasks.length;
    offset += RUNNING_ATTEMPT_LOOKUP_CHUNK_SIZE
  ) {
    const chunk = input.tasks.slice(
      offset,
      offset + RUNNING_ATTEMPT_LOOKUP_CHUNK_SIZE
    );
    if (chunk.length === 0) {
      continue;
    }
    const selectors = chunk.map(() => "(task_id = ? AND generation = ?)");
    const bindings: Array<number | string> = [input.organizationId];
    for (const task of chunk) {
      bindings.push(parseRequiredText(task.taskId, "taskId"), task.generation);
    }
    const result = await input.db
      .prepare(
        `
          SELECT ${ATTEMPT_SELECT_COLUMNS}
          FROM center_agent_task_attempts
          WHERE organization_id = ?
            AND status = 'running'
            AND (${selectors.join(" OR ")})
          ORDER BY task_id ASC, generation ASC
        `
      )
      .bind(...bindings)
      .all<AttemptRow>();
    attempts.push(...result.results.map(mapAttemptRow));
  }
  return attempts;
}

export async function readCenterAgentTaskAttemptByTaskHandle(input: {
  db: D1Database;
  organizationId: string;
  taskHandle: AgentTaskHandle;
}): Promise<CenterAgentTaskAttempt | null> {
  const taskHandle = agentTaskHandleSchema.parse(input.taskHandle);
  const row = await input.db
    .prepare(
      `
        SELECT ${ATTEMPT_SELECT_COLUMNS}
        FROM center_agent_task_attempts
        WHERE organization_id = ? AND execution_task_key = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, buildAgentTaskKey(taskHandle))
    .first<AttemptRow>();
  return row ? mapAttemptRow(row) : null;
}

export async function transitionCenterAgentTaskAttempt(input: {
  db: D1Database;
  expectedTaskVersion: number;
  failureCode: string | null;
  generation: number;
  nowMs: number;
  organizationId: string;
  status: Exclude<CenterAgentTaskStatus, "queued">;
  taskId: string;
}): Promise<{
  attempt: CenterAgentTaskAttempt;
  outcome: "replay" | "stale_generation" | "terminal_conflict" | "updated";
  task: CenterAgentTask;
}> {
  const nowMs = parseTimestampMs(input.nowMs, "nowMs");
  const task = await requireTask(input);
  const attempt = await requireAttemptGeneration(input);
  if (isCenterAgentTaskTerminalStatus(attempt.status)) {
    const sameTerminal =
      attempt.status === input.status &&
      attempt.failureCode === input.failureCode;
    return {
      attempt,
      outcome: sameTerminal ? "replay" : "terminal_conflict",
      task,
    };
  }
  requireExpectedVersion(task, input.expectedTaskVersion);
  if (input.status === "failed") {
    parseRequiredText(input.failureCode ?? "", "failureCode");
  } else if (input.failureCode !== null) {
    throw new TypeError("failureCode is only valid for failed attempts.");
  }

  const startedAtMs =
    attempt.startedAt === null ? nowMs : Date.parse(attempt.startedAt);
  const terminal = isCenterAgentTaskTerminalStatus(input.status);
  const finishedAtMs = terminal ? nowMs : null;
  const [attemptUpdate, taskUpdate] = await input.db.batch([
    input.db
      .prepare(
        `
          UPDATE center_agent_task_attempts
          SET
            status = ?,
            failure_code = ?,
            started_at_ms = ?,
            finished_at_ms = ?,
            updated_at_ms = max(updated_at_ms, ?)
          WHERE task_id = ?
            AND organization_id = ?
            AND generation = ?
            AND status IN ('queued', 'running', 'stopping', 'needs_attention')
            AND EXISTS (
              SELECT 1
              FROM center_agent_tasks
              WHERE id = ? AND organization_id = ? AND version = ?
            )
        `
      )
      .bind(
        input.status,
        input.failureCode,
        startedAtMs,
        finishedAtMs,
        nowMs,
        input.taskId,
        input.organizationId,
        input.generation,
        input.taskId,
        input.organizationId,
        input.expectedTaskVersion
      ),
    input.db
      .prepare(
        `
          UPDATE center_agent_tasks
          SET
            status = ?,
            version = version + 1,
            updated_at_ms = max(updated_at_ms, ?),
            finished_at_ms = ?
          WHERE id = ?
            AND organization_id = ?
            AND version = ?
            AND active_attempt_generation = ?
            AND EXISTS (
              SELECT 1
              FROM center_agent_task_attempts
              WHERE task_id = ?
                AND organization_id = ?
                AND generation = ?
                AND status = ?
            )
        `
      )
      .bind(
        input.status,
        nowMs,
        finishedAtMs,
        input.taskId,
        input.organizationId,
        input.expectedTaskVersion,
        input.generation,
        input.taskId,
        input.organizationId,
        input.generation,
        input.status
      ),
  ]);
  if (!changedExactlyOneRow(attemptUpdate)) {
    const currentTask = await requireTask(input);
    if (currentTask.version !== input.expectedTaskVersion) {
      throw new CenterAgentTaskVersionConflictError({
        actualVersion: currentTask.version,
        expectedVersion: input.expectedTaskVersion,
      });
    }
    throw new CenterAgentTaskAttemptConflictError(
      "The attempt could not be transitioned from its current state."
    );
  }

  const updatedAttempt = await requireAttemptGeneration(input);
  const updatedTask = await requireTask(input);
  if (!changedExactlyOneRow(taskUpdate)) {
    return {
      attempt: updatedAttempt,
      outcome: "stale_generation",
      task: updatedTask,
    };
  }
  return { attempt: updatedAttempt, outcome: "updated", task: updatedTask };
}

async function readTaskByIdempotencyKey(input: {
  db: D1Database;
  idempotencyKey: string;
  organizationId: string;
  requesterUserId: string | null;
}): Promise<CenterAgentTask | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${TASK_SELECT_COLUMNS}
        FROM center_agent_tasks
        WHERE organization_id = ?
          AND requester_user_id IS ?
          AND idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.requesterUserId, input.idempotencyKey)
    .first<TaskRow>();
  return row ? mapTaskRow(row) : null;
}

async function requireTask(input: {
  db: D1Database;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTask> {
  const task = await readCenterAgentTask(input);
  if (!task) {
    throw new CenterAgentTaskNotFoundError(input.taskId);
  }
  return task;
}

async function readAttemptByIdempotencyKey(input: {
  db: D1Database;
  idempotencyKey: string;
  taskId: string;
}): Promise<CenterAgentTaskAttempt | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${ATTEMPT_SELECT_COLUMNS}
        FROM center_agent_task_attempts
        WHERE task_id = ? AND idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.taskId, input.idempotencyKey)
    .first<AttemptRow>();
  return row ? mapAttemptRow(row) : null;
}

async function readAttemptByIdOrIdempotencyKey(input: {
  attemptId: string;
  db: D1Database;
  idempotencyKey: string;
  taskId: string;
}): Promise<CenterAgentTaskAttempt | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${ATTEMPT_SELECT_COLUMNS}
        FROM center_agent_task_attempts
        WHERE id = ? OR (task_id = ? AND idempotency_key = ?)
        LIMIT 1
      `
    )
    .bind(input.attemptId, input.taskId, input.idempotencyKey)
    .first<AttemptRow>();
  return row ? mapAttemptRow(row) : null;
}

async function requireAttemptGeneration(input: {
  db: D1Database;
  generation: number;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTaskAttempt> {
  const row = await input.db
    .prepare(
      `
        SELECT ${ATTEMPT_SELECT_COLUMNS}
        FROM center_agent_task_attempts
        WHERE task_id = ? AND organization_id = ? AND generation = ?
        LIMIT 1
      `
    )
    .bind(input.taskId, input.organizationId, input.generation)
    .first<AttemptRow>();
  if (!row) {
    throw new CenterAgentTaskAttemptConflictError(
      `Attempt generation ${input.generation} does not exist for the task.`
    );
  }
  return mapAttemptRow(row);
}

async function readEventByIdempotencyKey(input: {
  db: D1Database;
  idempotencyKey: string;
  taskId: string;
}): Promise<StoredEvent | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${EVENT_SELECT_COLUMNS}
        FROM center_agent_task_events
        WHERE task_id = ? AND idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.taskId, input.idempotencyKey)
    .first<EventRow>();
  return row ? mapStoredEventRow(row) : null;
}

async function readEventByIdOrIdempotencyKey(input: {
  db: D1Database;
  eventId: string;
  idempotencyKey: string;
  taskId: string;
}): Promise<StoredEvent | null> {
  const row = await input.db
    .prepare(
      `
        SELECT ${EVENT_SELECT_COLUMNS}
        FROM center_agent_task_events
        WHERE id = ? OR (task_id = ? AND idempotency_key = ?)
        LIMIT 1
      `
    )
    .bind(input.eventId, input.taskId, input.idempotencyKey)
    .first<EventRow>();
  return row ? mapStoredEventRow(row) : null;
}

function mapTaskRow(row: TaskRow): CenterAgentTask {
  const originAttribution = parseOriginAttribution(row.origin_attribution_json);
  const origin =
    row.origin_kind === "open_meld"
      ? { ...originAttribution, kind: "open_meld" as const }
      : {
          ...originAttribution,
          destination: parseOriginDestination(row.origin_destination_json),
          kind: "message_channel" as const,
        };
  return centerAgentTaskSchema.parse({
    activeAttemptGeneration: row.active_attempt_generation,
    createdAt: toIsoDateTime(row.created_at_ms),
    finishedAt:
      row.finished_at_ms === null ? null : toIsoDateTime(row.finished_at_ms),
    goal: row.goal,
    id: row.id,
    organizationId: row.organization_id,
    origin,
    requesterUserId: row.requester_user_id,
    status: row.status,
    title: row.title,
    updatedAt: toIsoDateTime(row.updated_at_ms),
    version: row.version,
  });
}

function serializeTaskOriginAttribution(
  origin: CenterAgentTaskOrigin
): string | null {
  const attribution = {
    ...(origin.requestedBy ? { requestedBy: origin.requestedBy } : {}),
    ...(origin.kind === "open_meld" && origin.localAgent
      ? { localAgent: origin.localAgent }
      : {}),
  };
  return Object.keys(attribution).length > 0
    ? JSON.stringify(attribution)
    : null;
}

function parseOriginAttribution(value: string | null): Record<string, unknown> {
  if (value === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Center Agent Task origin attribution is invalid.");
  }
  if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
    throw new Error("Center Agent Task origin attribution is invalid.");
  }
  return parsed as Record<string, unknown>;
}

function parseOriginDestination(value: string | null): unknown {
  if (value === null) {
    throw new Error(
      "Center Agent Task Message Channel origin is missing its destination."
    );
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(
      "Center Agent Task Message Channel origin has an invalid destination."
    );
  }
}

function mapAttemptRow(row: AttemptRow): CenterAgentTaskAttempt {
  return centerAgentTaskAttemptSchema.parse({
    createdAt: toIsoDateTime(row.created_at_ms),
    failureCode: row.failure_code,
    finishedAt:
      row.finished_at_ms === null ? null : toIsoDateTime(row.finished_at_ms),
    generation: row.generation,
    id: row.id,
    startedAt:
      row.started_at_ms === null ? null : toIsoDateTime(row.started_at_ms),
    status: row.status,
    taskHandle: agentTaskHandleSchema.parse(JSON.parse(row.task_handle_json)),
    taskId: row.task_id,
  });
}

function mapStoredEventRow(row: EventRow): StoredEvent {
  return {
    event: centerAgentTaskEventSchema.parse({
      actor: row.actor,
      attemptGeneration: row.attempt_generation,
      id: row.id,
      kind: row.kind,
      occurredAt: toIsoDateTime(row.occurred_at_ms),
      taskId: row.task_id,
      text: row.text,
    }),
    idempotencyKey: row.idempotency_key,
    observedAtMs: row.observed_at_ms,
    organizationId: row.organization_id,
  };
}

function isSameTaskCreation(
  existing: CenterAgentTask,
  candidate: CenterAgentTask
): boolean {
  return (
    existing.id === candidate.id &&
    existing.organizationId === candidate.organizationId &&
    existing.requesterUserId === candidate.requesterUserId &&
    existing.title === candidate.title &&
    existing.goal === candidate.goal &&
    JSON.stringify(existing.origin) === JSON.stringify(candidate.origin)
  );
}

function isSameEvent(
  existing: StoredEvent,
  candidate: CenterAgentTaskEvent,
  organizationId: string,
  observedAtMs: number
): boolean {
  return (
    existing.organizationId === organizationId &&
    existing.observedAtMs === observedAtMs &&
    existing.event.id === candidate.id &&
    existing.event.taskId === candidate.taskId &&
    existing.event.attemptGeneration === candidate.attemptGeneration &&
    existing.event.kind === candidate.kind &&
    existing.event.actor === candidate.actor &&
    existing.event.text === candidate.text &&
    existing.event.occurredAt === candidate.occurredAt
  );
}

function isSameProjectedAttemptEvent(
  existing: StoredEvent,
  candidate: CenterAgentTaskEvent,
  organizationId: string
): boolean {
  return (
    existing.organizationId === organizationId &&
    existing.event.id === candidate.id &&
    existing.event.taskId === candidate.taskId &&
    existing.event.attemptGeneration === candidate.attemptGeneration &&
    existing.event.kind === candidate.kind &&
    existing.event.actor === candidate.actor &&
    existing.event.text === candidate.text
  );
}

function assertSameStopIntent(
  existing: StoredEvent,
  candidate: CenterAgentTaskEvent,
  organizationId: string
): void {
  if (
    existing.organizationId === organizationId &&
    existing.event.id === candidate.id &&
    existing.event.taskId === candidate.taskId &&
    existing.event.attemptGeneration === candidate.attemptGeneration &&
    existing.event.kind === "stop_requested" &&
    existing.event.actor === candidate.actor &&
    existing.event.text === candidate.text
  ) {
    return;
  }
  throw new CenterAgentTaskEventConflictError(
    "The Stop intent idempotency key is already bound to different event data."
  );
}

async function requireReplacementInstructionReplay(input: {
  candidate: CenterAgentTaskEvent;
  db: D1Database;
  idempotencyKey: string;
  organizationId: string;
  taskId: string;
}): Promise<CenterAgentTaskEvent> {
  const existing = await readEventByIdempotencyKey({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    taskId: input.taskId,
  });
  if (
    existing?.organizationId !== input.organizationId ||
    existing.event.id !== input.candidate.id ||
    existing.event.taskId !== input.candidate.taskId ||
    existing.event.attemptGeneration !== null ||
    existing.event.kind !== "requester_message" ||
    existing.event.actor !== "requester" ||
    existing.event.text !== input.candidate.text
  ) {
    throw new CenterAgentTaskEventConflictError(
      "The replacement instruction idempotency key is already bound to different event data."
    );
  }
  return existing.event;
}

function isStopRequestableStatus(status: CenterAgentTaskStatus): boolean {
  return (
    status === "needs_attention" || status === "queued" || status === "running"
  );
}

function requireExpectedVersion(
  task: CenterAgentTask,
  expectedVersion: number
): void {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new RangeError("expectedTaskVersion must be a positive integer.");
  }
  if (task.version !== expectedVersion) {
    throw new CenterAgentTaskVersionConflictError({
      actualVersion: task.version,
      expectedVersion,
    });
  }
}

function parseTimestampMs(value: number, field: string): number {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError(`${field} must be a non-negative integer.`);
  }
  return value;
}

function parseRequiredText(value: string, field: string): string {
  const parsed = value.trim();
  if (parsed.length === 0) {
    throw new TypeError(`${field} must not be blank.`);
  }
  return parsed;
}

function parseListLimit(value: number): number {
  if (!(Number.isSafeInteger(value) && value >= 1 && value <= 100)) {
    throw new RangeError("limit must be an integer from 1 through 100.");
  }
  return value;
}

function toIsoDateTime(timestampMs: number): string {
  return new Date(parseTimestampMs(timestampMs, "timestampMs")).toISOString();
}

function changedExactlyOneRow(result: D1Result | undefined): boolean {
  return Number(result?.meta.changes ?? 0) === 1;
}
