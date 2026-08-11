import {
  agentTaskCompletionConditionSchema,
  agentTaskCompletionObservationSchema,
  agentTaskContinuationSchema,
  agentTaskHandleSchema,
  agentTaskNeedsAttentionObservationSchema,
  agentTaskTerminalOutcomeSchema,
  areAgentTaskTerminalOutcomesEqual,
  buildAgentTaskKey,
} from "@openmeld/schemas";
import type {
  AgentTaskCompletionCondition,
  AgentTaskCompletionObservation,
  AgentTaskContinuation,
  AgentTaskHandle,
  AgentTaskNeedsAttentionObservation,
  AgentTaskTerminalOutcome,
  SubmitAgentControllerTaskLifecycleEventItem,
} from "@openmeld/schemas/types";
import {
  type AgentDelegationRecord,
  cancelAgentDelegationsByParentTask,
  readAgentDelegation,
  readAgentDelegationByChildTask,
} from "./agent-delegation-repo";

export type AgentTaskCompletionSubscriptionState =
  | "pending"
  | "ready"
  | "continuation_claimed"
  | "settled"
  | "cancelled";

export class AgentControllerTaskRegistrationMissingError extends Error {
  constructor() {
    super(
      "The exact Agent Controller task registration is no longer available."
    );
    this.name = "AgentControllerTaskRegistrationMissingError";
  }
}

export type AgentTaskCompletionSubscriptionRecord = {
  claimExpiresAtMs: number | null;
  claimId: string | null;
  completionCondition: AgentTaskCompletionCondition;
  continuation: AgentTaskContinuation | null;
  continuationIdempotencyKey: string | null;
  continuationTask: AgentTaskHandle | null;
  createdAtMs: number;
  idempotencyKey: string;
  lastEventId: string | null;
  observerTask: AgentTaskHandle;
  organizationId: string;
  outcome: AgentTaskCompletionObservation | null;
  settledAtMs: number | null;
  state: AgentTaskCompletionSubscriptionState;
  subscriptionId: string;
  updatedAtMs: number;
  watchedTask: AgentTaskHandle;
};

type AgentTaskCompletionSubscriptionRow = {
  claim_expires_at_ms: number | null;
  claim_id: string | null;
  completion_condition: string;
  continuation_idempotency_key: string | null;
  continuation_json: string | null;
  continuation_task_handle_json: string | null;
  continuation_task_key: string | null;
  created_at_ms: number;
  idempotency_key: string;
  last_event_id: string | null;
  observer_task_handle_json: string;
  observer_task_key: string;
  organization_id: string;
  outcome_json: string | null;
  settled_at_ms: number | null;
  state: AgentTaskCompletionSubscriptionState;
  subscription_id: string;
  updated_at_ms: number;
  watched_task_handle_json: string;
  watched_task_key: string;
};

type AgentTaskTerminalOutcomeRow = {
  event_id: string;
  observed_at_ms: number;
  occurred_at_ms: number;
  outcome_json: string;
  status: string;
  task_handle_json: string;
  task_key: string;
};

type AgentTaskNeedsAttentionObservationRow = {
  event_id: string;
  observation_json: string;
  observed_at_ms: number;
  occurred_at_ms: number;
  status: string;
  task_handle_json: string;
  task_key: string;
};

function isDelegationManagedSubscription(
  subscription: AgentTaskCompletionSubscriptionRecord
): boolean {
  return (
    subscription.continuation === null ||
    subscription.continuation.kind === "resume_agent" ||
    subscription.continuation.kind === "activate_fallback"
  );
}

export async function registerAgentTaskCompletionSubscription(input: {
  completionCondition: AgentTaskCompletionCondition;
  continuation: AgentTaskContinuation | null;
  controllerTaskRegistration?: {
    ownerUserId: string;
    registrationSource: SubmitAgentControllerTaskLifecycleEventItem["source"];
  };
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  observerTask: AgentTaskHandle;
  organizationId: string;
  subscriptionId: string;
  watchedTask: AgentTaskHandle;
}): Promise<AgentTaskCompletionSubscriptionRecord> {
  const completionCondition = agentTaskCompletionConditionSchema.parse(
    input.completionCondition
  );
  const continuation =
    input.continuation === null
      ? null
      : agentTaskContinuationSchema.parse(input.continuation);
  const observerTask = agentTaskHandleSchema.parse(input.observerTask);
  const watchedTask = agentTaskHandleSchema.parse(input.watchedTask);
  const controllerTaskRegistration =
    watchedTask.kind === "controller_task"
      ? requireControllerTaskRegistration(input.controllerTaskRegistration)
      : null;
  const subscriptionId = requireNonEmpty(
    input.subscriptionId,
    "subscriptionId"
  );
  const idempotencyKey = requireNonEmpty(
    input.idempotencyKey,
    "idempotencyKey"
  );
  const organizationId = requireNonEmpty(
    input.organizationId,
    "organizationId"
  );
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const observerTaskKey = buildAgentTaskKey(observerTask);
  const watchedTaskKey = buildAgentTaskKey(watchedTask);
  const continuationIdempotencyKey =
    continuation === null
      ? null
      : buildContinuationIdempotencyKey(subscriptionId);

  await buildAgentTaskCompletionSubscriptionInsert({
    completionCondition,
    continuation,
    continuationIdempotencyKey,
    controllerTaskRegistration,
    db: input.db,
    idempotencyKey,
    nowMs,
    observerTask,
    observerTaskKey,
    organizationId,
    subscriptionId,
    watchedTask,
    watchedTaskKey,
  }).run();

  const inserted = await readAgentTaskCompletionSubscriptionByIdempotencyKey({
    db: input.db,
    idempotencyKey,
  });
  if (!inserted) {
    throwMissingAgentTaskCompletionSubscription(watchedTask);
  }
  assertIdempotentRegistration(inserted, {
    completionCondition,
    continuation,
    continuationIdempotencyKey,
    observerTaskKey,
    organizationId,
    subscriptionId,
    watchedTaskKey,
  });

  if (inserted.state !== "pending") {
    return inserted;
  }

  return resolvePendingAgentTaskCompletionSubscription({
    completionCondition,
    continuation,
    db: input.db,
    inserted,
    nowMs,
    observerTaskKey,
    watchedTask,
    watchedTaskKey,
  });
}

async function resolvePendingAgentTaskCompletionSubscription(input: {
  completionCondition: AgentTaskCompletionCondition;
  continuation: AgentTaskContinuation | null;
  db: D1Database;
  inserted: AgentTaskCompletionSubscriptionRecord;
  nowMs: number;
  observerTaskKey: string;
  watchedTask: AgentTaskHandle;
  watchedTaskKey: string;
}): Promise<AgentTaskCompletionSubscriptionRecord> {
  const observerTerminalOutcome = await readAgentTaskTerminalOutcome({
    db: input.db,
    taskKey: input.observerTaskKey,
  });
  if (observerTerminalOutcome?.outcome.status === "stopped") {
    const cancelled = await cancelAgentTaskCompletionSubscription({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: input.inserted.subscriptionId,
    });
    if (!cancelled) {
      throw new Error(
        "Agent Task completion subscription parent-stop cancellation lost its row"
      );
    }
    return cancelled;
  }
  const delegation = await readAgentDelegationByChildTask({
    db: input.db,
    task: input.watchedTask,
  });
  const delegationChild = delegation?.children.find(
    (child) => buildAgentTaskKey(child.task) === input.watchedTaskKey
  );
  if (
    delegation &&
    buildAgentTaskKey(delegation.parentTask) === input.observerTaskKey &&
    delegationChild?.state === "skipped"
  ) {
    await settlePendingSubscriptionWithoutContinuation({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: input.inserted.subscriptionId,
    });
    return requireAgentTaskCompletionSubscription({
      db: input.db,
      subscriptionId: input.inserted.subscriptionId,
    });
  }
  if (
    delegation &&
    buildAgentTaskKey(delegation.parentTask) === input.observerTaskKey &&
    delegationChild?.state === "cancelled"
  ) {
    const cancelled = await cancelAgentTaskCompletionSubscription({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: input.inserted.subscriptionId,
    });
    if (!cancelled) {
      throw new Error(
        "Agent Task completion subscription cancellation lost its row"
      );
    }
    return cancelled;
  }
  const terminalOutcome = await readAgentTaskTerminalOutcome({
    db: input.db,
    taskKey: input.watchedTaskKey,
  });
  if (!terminalOutcome) {
    const needsAttentionObservation =
      input.completionCondition === "needs_attention"
        ? await readLatestAgentTaskNeedsAttentionObservation({
            db: input.db,
            taskKey: input.watchedTaskKey,
          })
        : null;
    if (!needsAttentionObservation) {
      return input.inserted;
    }
    await settlePendingSubscriptionFromOutcome({
      shouldContinue: input.continuation !== null,
      db: input.db,
      nowMs: input.nowMs,
      outcome: needsAttentionObservation.observation,
      subscriptionId: input.inserted.subscriptionId,
    });
    return requireAgentTaskCompletionSubscription({
      db: input.db,
      subscriptionId: input.inserted.subscriptionId,
    });
  }

  if (
    delegation &&
    buildAgentTaskKey(delegation.parentTask) === input.observerTaskKey &&
    isDelegationManagedSubscription(input.inserted)
  ) {
    await projectLateDelegationSubscription({
      db: input.db,
      delegation,
      nowMs: input.nowMs,
      outcome: terminalOutcome.outcome,
      task: input.watchedTask,
      taskKey: input.watchedTaskKey,
    });
  } else {
    await settlePendingSubscriptionFromOutcome({
      shouldContinue:
        input.continuation !== null &&
        doesTerminalOutcomeMatchCondition(
          terminalOutcome.outcome,
          input.completionCondition
        ),
      db: input.db,
      nowMs: input.nowMs,
      outcome: terminalOutcome.outcome,
      subscriptionId: input.inserted.subscriptionId,
    });
  }
  return requireAgentTaskCompletionSubscription({
    db: input.db,
    subscriptionId: input.inserted.subscriptionId,
  });
}

function buildAgentTaskCompletionSubscriptionInsert(input: {
  completionCondition: AgentTaskCompletionCondition;
  continuation: AgentTaskContinuation | null;
  continuationIdempotencyKey: string | null;
  controllerTaskRegistration: {
    ownerUserId: string;
    registrationSource: SubmitAgentControllerTaskLifecycleEventItem["source"];
  } | null;
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  observerTask: AgentTaskHandle;
  observerTaskKey: string;
  organizationId: string;
  subscriptionId: string;
  watchedTask: AgentTaskHandle;
  watchedTaskKey: string;
}): D1PreparedStatement {
  const insertionSql =
    input.watchedTask.kind === "controller_task"
      ? `
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM agent_controller_tasks
          WHERE task_key = ?
            AND organization_id = ?
            AND owner_user_id = ?
            AND registration_source = ?
        )
      `
      : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)";
  const bindings: unknown[] = [
    input.subscriptionId,
    input.idempotencyKey,
    input.organizationId,
    input.watchedTaskKey,
    serializeJson(input.watchedTask),
    input.observerTaskKey,
    serializeJson(input.observerTask),
    input.completionCondition,
    input.continuation === null ? null : serializeJson(input.continuation),
    input.continuationIdempotencyKey,
    input.nowMs,
    input.nowMs,
  ];
  if (input.watchedTask.kind === "controller_task") {
    if (!input.controllerTaskRegistration) {
      throw new AgentControllerTaskRegistrationMissingError();
    }
    bindings.push(
      input.watchedTaskKey,
      input.organizationId,
      input.controllerTaskRegistration.ownerUserId,
      input.controllerTaskRegistration.registrationSource
    );
  }
  return input.db
    .prepare(
      `
        INSERT INTO agent_task_completion_subscriptions (
          subscription_id,
          idempotency_key,
          organization_id,
          watched_task_key,
          watched_task_handle_json,
          observer_task_key,
          observer_task_handle_json,
          completion_condition,
          continuation_json,
          continuation_idempotency_key,
          state,
          created_at_ms,
          updated_at_ms
        )
        ${insertionSql}
        ON CONFLICT(idempotency_key) DO NOTHING
      `
    )
    .bind(...bindings);
}

function requireControllerTaskRegistration(
  input:
    | {
        ownerUserId: string;
        registrationSource: SubmitAgentControllerTaskLifecycleEventItem["source"];
      }
    | undefined
) {
  if (!input) {
    throw new AgentControllerTaskRegistrationMissingError();
  }
  return {
    ownerUserId: requireNonEmpty(input.ownerUserId, "ownerUserId"),
    registrationSource: input.registrationSource,
  };
}

function throwMissingAgentTaskCompletionSubscription(
  watchedTask: AgentTaskHandle
): never {
  if (watchedTask.kind === "controller_task") {
    throw new AgentControllerTaskRegistrationMissingError();
  }
  throw new Error("Agent Task completion subscription write lost its row");
}

async function projectLateDelegationSubscription(input: {
  db: D1Database;
  delegation: AgentDelegationRecord;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle;
  taskKey: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE agent_delegation_children
        SET
          state = 'terminal',
          terminal_outcome_json = ?,
          terminal_at_ms = COALESCE(terminal_at_ms, ?),
          updated_at_ms = ?
        WHERE task_key = ?
          AND state IN ('planned', 'active')
      `
    )
    .bind(serializeJson(input.outcome), input.nowMs, input.nowMs, input.taskKey)
    .run();
  const pendingSubscriptions =
    await listPendingAgentTaskCompletionSubscriptionsByWatchedTask({
      db: input.db,
      taskKey: input.taskKey,
    });
  await projectDelegationTerminalOutcome({
    db: input.db,
    delegation:
      (await readAgentDelegation({
        db: input.db,
        delegationId: input.delegation.delegationId,
      })) ?? input.delegation,
    nowMs: input.nowMs,
    outcome: input.outcome,
    subscriptions: pendingSubscriptions.filter(isDelegationManagedSubscription),
    task: input.task,
  });
}

type RecordedAgentTaskTerminalOutcome = {
  observedAtMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle;
};

type AgentTaskTerminalOutcomeProjection = {
  cancelledChildTasks: AgentTaskHandle[];
  cancelledContinuationIdempotencyKeys: string[];
  newlyReadySubscriptionIds: string[];
  outcome: AgentTaskTerminalOutcome;
  readySubscriptionIds: string[];
};

async function insertAndReadAgentTaskTerminalOutcome(input: {
  db: D1Database;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle;
}): Promise<RecordedAgentTaskTerminalOutcome> {
  const task = agentTaskHandleSchema.parse(input.task);
  const outcome = agentTaskTerminalOutcomeSchema.parse(input.outcome);
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const taskKey = buildAgentTaskKey(task);

  await input.db
    .prepare(
      `
        INSERT INTO agent_task_terminal_outcomes (
          task_key,
          task_handle_json,
          status,
          event_id,
          outcome_json,
          occurred_at_ms,
          observed_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_key) DO NOTHING
      `
    )
    .bind(
      taskKey,
      serializeJson(task),
      outcome.status,
      outcome.eventId,
      serializeJson(outcome),
      outcome.occurredAtMs,
      nowMs
    )
    .run();

  const stored = await readAgentTaskTerminalOutcome({
    db: input.db,
    taskKey,
  });
  if (!stored) {
    throw new Error("Agent Task terminal outcome write lost its row");
  }
  if (buildAgentTaskKey(stored.task) !== taskKey) {
    throw new Error("Agent Task terminal outcome task identity drifted");
  }
  return stored;
}

async function projectAgentTaskTerminalOutcome(input: {
  db: D1Database;
  nowMs: number;
  stored: RecordedAgentTaskTerminalOutcome;
}): Promise<AgentTaskTerminalOutcomeProjection> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const task = input.stored.task;
  const taskKey = buildAgentTaskKey(task);
  const storedOutcome = input.stored.outcome;
  const cancelledDelegationWork =
    storedOutcome.status === "stopped"
      ? await cancelAgentDelegationsByParentTask({
          db: input.db,
          nowMs,
          parentTask: task,
        })
      : { childTasks: [], continuationIdempotencyKeys: [] };
  const cancelledTaskWatchWork =
    storedOutcome.status === "stopped"
      ? await cancelAgentTaskWatchSubscriptionsByObserverTask({
          db: input.db,
          nowMs,
          observerTask: task,
        })
      : { continuationIdempotencyKeys: [] };

  await input.db
    .prepare(
      `
        UPDATE agent_delegation_children
        SET
          state = 'terminal',
          terminal_outcome_json = ?,
          terminal_at_ms = COALESCE(terminal_at_ms, ?),
          updated_at_ms = ?
        WHERE task_key = ?
          AND state IN ('planned', 'active')
      `
    )
    .bind(serializeJson(storedOutcome), nowMs, nowMs, taskKey)
    .run();

  const pendingSubscriptions =
    await listPendingAgentTaskCompletionSubscriptionsByWatchedTask({
      db: input.db,
      taskKey,
    });
  const delegation = await readAgentDelegationByChildTask({
    db: input.db,
    task,
  });
  const delegationSubscriptions = delegation
    ? pendingSubscriptions.filter(
        (subscription) =>
          buildAgentTaskKey(subscription.observerTask) ===
            buildAgentTaskKey(delegation.parentTask) &&
          isDelegationManagedSubscription(subscription)
      )
    : [];
  const delegationSubscriptionIds = new Set(
    delegationSubscriptions.map((subscription) => subscription.subscriptionId)
  );
  const newlyReadySubscriptionIds = delegation
    ? await projectDelegationTerminalOutcome({
        db: input.db,
        delegation,
        nowMs,
        outcome: storedOutcome,
        subscriptions: delegationSubscriptions,
        task,
      })
    : [];
  for (const subscription of pendingSubscriptions) {
    if (delegationSubscriptionIds.has(subscription.subscriptionId)) {
      continue;
    }
    await settlePendingSubscriptionFromOutcome({
      shouldContinue:
        subscription.continuation !== null &&
        doesTerminalOutcomeMatchCondition(
          storedOutcome,
          subscription.completionCondition
        ),
      db: input.db,
      nowMs,
      outcome: storedOutcome,
      subscriptionId: subscription.subscriptionId,
    });
    const current = await readAgentTaskCompletionSubscription({
      db: input.db,
      subscriptionId: subscription.subscriptionId,
    });
    if (current?.state === "ready") {
      newlyReadySubscriptionIds.push(current.subscriptionId);
    }
  }

  const readySubscriptions = await input.db
    .prepare(
      `
        SELECT subscription_id
        FROM agent_task_completion_subscriptions
        WHERE watched_task_key = ?
          AND state = 'ready'
        ORDER BY subscription_id ASC
      `
    )
    .bind(taskKey)
    .all<{ subscription_id: string }>();
  return {
    cancelledChildTasks: cancelledDelegationWork.childTasks,
    cancelledContinuationIdempotencyKeys: [
      ...cancelledDelegationWork.continuationIdempotencyKeys,
      ...cancelledTaskWatchWork.continuationIdempotencyKeys,
    ].filter((value, index, values) => values.indexOf(value) === index),
    newlyReadySubscriptionIds: [...new Set(newlyReadySubscriptionIds)].sort(),
    outcome: storedOutcome,
    readySubscriptionIds: (readySubscriptions.results ?? []).map(
      (row) => row.subscription_id
    ),
  };
}

export async function recordAgentTaskTerminalOutcome(input: {
  db: D1Database;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle;
}): Promise<AgentTaskTerminalOutcomeProjection> {
  const stored = await insertAndReadAgentTaskTerminalOutcome(input);
  return await projectAgentTaskTerminalOutcome({
    db: input.db,
    nowMs: input.nowMs,
    stored,
  });
}

export async function recordAgentTaskTerminalOutcomeIfMatching(input: {
  db: D1Database;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle;
}): Promise<
  | ({ matches: true } & AgentTaskTerminalOutcomeProjection)
  | {
      matches: false;
      outcome: AgentTaskTerminalOutcome;
    }
> {
  const stored = await insertAndReadAgentTaskTerminalOutcome(input);
  if (!areAgentTaskTerminalOutcomesEqual(stored.outcome, input.outcome)) {
    return { matches: false, outcome: stored.outcome };
  }
  return {
    matches: true,
    ...(await projectAgentTaskTerminalOutcome({
      db: input.db,
      nowMs: input.nowMs,
      stored,
    })),
  };
}

export async function recordAgentTaskNeedsAttentionObservation(input: {
  db: D1Database;
  nowMs: number;
  observation: AgentTaskNeedsAttentionObservation;
  task: AgentTaskHandle;
}): Promise<{
  newlyReadySubscriptionIds: string[];
  readySubscriptionIds: string[];
}> {
  const task = agentTaskHandleSchema.parse(input.task);
  const observation = agentTaskNeedsAttentionObservationSchema.parse(
    input.observation
  );
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const taskKey = buildAgentTaskKey(task);
  await input.db
    .prepare(
      `
        INSERT INTO agent_task_needs_attention_observations (
          task_key,
          event_id,
          task_handle_json,
          status,
          observation_json,
          occurred_at_ms,
          observed_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_key, event_id) DO NOTHING
      `
    )
    .bind(
      taskKey,
      observation.eventId,
      serializeJson(task),
      observation.status,
      serializeJson(observation),
      observation.occurredAtMs,
      nowMs
    )
    .run();
  const stored = await readAgentTaskNeedsAttentionObservation({
    db: input.db,
    eventId: observation.eventId,
    taskKey,
  });
  if (!stored) {
    throw new Error(
      "Agent Task needs-attention observation write lost its row"
    );
  }
  if (
    buildAgentTaskKey(stored.task) !== taskKey ||
    stored.observation.eventId !== observation.eventId ||
    stored.observation.status !== observation.status ||
    stored.observation.attentionCode !== observation.attentionCode ||
    stored.observation.occurredAtMs !== observation.occurredAtMs
  ) {
    throw new Error(
      "Agent Task needs-attention observation conflicts with the stored event"
    );
  }
  const pendingSubscriptions =
    await listPendingAgentTaskCompletionSubscriptionsByWatchedTask({
      db: input.db,
      taskKey,
    });
  const newlyReadySubscriptionIds: string[] = [];
  for (const subscription of pendingSubscriptions) {
    if (
      subscription.completionCondition !== "needs_attention" ||
      (stored.observedAtMs > subscription.createdAtMs &&
        stored.observation.occurredAtMs < subscription.createdAtMs)
    ) {
      continue;
    }
    await settlePendingSubscriptionFromOutcome({
      db: input.db,
      nowMs,
      outcome: stored.observation,
      shouldContinue: subscription.continuation !== null,
      subscriptionId: subscription.subscriptionId,
    });
    const current = await readAgentTaskCompletionSubscription({
      db: input.db,
      subscriptionId: subscription.subscriptionId,
    });
    if (current?.state === "ready") {
      newlyReadySubscriptionIds.push(current.subscriptionId);
    }
  }
  const readySubscriptions = await input.db
    .prepare(
      `
        SELECT subscription_id
        FROM agent_task_completion_subscriptions
        WHERE watched_task_key = ?
          AND state = 'ready'
        ORDER BY subscription_id ASC
      `
    )
    .bind(taskKey)
    .all<{ subscription_id: string }>();
  return {
    newlyReadySubscriptionIds: [...new Set(newlyReadySubscriptionIds)].sort(),
    readySubscriptionIds: (readySubscriptions.results ?? []).map(
      (row) => row.subscription_id
    ),
  };
}

type RecordedAgentTaskNeedsAttentionObservation = {
  observation: AgentTaskNeedsAttentionObservation;
  observedAtMs: number;
  task: AgentTaskHandle;
};

async function readLatestAgentTaskNeedsAttentionObservation(input: {
  db: D1Database;
  taskKey: string;
}): Promise<RecordedAgentTaskNeedsAttentionObservation | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM agent_task_needs_attention_observations
        WHERE task_key = ?
        ORDER BY occurred_at_ms DESC, event_id DESC
        LIMIT 1
      `
    )
    .bind(input.taskKey)
    .first<AgentTaskNeedsAttentionObservationRow>();
  return row ? parseAgentTaskNeedsAttentionObservationRow(row) : null;
}

async function readAgentTaskNeedsAttentionObservation(input: {
  db: D1Database;
  eventId: string;
  taskKey: string;
}): Promise<RecordedAgentTaskNeedsAttentionObservation | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM agent_task_needs_attention_observations
        WHERE task_key = ?
          AND event_id = ?
        LIMIT 1
      `
    )
    .bind(input.taskKey, input.eventId)
    .first<AgentTaskNeedsAttentionObservationRow>();
  return row ? parseAgentTaskNeedsAttentionObservationRow(row) : null;
}

function parseAgentTaskNeedsAttentionObservationRow(
  row: AgentTaskNeedsAttentionObservationRow
): RecordedAgentTaskNeedsAttentionObservation {
  const task = agentTaskHandleSchema.parse(parseJson(row.task_handle_json));
  const observation = agentTaskNeedsAttentionObservationSchema.parse(
    parseJson(row.observation_json)
  );
  if (
    row.task_key !== buildAgentTaskKey(task) ||
    row.event_id !== observation.eventId ||
    row.status !== observation.status ||
    row.occurred_at_ms !== observation.occurredAtMs
  ) {
    throw new Error(
      "Agent Task needs-attention observation storage is inconsistent"
    );
  }
  return {
    observation,
    observedAtMs: requireTimestamp(row.observed_at_ms, "observedAtMs"),
    task,
  };
}

export async function readAgentTaskCompletionSubscription(input: {
  db: D1Database;
  subscriptionId: string;
}): Promise<AgentTaskCompletionSubscriptionRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM agent_task_completion_subscriptions
        WHERE subscription_id = ?
        LIMIT 1
      `
    )
    .bind(requireNonEmpty(input.subscriptionId, "subscriptionId"))
    .first<AgentTaskCompletionSubscriptionRow>();
  return row ? parseSubscriptionRow(row) : null;
}

export async function listAgentTaskCompletionSubscriptionsNeedingEnqueue(input: {
  db: D1Database;
  limit: number;
  nowMs: number;
}): Promise<string[]> {
  const limit = requirePositiveInteger(input.limit, "limit");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const rows = await input.db
    .prepare(
      `
        SELECT subscription_id
        FROM agent_task_completion_subscriptions
        WHERE state = 'ready'
          OR (
            state = 'continuation_claimed'
            AND claim_expires_at_ms <= ?
          )
        ORDER BY updated_at_ms ASC, subscription_id ASC
        LIMIT ?
      `
    )
    .bind(nowMs, limit)
    .all<{ subscription_id: string }>();
  return (rows.results ?? []).map((row) => row.subscription_id);
}

export async function cancelAgentTaskCompletionSubscription(input: {
  db: D1Database;
  nowMs: number;
  subscriptionId: string;
}): Promise<AgentTaskCompletionSubscriptionRecord | null> {
  const subscriptionId = requireNonEmpty(
    input.subscriptionId,
    "subscriptionId"
  );
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET
          state = 'cancelled',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?,
          settled_at_ms = COALESCE(settled_at_ms, ?)
        WHERE subscription_id = ?
          AND state IN ('pending', 'ready', 'continuation_claimed')
      `
    )
    .bind(nowMs, nowMs, subscriptionId)
    .run();
  return await readAgentTaskCompletionSubscription({
    db: input.db,
    subscriptionId,
  });
}

export async function cancelAgentTaskWatchSubscriptionsByObserverTask(input: {
  db: D1Database;
  nowMs: number;
  observerTask: AgentTaskHandle;
}): Promise<{ continuationIdempotencyKeys: string[] }> {
  const observerTaskKey = buildAgentTaskKey(input.observerTask);
  const continuationRows = await input.db
    .prepare(
      `
        SELECT continuation_idempotency_key
        FROM agent_task_completion_subscriptions
        WHERE observer_task_key = ?
          AND json_extract(continuation_json, '$.kind') = 'resume_task_watch'
          AND continuation_idempotency_key IS NOT NULL
        ORDER BY subscription_id ASC
      `
    )
    .bind(observerTaskKey)
    .all<{ continuation_idempotency_key: string }>();
  await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET
          state = 'cancelled',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?,
          settled_at_ms = COALESCE(settled_at_ms, ?)
        WHERE observer_task_key = ?
          AND json_extract(continuation_json, '$.kind') = 'resume_task_watch'
          AND state IN ('pending', 'ready', 'continuation_claimed')
      `
    )
    .bind(input.nowMs, input.nowMs, observerTaskKey)
    .run();
  return {
    continuationIdempotencyKeys: (continuationRows.results ?? []).map(
      (row) => row.continuation_idempotency_key
    ),
  };
}

export async function hasAgentTaskResumeContinuationByObserverTask(input: {
  db: D1Database;
  observerTask: AgentTaskHandle;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        SELECT 1 AS found
        FROM agent_task_completion_subscriptions
        WHERE observer_task_key = ?
          AND json_extract(continuation_json, '$.kind') = 'resume_agent'
          AND (
            state IN ('pending', 'ready', 'continuation_claimed')
            OR (
              state = 'settled'
              AND continuation_task_key IS NOT NULL
            )
          )
        LIMIT 1
      `
    )
    .bind(buildAgentTaskKey(input.observerTask))
    .first<{ found: number }>();
  return row?.found === 1;
}

export async function claimReadyAgentTaskCompletionSubscription(input: {
  claimId: string;
  claimLeaseMs: number;
  db: D1Database;
  nowMs: number;
  subscriptionId: string;
}): Promise<AgentTaskCompletionSubscriptionRecord | null> {
  const claimId = requireNonEmpty(input.claimId, "claimId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const claimLeaseMs = requirePositiveInteger(
    input.claimLeaseMs,
    "claimLeaseMs"
  );
  const subscriptionId = requireNonEmpty(
    input.subscriptionId,
    "subscriptionId"
  );
  const claimed = await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET
          state = 'continuation_claimed',
          claim_id = ?,
          claim_expires_at_ms = ?,
          updated_at_ms = ?
        WHERE subscription_id = ?
          AND continuation_json IS NOT NULL
          AND (
            state = 'ready'
            OR (
              state = 'continuation_claimed'
              AND claim_expires_at_ms <= ?
            )
          )
        RETURNING *
      `
    )
    .bind(claimId, nowMs + claimLeaseMs, nowMs, subscriptionId, nowMs)
    .first<AgentTaskCompletionSubscriptionRow>();
  return claimed ? parseSubscriptionRow(claimed) : null;
}

export async function isClaimedAgentTaskContinuationAuthorized(input: {
  claimId: string;
  db: D1Database;
  delegationId: string;
  expectedGeneration: number;
  subscriptionId: string;
}): Promise<boolean> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const subscriptionId = requireNonEmpty(
    input.subscriptionId,
    "subscriptionId"
  );
  const claimId = requireNonEmpty(input.claimId, "claimId");
  const expectedGeneration = requirePositiveInteger(
    input.expectedGeneration,
    "expectedGeneration"
  );
  await input.db
    .prepare(
      `
        UPDATE agent_delegations
        SET
          state = 'completed',
          updated_at_ms = MAX(updated_at_ms, (
            SELECT subscription.updated_at_ms
            FROM agent_task_completion_subscriptions AS subscription
            WHERE subscription.subscription_id = ?
          )),
          completed_at_ms = COALESCE(completed_at_ms, (
            SELECT subscription.updated_at_ms
            FROM agent_task_completion_subscriptions AS subscription
            WHERE subscription.subscription_id = ?
          ))
        WHERE delegation_id = ?
          AND state = 'active'
          AND generation = ?
          AND json_extract(completion_policy_json, '$.mode') = 'resume_parent'
          AND json_extract(completion_policy_json, '$.when') <> 'on_each_terminal'
          AND EXISTS (
            SELECT 1
            FROM agent_task_completion_subscriptions AS subscription
            WHERE subscription.subscription_id = ?
              AND subscription.state = 'continuation_claimed'
              AND subscription.claim_id = ?
              AND json_extract(subscription.continuation_json, '$.kind') = 'resume_agent'
          )
      `
    )
    .bind(
      subscriptionId,
      subscriptionId,
      delegationId,
      expectedGeneration,
      subscriptionId,
      claimId
    )
    .run();
  const row = await input.db
    .prepare(
      `
        SELECT subscription.subscription_id
        FROM agent_task_completion_subscriptions AS subscription
        INNER JOIN agent_delegations AS delegation
          ON delegation.delegation_id = ?
        WHERE subscription.subscription_id = ?
          AND subscription.state = 'continuation_claimed'
          AND subscription.claim_id = ?
          AND delegation.state IN ('active', 'completed')
          AND delegation.generation = ?
          AND NOT EXISTS (
            SELECT 1
            FROM agent_task_terminal_outcomes AS parent_outcome
            WHERE parent_outcome.task_key = delegation.parent_task_key
              AND parent_outcome.status = 'stopped'
          )
        LIMIT 1
      `
    )
    .bind(delegationId, subscriptionId, claimId, expectedGeneration)
    .first<{ subscription_id: string }>();
  return row !== null;
}

export async function isClaimedAgentTaskWatchContinuationAuthorized(input: {
  claimId: string;
  db: D1Database;
  subscriptionId: string;
  watchId: string;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        SELECT subscription_id
        FROM agent_task_completion_subscriptions AS subscription
        WHERE subscription.subscription_id = ?
          AND subscription.state = 'continuation_claimed'
          AND subscription.claim_id = ?
          AND json_extract(subscription.continuation_json, '$.kind') = 'resume_task_watch'
          AND json_extract(subscription.continuation_json, '$.watchId') = ?
          AND NOT EXISTS (
            SELECT 1
            FROM agent_task_terminal_outcomes AS observer_outcome
            WHERE observer_outcome.task_key = subscription.observer_task_key
              AND observer_outcome.status = 'stopped'
          )
        LIMIT 1
      `
    )
    .bind(
      requireNonEmpty(input.subscriptionId, "subscriptionId"),
      requireNonEmpty(input.claimId, "claimId"),
      requireNonEmpty(input.watchId, "watchId")
    )
    .first<{ subscription_id: string }>();
  return row !== null;
}

export async function settleAgentTaskCompletionSubscription(input: {
  claimId: string;
  continuationTask: AgentTaskHandle;
  db: D1Database;
  nowMs: number;
  subscriptionId: string;
}): Promise<AgentTaskCompletionSubscriptionRecord | null> {
  const continuationTask = agentTaskHandleSchema.parse(input.continuationTask);
  const continuationTaskKey = buildAgentTaskKey(continuationTask);
  const subscriptionId = requireNonEmpty(
    input.subscriptionId,
    "subscriptionId"
  );
  const claimId = requireNonEmpty(input.claimId, "claimId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const settled = await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET
          state = 'settled',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          continuation_task_key = ?,
          continuation_task_handle_json = ?,
          updated_at_ms = ?,
          settled_at_ms = ?
        WHERE subscription_id = ?
          AND state = 'continuation_claimed'
          AND claim_id = ?
        RETURNING *
      `
    )
    .bind(
      continuationTaskKey,
      serializeJson(continuationTask),
      nowMs,
      nowMs,
      subscriptionId,
      claimId
    )
    .first<AgentTaskCompletionSubscriptionRow>();
  if (settled) {
    return parseSubscriptionRow(settled);
  }
  const existing = await readAgentTaskCompletionSubscription({
    db: input.db,
    subscriptionId,
  });
  if (
    existing?.state === "settled" &&
    existing.continuationTask &&
    buildAgentTaskKey(existing.continuationTask) === continuationTaskKey
  ) {
    return existing;
  }
  return null;
}

export async function releaseAgentTaskCompletionSubscriptionClaim(input: {
  claimId: string;
  db: D1Database;
  nowMs: number;
  subscriptionId: string;
}): Promise<AgentTaskCompletionSubscriptionRecord | null> {
  const claimId = requireNonEmpty(input.claimId, "claimId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const subscriptionId = requireNonEmpty(
    input.subscriptionId,
    "subscriptionId"
  );
  await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET
          state = 'ready',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE subscription_id = ?
          AND state = 'continuation_claimed'
          AND claim_id = ?
      `
    )
    .bind(nowMs, subscriptionId, claimId)
    .run();
  return await readAgentTaskCompletionSubscription({
    db: input.db,
    subscriptionId,
  });
}

async function projectDelegationTerminalOutcome(input: {
  db: D1Database;
  delegation: AgentDelegationRecord;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  subscriptions: AgentTaskCompletionSubscriptionRecord[];
  task: AgentTaskHandle;
}): Promise<string[]> {
  const taskKey = buildAgentTaskKey(input.task);
  const child = input.delegation.children.find(
    (candidate) => buildAgentTaskKey(candidate.task) === taskKey
  );
  if (!child) {
    throw new Error("Agent delegation lost its exact terminal child");
  }
  for (const subscription of input.subscriptions) {
    await recordPendingSubscriptionOutcome({
      db: input.db,
      nowMs: input.nowMs,
      outcome: input.outcome,
      subscriptionId: subscription.subscriptionId,
    });
  }
  if (input.subscriptions.length === 0) {
    await completeDelegationWhenChildrenAreFinished({
      db: input.db,
      delegationId: input.delegation.delegationId,
      nowMs: input.nowMs,
    });
    return [];
  }

  const activationSubscription = input.subscriptions.find(
    (subscription) => subscription.continuation?.kind === "activate_fallback"
  );
  const resultSubscription = input.subscriptions.find(
    (subscription) =>
      subscription.continuation === null ||
      subscription.continuation.kind === "resume_agent"
  );
  const fallbackChild = input.delegation.children.find(
    (candidate) => candidate.role === "fallback"
  );
  if (
    child.role === "primary" &&
    fallbackChild &&
    !(activationSubscription && resultSubscription)
  ) {
    return [];
  }
  const fallbackResult = await projectPrimaryFallbackTransition({
    activationSubscription,
    childRole: child.role,
    db: input.db,
    delegation: input.delegation,
    fallbackChild,
    nowMs: input.nowMs,
    outcome: input.outcome,
    resultSubscription,
  });
  if (fallbackResult !== null) {
    return fallbackResult;
  }

  if (!resultSubscription) {
    throw new Error("Agent delegation lost its result completion subscription");
  }
  const refreshed =
    (await readAgentDelegation({
      db: input.db,
      delegationId: input.delegation.delegationId,
    })) ?? input.delegation;
  return await projectDelegationCompletionPolicy({
    db: input.db,
    delegation: refreshed,
    nowMs: input.nowMs,
    outcome: input.outcome,
    resultSubscription,
  });
}

async function projectPrimaryFallbackTransition(input: {
  activationSubscription: AgentTaskCompletionSubscriptionRecord | undefined;
  childRole: "fallback" | "primary";
  db: D1Database;
  delegation: AgentDelegationRecord;
  fallbackChild: AgentDelegationRecord["children"][number] | undefined;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  resultSubscription: AgentTaskCompletionSubscriptionRecord | undefined;
}): Promise<string[] | null> {
  if (input.childRole !== "primary" || !input.fallbackChild) {
    return null;
  }
  if (isAuthoritativeFailure(input.outcome)) {
    if (input.resultSubscription) {
      await settlePendingSubscriptionWithoutContinuation({
        db: input.db,
        nowMs: input.nowMs,
        subscriptionId: input.resultSubscription.subscriptionId,
      });
    }
    if (
      input.activationSubscription?.continuation?.kind !== "activate_fallback"
    ) {
      throw new Error(
        "Fallback delegation lost its activation completion subscription"
      );
    }
    const ready = await makePendingSubscriptionReady({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: input.activationSubscription.subscriptionId,
    });
    return ready ? [input.activationSubscription.subscriptionId] : [];
  }

  if (input.activationSubscription) {
    await settlePendingSubscriptionWithoutContinuation({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: input.activationSubscription.subscriptionId,
    });
  }
  await skipFallbackChildAndSubscriptions({
    db: input.db,
    delegation: input.delegation,
    fallbackTask: input.fallbackChild.task,
    nowMs: input.nowMs,
  });
  return null;
}

async function projectDelegationCompletionPolicy(input: {
  db: D1Database;
  delegation: AgentDelegationRecord;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  resultSubscription: AgentTaskCompletionSubscriptionRecord;
}): Promise<string[]> {
  const { delegation, resultSubscription } = input;
  if (delegation.completionPolicy.mode === "child_reports_directly") {
    await settlePendingSubscriptionWithoutContinuation({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: resultSubscription.subscriptionId,
    });
    if (!hasUnfinishedDelegationChildren(delegation)) {
      await completeDelegation({
        db: input.db,
        delegationId: delegation.delegationId,
        nowMs: input.nowMs,
      });
    }
    return [];
  }

  const barrier = delegation.completionPolicy.when;
  if (barrier === "on_each_terminal") {
    const ready = await makePendingSubscriptionReady({
      db: input.db,
      nowMs: input.nowMs,
      subscriptionId: resultSubscription.subscriptionId,
    });
    if (!hasUnfinishedDelegationChildren(delegation)) {
      await completeDelegation({
        db: input.db,
        delegationId: delegation.delegationId,
        nowMs: input.nowMs,
      });
    }
    return ready ? [resultSubscription.subscriptionId] : [];
  }

  const barrierMatched =
    (barrier === "all_terminal" &&
      !hasUnfinishedDelegationChildren(delegation)) ||
    (barrier === "first_success" && input.outcome.status === "succeeded") ||
    (barrier === "on_failure" && isAuthoritativeFailure(input.outcome));
  if (barrierMatched) {
    const ready = await makePendingOneShotSubscriptionWinner({
      db: input.db,
      delegation,
      nowMs: input.nowMs,
      subscriptionId: resultSubscription.subscriptionId,
    });
    if (!ready) {
      await settlePendingSubscriptionWithoutContinuation({
        db: input.db,
        nowMs: input.nowMs,
        subscriptionId: resultSubscription.subscriptionId,
      });
      return [];
    }
    await completeDelegation({
      db: input.db,
      delegationId: delegation.delegationId,
      nowMs: input.nowMs,
    });
    await settleOtherDelegationSubscriptions({
      db: input.db,
      delegation,
      keepSubscriptionId: resultSubscription.subscriptionId,
      nowMs: input.nowMs,
    });
    return [resultSubscription.subscriptionId];
  }

  if (!hasUnfinishedDelegationChildren(delegation)) {
    const won = await completeDelegation({
      db: input.db,
      delegationId: delegation.delegationId,
      nowMs: input.nowMs,
    });
    if (won) {
      await settleOtherDelegationSubscriptions({
        db: input.db,
        delegation,
        keepSubscriptionId: null,
        nowMs: input.nowMs,
      });
    }
  }
  return [];
}

async function completeDelegationWhenChildrenAreFinished(input: {
  db: D1Database;
  delegationId: string;
  nowMs: number;
}): Promise<void> {
  const delegation = await readAgentDelegation({
    db: input.db,
    delegationId: input.delegationId,
  });
  if (delegation && !hasUnfinishedDelegationChildren(delegation)) {
    await completeDelegation(input);
  }
}

async function listPendingAgentTaskCompletionSubscriptionsByWatchedTask(input: {
  db: D1Database;
  taskKey: string;
}): Promise<AgentTaskCompletionSubscriptionRecord[]> {
  const rows = await input.db
    .prepare(
      `
        SELECT *
        FROM agent_task_completion_subscriptions
        WHERE watched_task_key = ?
          AND state = 'pending'
        ORDER BY subscription_id ASC
      `
    )
    .bind(input.taskKey)
    .all<AgentTaskCompletionSubscriptionRow>();
  return (rows.results ?? []).map(parseSubscriptionRow);
}

async function recordPendingSubscriptionOutcome(input: {
  db: D1Database;
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  subscriptionId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET
          outcome_json = ?,
          last_event_id = ?,
          updated_at_ms = ?
        WHERE subscription_id = ?
          AND state = 'pending'
      `
    )
    .bind(
      serializeJson(input.outcome),
      input.outcome.eventId,
      input.nowMs,
      input.subscriptionId
    )
    .run();
}

async function makePendingSubscriptionReady(input: {
  db: D1Database;
  nowMs: number;
  subscriptionId: string;
}): Promise<boolean> {
  const ready = await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET state = 'ready', updated_at_ms = ?, settled_at_ms = NULL
        WHERE subscription_id = ?
          AND state = 'pending'
          AND continuation_json IS NOT NULL
        RETURNING subscription_id
      `
    )
    .bind(input.nowMs, input.subscriptionId)
    .first<{ subscription_id: string }>();
  return ready !== null;
}

async function makePendingOneShotSubscriptionWinner(input: {
  db: D1Database;
  delegation: AgentDelegationRecord;
  nowMs: number;
  subscriptionId: string;
}): Promise<boolean> {
  const childTaskKeys = input.delegation.children.map((child) =>
    buildAgentTaskKey(child.task)
  );
  const placeholders = childTaskKeys.map(() => "?").join(", ");
  const ready = await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET state = 'ready', updated_at_ms = ?, settled_at_ms = NULL
        WHERE subscription_id = ?
          AND state = 'pending'
          AND continuation_json IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM agent_task_completion_subscriptions AS winner
            WHERE winner.observer_task_key = ?
              AND winner.watched_task_key IN (${placeholders})
              AND json_extract(winner.continuation_json, '$.kind') = 'resume_agent'
              AND (
                winner.state IN ('ready', 'continuation_claimed')
                OR (
                  winner.state = 'settled'
                  AND winner.continuation_task_key IS NOT NULL
                )
              )
          )
        RETURNING subscription_id
      `
    )
    .bind(
      input.nowMs,
      input.subscriptionId,
      buildAgentTaskKey(input.delegation.parentTask),
      ...childTaskKeys
    )
    .first<{ subscription_id: string }>();
  return ready !== null;
}

async function settlePendingSubscriptionWithoutContinuation(input: {
  db: D1Database;
  nowMs: number;
  subscriptionId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET state = 'settled', updated_at_ms = ?, settled_at_ms = ?
        WHERE subscription_id = ?
          AND state = 'pending'
      `
    )
    .bind(input.nowMs, input.nowMs, input.subscriptionId)
    .run();
}

async function skipFallbackChildAndSubscriptions(input: {
  db: D1Database;
  delegation: AgentDelegationRecord;
  fallbackTask: AgentTaskHandle;
  nowMs: number;
}): Promise<void> {
  const fallbackTaskKey = buildAgentTaskKey(input.fallbackTask);
  const parentTaskKey = buildAgentTaskKey(input.delegation.parentTask);
  await input.db.batch([
    input.db
      .prepare(
        `
          UPDATE agent_delegation_children
          SET state = 'skipped', updated_at_ms = ?
          WHERE delegation_id = ?
            AND task_key = ?
            AND role = 'fallback'
            AND state = 'planned'
        `
      )
      .bind(input.nowMs, input.delegation.delegationId, fallbackTaskKey),
    input.db
      .prepare(
        `
          UPDATE agent_task_completion_subscriptions
          SET state = 'settled', updated_at_ms = ?, settled_at_ms = ?
          WHERE watched_task_key = ?
            AND observer_task_key = ?
            AND state = 'pending'
        `
      )
      .bind(input.nowMs, input.nowMs, fallbackTaskKey, parentTaskKey),
  ]);
}

async function settleOtherDelegationSubscriptions(input: {
  db: D1Database;
  delegation: AgentDelegationRecord;
  keepSubscriptionId: string | null;
  nowMs: number;
}): Promise<void> {
  const childTaskKeys = input.delegation.children.map((child) =>
    buildAgentTaskKey(child.task)
  );
  const placeholders = childTaskKeys.map(() => "?").join(", ");
  await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET state = 'settled', updated_at_ms = ?, settled_at_ms = ?
        WHERE observer_task_key = ?
          AND watched_task_key IN (${placeholders})
          AND state = 'pending'
          AND (
            continuation_json IS NULL
            OR json_extract(continuation_json, '$.kind')
              IN ('resume_agent', 'activate_fallback')
          )
          AND (? IS NULL OR subscription_id <> ?)
      `
    )
    .bind(
      input.nowMs,
      input.nowMs,
      buildAgentTaskKey(input.delegation.parentTask),
      ...childTaskKeys,
      input.keepSubscriptionId,
      input.keepSubscriptionId
    )
    .run();
}

async function completeDelegation(input: {
  db: D1Database;
  delegationId: string;
  nowMs: number;
}): Promise<boolean> {
  const completed = await input.db
    .prepare(
      `
        UPDATE agent_delegations
        SET
          state = 'completed',
          updated_at_ms = ?,
          completed_at_ms = COALESCE(completed_at_ms, ?)
        WHERE delegation_id = ?
          AND state = 'active'
        RETURNING delegation_id
      `
    )
    .bind(input.nowMs, input.nowMs, input.delegationId)
    .first<{ delegation_id: string }>();
  return completed !== null;
}

function hasUnfinishedDelegationChildren(
  delegation: AgentDelegationRecord
): boolean {
  return delegation.children.some(
    (child) => child.state === "planned" || child.state === "active"
  );
}

function isAuthoritativeFailure(outcome: AgentTaskTerminalOutcome): boolean {
  return outcome.status === "failed" || outcome.status === "publication_failed";
}

async function settlePendingSubscriptionFromOutcome(input: {
  db: D1Database;
  nowMs: number;
  outcome: AgentTaskCompletionObservation;
  shouldContinue: boolean;
  subscriptionId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE agent_task_completion_subscriptions
        SET
          state = ?,
          outcome_json = ?,
          last_event_id = ?,
          updated_at_ms = ?,
          settled_at_ms = ?
        WHERE subscription_id = ?
          AND state = 'pending'
      `
    )
    .bind(
      input.shouldContinue ? "ready" : "settled",
      serializeJson(input.outcome),
      input.outcome.eventId,
      input.nowMs,
      input.shouldContinue ? null : input.nowMs,
      input.subscriptionId
    )
    .run();
}

async function readAgentTaskCompletionSubscriptionByIdempotencyKey(input: {
  db: D1Database;
  idempotencyKey: string;
}): Promise<AgentTaskCompletionSubscriptionRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM agent_task_completion_subscriptions
        WHERE idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.idempotencyKey)
    .first<AgentTaskCompletionSubscriptionRow>();
  return row ? parseSubscriptionRow(row) : null;
}

async function requireAgentTaskCompletionSubscription(input: {
  db: D1Database;
  subscriptionId: string;
}): Promise<AgentTaskCompletionSubscriptionRecord> {
  const record = await readAgentTaskCompletionSubscription(input);
  if (!record) {
    throw new Error(
      `Agent Task completion subscription ${input.subscriptionId} is unavailable`
    );
  }
  return record;
}

export async function readAgentTaskTerminalOutcome(input: {
  db: D1Database;
  taskKey: string;
}): Promise<RecordedAgentTaskTerminalOutcome | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM agent_task_terminal_outcomes
        WHERE task_key = ?
        LIMIT 1
      `
    )
    .bind(input.taskKey)
    .first<AgentTaskTerminalOutcomeRow>();
  if (!row) {
    return null;
  }
  const task = agentTaskHandleSchema.parse(parseJson(row.task_handle_json));
  const outcome = agentTaskTerminalOutcomeSchema.parse(
    parseJson(row.outcome_json)
  );
  if (
    row.task_key !== buildAgentTaskKey(task) ||
    row.event_id !== outcome.eventId ||
    row.status !== outcome.status ||
    row.occurred_at_ms !== outcome.occurredAtMs
  ) {
    throw new Error("Agent Task terminal outcome storage is inconsistent");
  }
  return {
    observedAtMs: requireTimestamp(row.observed_at_ms, "observedAtMs"),
    outcome,
    task,
  };
}

function parseSubscriptionRow(
  row: AgentTaskCompletionSubscriptionRow
): AgentTaskCompletionSubscriptionRecord {
  const subscriptionId = requireNonEmpty(row.subscription_id, "subscriptionId");
  const watchedTask = agentTaskHandleSchema.parse(
    parseJson(row.watched_task_handle_json)
  );
  const observerTask = agentTaskHandleSchema.parse(
    parseJson(row.observer_task_handle_json)
  );
  const continuation =
    row.continuation_json === null
      ? null
      : agentTaskContinuationSchema.parse(parseJson(row.continuation_json));
  const continuationTask =
    row.continuation_task_handle_json === null
      ? null
      : agentTaskHandleSchema.parse(
          parseJson(row.continuation_task_handle_json)
        );
  const outcome =
    row.outcome_json === null
      ? null
      : agentTaskCompletionObservationSchema.parse(parseJson(row.outcome_json));
  const completionCondition = agentTaskCompletionConditionSchema.parse(
    row.completion_condition
  );
  if (
    row.watched_task_key !== buildAgentTaskKey(watchedTask) ||
    row.observer_task_key !== buildAgentTaskKey(observerTask) ||
    (continuation
      ? row.continuation_idempotency_key !==
        buildContinuationIdempotencyKey(subscriptionId)
      : row.continuation_idempotency_key !== null) ||
    (continuationTask
      ? row.continuation_task_key !== buildAgentTaskKey(continuationTask)
      : row.continuation_task_key !== null)
  ) {
    throw new Error(
      "Agent Task completion subscription storage is inconsistent"
    );
  }
  return {
    claimExpiresAtMs: normalizeNullableTimestamp(row.claim_expires_at_ms),
    claimId: normalizeNullableText(row.claim_id),
    completionCondition,
    continuation,
    continuationIdempotencyKey: normalizeNullableText(
      row.continuation_idempotency_key
    ),
    continuationTask,
    createdAtMs: requireTimestamp(row.created_at_ms, "createdAtMs"),
    idempotencyKey: requireNonEmpty(row.idempotency_key, "idempotencyKey"),
    lastEventId: normalizeNullableText(row.last_event_id),
    observerTask,
    organizationId: requireNonEmpty(row.organization_id, "organizationId"),
    outcome,
    settledAtMs: normalizeNullableTimestamp(row.settled_at_ms),
    state: parseSubscriptionState(row.state),
    subscriptionId,
    updatedAtMs: requireTimestamp(row.updated_at_ms, "updatedAtMs"),
    watchedTask,
  };
}

function assertIdempotentRegistration(
  record: AgentTaskCompletionSubscriptionRecord,
  expected: {
    completionCondition: AgentTaskCompletionCondition;
    continuation: AgentTaskContinuation | null;
    continuationIdempotencyKey: string | null;
    observerTaskKey: string;
    organizationId: string;
    subscriptionId: string;
    watchedTaskKey: string;
  }
): void {
  if (
    record.subscriptionId !== expected.subscriptionId ||
    record.organizationId !== expected.organizationId ||
    record.completionCondition !== expected.completionCondition ||
    buildAgentTaskKey(record.observerTask) !== expected.observerTaskKey ||
    buildAgentTaskKey(record.watchedTask) !== expected.watchedTaskKey ||
    serializeJson(record.continuation) !==
      serializeJson(expected.continuation) ||
    record.continuationIdempotencyKey !== expected.continuationIdempotencyKey
  ) {
    throw new Error(
      "Agent Task completion subscription idempotency key was reused with different input"
    );
  }
}

function doesTerminalOutcomeMatchCondition(
  outcome: AgentTaskTerminalOutcome,
  condition: AgentTaskCompletionCondition
): boolean {
  switch (condition) {
    case "terminal":
      return true;
    case "succeeded":
      return outcome.status === "succeeded";
    case "failed":
      return (
        outcome.status === "failed" || outcome.status === "publication_failed"
      );
    case "needs_attention":
      return false;
    default:
      return assertNever(condition);
  }
}

function parseSubscriptionState(
  value: unknown
): AgentTaskCompletionSubscriptionState {
  if (
    value === "pending" ||
    value === "ready" ||
    value === "continuation_claimed" ||
    value === "settled" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(`Invalid Agent Task completion subscription state: ${value}`);
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function requireNonEmpty(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function requireTimestamp(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function normalizeNullableTimestamp(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : requireTimestamp(value, "timestamp");
}

function normalizeNullableText(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : requireNonEmpty(value, "text");
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isInteger(value)
  ) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function buildContinuationIdempotencyKey(subscriptionId: string): string {
  return `agent-task-continuation:${subscriptionId}`;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
