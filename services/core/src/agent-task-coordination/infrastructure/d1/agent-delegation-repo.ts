import {
  agentDelegationCompletionPolicySchema,
  agentTaskHandleSchema,
  agentTaskTerminalOutcomeSchema,
  buildAgentTaskKey,
} from "@openmeld/schemas";
import type {
  AgentDelegationCompletionPolicy,
  AgentTaskHandle,
  AgentTaskTerminalOutcome,
} from "@openmeld/schemas/types";

export type AgentDelegationState =
  | "active"
  | "completed"
  | "cancelled"
  | "failed";

export type AgentDelegationChildRecord = {
  activatedAtMs: number | null;
  agentProfileId: string;
  childIndex: number;
  role: "primary" | "fallback";
  state: "planned" | "active" | "terminal" | "skipped" | "cancelled";
  task: AgentTaskHandle;
  terminalOutcome: AgentTaskTerminalOutcome | null;
};

export type AgentDelegationRecord = {
  children: AgentDelegationChildRecord[];
  completionPolicy: AgentDelegationCompletionPolicy;
  createdAtMs: number;
  delegationId: string;
  generation: number;
  idempotencyKey: string;
  organizationId: string;
  parentTask: AgentTaskHandle;
  spaceId: string;
  state: AgentDelegationState;
  updatedAtMs: number;
};

type AgentDelegationRow = {
  completion_policy_json: string;
  created_at_ms: number;
  delegation_id: string;
  generation: number;
  idempotency_key: string;
  organization_id: string;
  parent_task_handle_json: string;
  parent_task_key: string;
  space_id: string;
  state: AgentDelegationState;
  updated_at_ms: number;
};

type AgentDelegationChildRow = {
  agent_profile_id: string;
  activated_at_ms: number | null;
  child_index: number;
  role: "primary" | "fallback";
  state: AgentDelegationChildRecord["state"];
  task_handle_json: string;
  task_key: string;
  terminal_outcome_json: string | null;
};

export async function createAgentDelegation(input: {
  children: Array<{
    agentProfileId: string;
    role: "primary" | "fallback";
    task: AgentTaskHandle;
  }>;
  completionPolicy: AgentDelegationCompletionPolicy;
  db: D1Database;
  delegationId: string;
  idempotencyKey: string;
  nowMs: number;
  organizationId: string;
  parentTask: AgentTaskHandle;
  spaceId: string;
}): Promise<AgentDelegationRecord> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const idempotencyKey = requireNonEmpty(
    input.idempotencyKey,
    "idempotencyKey"
  );
  const organizationId = requireNonEmpty(
    input.organizationId,
    "organizationId"
  );
  const spaceId = requireNonEmpty(input.spaceId, "spaceId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const parentTask = agentTaskHandleSchema.parse(input.parentTask);
  const completionPolicy = agentDelegationCompletionPolicySchema.parse(
    input.completionPolicy
  );
  if (input.children.length === 0) {
    throw new Error("Agent delegation requires at least one child");
  }
  const children = input.children.map((child, childIndex) => ({
    agentProfileId: requireNonEmpty(
      child.agentProfileId,
      `children[${childIndex}].agentProfileId`
    ),
    childIndex,
    role: child.role,
    task: agentTaskHandleSchema.parse(child.task),
  }));
  const statements: D1PreparedStatement[] = [
    input.db
      .prepare(
        `
          INSERT INTO agent_delegations (
            delegation_id,
            idempotency_key,
            organization_id,
            space_id,
            parent_task_key,
            parent_task_handle_json,
            completion_policy_json,
            state,
            generation,
            created_at_ms,
            updated_at_ms
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
          ON CONFLICT(idempotency_key) DO NOTHING
        `
      )
      .bind(
        delegationId,
        idempotencyKey,
        organizationId,
        spaceId,
        buildAgentTaskKey(parentTask),
        serializeJson(parentTask),
        serializeJson(completionPolicy),
        nowMs,
        nowMs
      ),
    ...children.map((child) =>
      input.db
        .prepare(
          `
            INSERT INTO agent_delegation_children (
              delegation_id,
              child_index,
              task_key,
              task_handle_json,
              role,
              agent_profile_id,
              state,
              activated_at_ms,
              created_at_ms,
              updated_at_ms
            )
            SELECT ?, ?, ?, ?, ?, ?, 'planned', NULL, ?, ?
            WHERE EXISTS (
              SELECT 1
              FROM agent_delegations
              WHERE delegation_id = ?
                AND idempotency_key = ?
            )
            ON CONFLICT(delegation_id, child_index) DO NOTHING
          `
        )
        .bind(
          delegationId,
          child.childIndex,
          buildAgentTaskKey(child.task),
          serializeJson(child.task),
          child.role,
          child.agentProfileId,
          nowMs,
          nowMs,
          delegationId,
          idempotencyKey
        )
    ),
  ];
  await input.db.batch(statements);
  const record = await readAgentDelegationByIdempotencyKey({
    db: input.db,
    idempotencyKey,
  });
  if (!record) {
    throw new Error("Agent delegation write lost its row");
  }
  assertIdempotentDelegation(record, {
    children,
    completionPolicy,
    delegationId,
    organizationId,
    parentTask,
    spaceId,
  });
  return record;
}

export async function activateAgentDelegationChildren(input: {
  db: D1Database;
  delegationId: string;
  nowMs: number;
}): Promise<AgentDelegationRecord | null> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  await input.db
    .prepare(
      `
        UPDATE agent_delegation_children
        SET
          state = 'active',
          activated_at_ms = COALESCE(activated_at_ms, ?),
          updated_at_ms = ?
        WHERE delegation_id = ?
          AND role = 'primary'
          AND state = 'planned'
      `
    )
    .bind(nowMs, nowMs, delegationId)
    .run();
  return await readAgentDelegation({ db: input.db, delegationId });
}

export async function readAgentDelegation(input: {
  db: D1Database;
  delegationId: string;
}): Promise<AgentDelegationRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM agent_delegations
        WHERE delegation_id = ?
        LIMIT 1
      `
    )
    .bind(requireNonEmpty(input.delegationId, "delegationId"))
    .first<AgentDelegationRow>();
  return row ? await mapDelegationRow(input.db, row) : null;
}

export async function readAgentDelegationByChildTask(input: {
  db: D1Database;
  task: AgentTaskHandle;
}): Promise<AgentDelegationRecord | null> {
  const task = agentTaskHandleSchema.parse(input.task);
  const row = await input.db
    .prepare(
      `
        SELECT agent_delegations.*
        FROM agent_delegations
        INNER JOIN agent_delegation_children
          ON agent_delegation_children.delegation_id =
            agent_delegations.delegation_id
        WHERE agent_delegation_children.task_key = ?
        LIMIT 1
      `
    )
    .bind(buildAgentTaskKey(task))
    .first<AgentDelegationRow>();
  return row ? await mapDelegationRow(input.db, row) : null;
}

export async function activateFallbackAgentDelegationChild(input: {
  db: D1Database;
  delegationId: string;
  nowMs: number;
  task: AgentTaskHandle;
}): Promise<AgentDelegationRecord | null> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const task = agentTaskHandleSchema.parse(input.task);
  await input.db
    .prepare(
      `
        UPDATE agent_delegation_children
        SET
          state = 'active',
          activated_at_ms = COALESCE(activated_at_ms, ?),
          updated_at_ms = ?
        WHERE delegation_id = ?
          AND task_key = ?
          AND role = 'fallback'
          AND state = 'planned'
          AND EXISTS (
            SELECT 1
            FROM agent_delegations
            WHERE agent_delegations.delegation_id = ?
              AND agent_delegations.state = 'active'
          )
      `
    )
    .bind(nowMs, nowMs, delegationId, buildAgentTaskKey(task), delegationId)
    .run();
  return await readAgentDelegation({ db: input.db, delegationId });
}

export async function cancelAgentDelegation(input: {
  db: D1Database;
  delegationId: string;
  nowMs: number;
}): Promise<AgentDelegationRecord | null> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  await input.db.batch([
    input.db
      .prepare(
        `
          UPDATE agent_delegations
          SET
            state = 'cancelled',
            generation = generation + 1,
            updated_at_ms = ?,
            completed_at_ms = ?
          WHERE delegation_id = ?
            AND state = 'active'
        `
      )
      .bind(nowMs, nowMs, delegationId),
    input.db
      .prepare(
        `
          UPDATE agent_delegation_children
          SET state = 'cancelled', updated_at_ms = ?
          WHERE delegation_id = ?
            AND state IN ('planned', 'active')
        `
      )
      .bind(nowMs, delegationId),
  ]);
  return await readAgentDelegation({ db: input.db, delegationId });
}

export async function cancelAgentDelegationWithSubscriptions(input: {
  db: D1Database;
  delegationId: string;
  nowMs: number;
  subscriptionIds: string[];
}): Promise<AgentDelegationRecord | null> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const subscriptionIds = input.subscriptionIds.map((subscriptionId, index) =>
    requireNonEmpty(subscriptionId, `subscriptionIds[${index}]`)
  );
  if (subscriptionIds.length === 0) {
    return await cancelAgentDelegation({
      db: input.db,
      delegationId,
      nowMs,
    });
  }
  const subscriptionPlaceholders = subscriptionIds.map(() => "?").join(", ");
  await input.db.batch([
    input.db
      .prepare(
        `
          UPDATE agent_task_completion_subscriptions
          SET
            state = 'cancelled',
            claim_id = NULL,
            claim_expires_at_ms = NULL,
            updated_at_ms = ?,
            settled_at_ms = COALESCE(settled_at_ms, ?)
          WHERE subscription_id IN (${subscriptionPlaceholders})
            AND state IN ('pending', 'ready', 'continuation_claimed')
        `
      )
      .bind(nowMs, nowMs, ...subscriptionIds),
    input.db
      .prepare(
        `
          UPDATE agent_delegations
          SET
            state = 'cancelled',
            generation = generation + 1,
            updated_at_ms = ?,
            completed_at_ms = ?
          WHERE delegation_id = ?
            AND state = 'active'
        `
      )
      .bind(nowMs, nowMs, delegationId),
    input.db
      .prepare(
        `
          UPDATE agent_delegation_children
          SET state = 'cancelled', updated_at_ms = ?
          WHERE delegation_id = ?
            AND state IN ('planned', 'active')
        `
      )
      .bind(nowMs, delegationId),
  ]);
  return await readAgentDelegation({ db: input.db, delegationId });
}

export async function cancelAgentDelegationsByParentTask(input: {
  db: D1Database;
  nowMs: number;
  parentTask: AgentTaskHandle;
}): Promise<{
  childTasks: AgentTaskHandle[];
  continuationIdempotencyKeys: string[];
}> {
  const parentTask = agentTaskHandleSchema.parse(input.parentTask);
  const parentTaskKey = buildAgentTaskKey(parentTask);
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const rows = await input.db
    .prepare(
      `
        SELECT child.task_handle_json
        FROM agent_delegation_children child
        INNER JOIN agent_delegations delegation
          ON delegation.delegation_id = child.delegation_id
        WHERE delegation.parent_task_key = ?
          AND delegation.state IN ('active', 'completed', 'cancelled')
          AND child.activated_at_ms IS NOT NULL
          AND child.state IN ('active', 'cancelled')
        ORDER BY child.child_index ASC
      `
    )
    .bind(parentTaskKey)
    .all<{ task_handle_json: string }>();
  const continuationRows = await input.db
    .prepare(
      `
        SELECT DISTINCT continuation_idempotency_key
        FROM agent_task_completion_subscriptions
        WHERE observer_task_key = ?
          AND continuation_idempotency_key IS NOT NULL
          AND json_extract(continuation_json, '$.kind') = 'resume_agent'
          AND state IN ('ready', 'continuation_claimed', 'settled', 'cancelled')
        ORDER BY continuation_idempotency_key ASC
      `
    )
    .bind(parentTaskKey)
    .all<{ continuation_idempotency_key: string }>();
  await input.db.batch([
    input.db
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
            AND state IN ('pending', 'ready', 'continuation_claimed')
        `
      )
      .bind(nowMs, nowMs, parentTaskKey),
    input.db
      .prepare(
        `
          UPDATE agent_delegations
          SET
            state = 'cancelled',
            generation = generation + 1,
            updated_at_ms = ?,
            completed_at_ms = COALESCE(completed_at_ms, ?)
          WHERE parent_task_key = ?
            AND state IN ('active', 'completed')
        `
      )
      .bind(nowMs, nowMs, parentTaskKey),
    input.db
      .prepare(
        `
          UPDATE agent_delegation_children
          SET state = 'cancelled', updated_at_ms = ?
          WHERE delegation_id IN (
            SELECT delegation_id
            FROM agent_delegations
            WHERE parent_task_key = ?
              AND state = 'cancelled'
          )
            AND state IN ('planned', 'active')
        `
      )
      .bind(nowMs, parentTaskKey),
  ]);
  return {
    childTasks: (rows.results ?? []).map((row) =>
      agentTaskHandleSchema.parse(parseJson(row.task_handle_json))
    ),
    continuationIdempotencyKeys: (continuationRows.results ?? []).map((row) =>
      requireNonEmpty(
        row.continuation_idempotency_key,
        "continuationIdempotencyKey"
      )
    ),
  };
}

async function readAgentDelegationByIdempotencyKey(input: {
  db: D1Database;
  idempotencyKey: string;
}): Promise<AgentDelegationRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM agent_delegations
        WHERE idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.idempotencyKey)
    .first<AgentDelegationRow>();
  return row ? await mapDelegationRow(input.db, row) : null;
}

async function mapDelegationRow(
  db: D1Database,
  row: AgentDelegationRow
): Promise<AgentDelegationRecord> {
  const parentTask = agentTaskHandleSchema.parse(
    parseJson(row.parent_task_handle_json)
  );
  const completionPolicy = agentDelegationCompletionPolicySchema.parse(
    parseJson(row.completion_policy_json)
  );
  if (row.parent_task_key !== buildAgentTaskKey(parentTask)) {
    throw new Error("Agent delegation parent task storage is inconsistent");
  }
  const childRows = await db
    .prepare(
      `
        SELECT *
        FROM agent_delegation_children
        WHERE delegation_id = ?
        ORDER BY child_index ASC
      `
    )
    .bind(row.delegation_id)
    .all<AgentDelegationChildRow>();
  const children = (childRows.results ?? []).map(mapDelegationChildRow);
  return {
    children,
    completionPolicy,
    createdAtMs: requireTimestamp(row.created_at_ms, "createdAtMs"),
    delegationId: requireNonEmpty(row.delegation_id, "delegationId"),
    generation: requirePositiveInteger(row.generation, "generation"),
    idempotencyKey: requireNonEmpty(row.idempotency_key, "idempotencyKey"),
    organizationId: requireNonEmpty(row.organization_id, "organizationId"),
    parentTask,
    spaceId: requireNonEmpty(row.space_id, "spaceId"),
    state: parseDelegationState(row.state),
    updatedAtMs: requireTimestamp(row.updated_at_ms, "updatedAtMs"),
  };
}

function mapDelegationChildRow(
  row: AgentDelegationChildRow
): AgentDelegationChildRecord {
  const task = agentTaskHandleSchema.parse(parseJson(row.task_handle_json));
  if (row.task_key !== buildAgentTaskKey(task)) {
    throw new Error("Agent delegation child task storage is inconsistent");
  }
  return {
    activatedAtMs:
      row.activated_at_ms === null
        ? null
        : requireTimestamp(row.activated_at_ms, "child.activatedAtMs"),
    agentProfileId: requireNonEmpty(
      row.agent_profile_id,
      "child.agentProfileId"
    ),
    childIndex: requireNonNegativeInteger(row.child_index, "child.childIndex"),
    role: row.role,
    state: row.state,
    task,
    terminalOutcome:
      row.terminal_outcome_json === null
        ? null
        : agentTaskTerminalOutcomeSchema.parse(
            parseJson(row.terminal_outcome_json)
          ),
  };
}

function assertIdempotentDelegation(
  record: AgentDelegationRecord,
  expected: {
    children: Array<{
      agentProfileId: string;
      childIndex: number;
      role: "primary" | "fallback";
      task: AgentTaskHandle;
    }>;
    completionPolicy: AgentDelegationCompletionPolicy;
    delegationId: string;
    organizationId: string;
    parentTask: AgentTaskHandle;
    spaceId: string;
  }
): void {
  if (
    record.delegationId !== expected.delegationId ||
    record.organizationId !== expected.organizationId ||
    record.spaceId !== expected.spaceId ||
    buildAgentTaskKey(record.parentTask) !==
      buildAgentTaskKey(expected.parentTask) ||
    serializeJson(record.completionPolicy) !==
      serializeJson(expected.completionPolicy) ||
    record.children.length !== expected.children.length ||
    record.children.some((child, index) => {
      const expectedChild = expected.children[index];
      return (
        !expectedChild ||
        child.childIndex !== expectedChild.childIndex ||
        child.role !== expectedChild.role ||
        child.agentProfileId !== expectedChild.agentProfileId ||
        buildAgentTaskKey(child.task) !== buildAgentTaskKey(expectedChild.task)
      );
    })
  ) {
    throw new Error(
      "Agent delegation idempotency key was reused with different input"
    );
  }
}

function parseDelegationState(value: unknown): AgentDelegationState {
  if (
    value === "active" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`Invalid Agent delegation state: ${String(value)}`);
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

function requireNonNegativeInteger(value: unknown, field: string): number {
  return requireTimestamp(value, field);
}

function requirePositiveInteger(value: unknown, field: string): number {
  const parsed = requireNonNegativeInteger(value, field);
  if (parsed === 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}
