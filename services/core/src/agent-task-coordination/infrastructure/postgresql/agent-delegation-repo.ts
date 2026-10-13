import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
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
  const statements: QueryConfig[] = [
    {
      text: `
          INSERT INTO "openmeld"."agent_delegations" (
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 1, $8, $9)
          ON CONFLICT(idempotency_key) DO NOTHING
        `,
      values: [
        delegationId,
        idempotencyKey,
        organizationId,
        spaceId,
        buildAgentTaskKey(parentTask),
        serializeJson(parentTask),
        serializeJson(completionPolicy),
        nowMs,
        nowMs,
      ],
    },
    ...children.map((child) => ({
      text: `
            INSERT INTO "openmeld"."agent_delegation_children" (
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
            SELECT $1, $2, $3, $4, $5, $6, 'planned', NULL, $7, $8
            WHERE EXISTS (
              SELECT 1
              FROM "openmeld"."agent_delegations"
              WHERE delegation_id = $9
                AND idempotency_key = $10
            )
            ON CONFLICT(delegation_id, child_index) DO NOTHING
          `,
      values: [
        delegationId,
        child.childIndex,
        buildAgentTaskKey(child.task),
        serializeJson(child.task),
        child.role,
        child.agentProfileId,
        nowMs,
        nowMs,
        delegationId,
        idempotencyKey,
      ],
    })),
  ];
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
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
  db: PostgresDatabase;
  delegationId: string;
  nowMs: number;
  tasks?: AgentTaskHandle[];
}): Promise<AgentDelegationRecord | null> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const taskKeys = input.tasks?.map(buildAgentTaskKey);
  if (taskKeys?.length === 0) {
    return await readAgentDelegation({ db: input.db, delegationId });
  }
  await input.db.query({
    text: `
        UPDATE "openmeld"."agent_delegation_children"
        SET
          state = 'active',
          activated_at_ms = COALESCE(activated_at_ms, $1),
          updated_at_ms = $2
        WHERE delegation_id = $3
          AND role = 'primary'
          AND state = 'planned'
          ${taskKeys ? `AND task_key IN (${taskKeys.map((_, index) => `$${index + 4}`).join(", ")})` : ""}
      `,
    values: [nowMs, nowMs, delegationId, ...(taskKeys ?? [])],
  });
  return await readAgentDelegation({ db: input.db, delegationId });
}
export async function readAgentDelegation(input: {
  db: PostgresDatabase;
  delegationId: string;
}): Promise<AgentDelegationRecord | null> {
  const row = await input.db
    .query<AgentDelegationRow>({
      text: `
        SELECT *
        FROM "openmeld"."agent_delegations"
        WHERE delegation_id = $1
        LIMIT 1
      `,
      values: [requireNonEmpty(input.delegationId, "delegationId")],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? await mapDelegationRow(input.db, row) : null;
}

/** A read projection over declared relations; never infers children from messages. */
export async function listAgentDelegationsByParentTasks(input: {
  db: PostgresDatabase;
  parents: Array<{ organizationId: string; task: AgentTaskHandle }>;
  after?: string;
}): Promise<{ records: AgentDelegationRecord[]; nextCursor: string | null }> {
  if (input.parents.length === 0) {
    return { records: [], nextCursor: null };
  }
  const rows = await input.db.query<AgentDelegationRow>({
    text: `
      SELECT delegation.*
      FROM "openmeld"."agent_delegations" AS delegation
      WHERE EXISTS (
        SELECT 1 FROM jsonb_to_recordset($1::jsonb)
          AS parent(organization_id text, task_key text)
        WHERE parent.organization_id = delegation.organization_id
          AND parent.task_key = delegation.parent_task_key
      )
      AND ($2::text IS NULL OR delegation.delegation_id > $2)
      ORDER BY delegation.delegation_id
      LIMIT 11
    `,
    values: [
      JSON.stringify(
        input.parents.map((parent) => ({
          organization_id: parent.organizationId,
          task_key: buildAgentTaskKey(parent.task),
        }))
      ),
      input.after ?? null,
    ],
  });
  const selected = rows.rows.slice(0, 10);
  const records: AgentDelegationRecord[] = [];
  for (const row of selected) {
    records.push(await mapDelegationRow(input.db, row));
  }
  return {
    records,
    nextCursor:
      rows.rows.length > 10 ? (selected.at(-1)?.delegation_id ?? null) : null,
  };
}
export async function readAgentDelegationByChildTask(input: {
  db: PostgresDatabase;
  task: AgentTaskHandle;
}): Promise<AgentDelegationRecord | null> {
  const task = agentTaskHandleSchema.parse(input.task);
  const row = await input.db
    .query<AgentDelegationRow>({
      text: `
        SELECT agent_delegations.*
        FROM "openmeld"."agent_delegations"
        INNER JOIN "openmeld"."agent_delegation_children"
          ON agent_delegation_children.delegation_id =
            agent_delegations.delegation_id
        WHERE agent_delegation_children.task_key = $1
        LIMIT 1
      `,
      values: [buildAgentTaskKey(task)],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? await mapDelegationRow(input.db, row) : null;
}
export async function activateFallbackAgentDelegationChild(input: {
  db: PostgresDatabase;
  delegationId: string;
  nowMs: number;
  task: AgentTaskHandle;
}): Promise<AgentDelegationRecord | null> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const task = agentTaskHandleSchema.parse(input.task);
  await input.db.query({
    text: `
        UPDATE "openmeld"."agent_delegation_children"
        SET
          state = 'active',
          activated_at_ms = COALESCE(activated_at_ms, $1),
          updated_at_ms = $2
        WHERE delegation_id = $3
          AND task_key = $4
          AND role = 'fallback'
          AND state = 'planned'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."agent_delegations"
            WHERE agent_delegations.delegation_id = $5
              AND agent_delegations.state = 'active'
          )
      `,
    values: [nowMs, nowMs, delegationId, buildAgentTaskKey(task), delegationId],
  });
  return await readAgentDelegation({ db: input.db, delegationId });
}
export async function cancelAgentDelegation(input: {
  db: PostgresDatabase;
  delegationId: string;
  nowMs: number;
}): Promise<AgentDelegationRecord | null> {
  const delegationId = requireNonEmpty(input.delegationId, "delegationId");
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `
          UPDATE "openmeld"."agent_delegations"
          SET
            state = 'cancelled',
            generation = generation + 1,
            updated_at_ms = $1,
            completed_at_ms = $2
          WHERE delegation_id = $3
            AND state = 'active'
        `,
          values: [nowMs, nowMs, delegationId],
        }),
        await client.query({
          text: `
          UPDATE "openmeld"."agent_delegation_children"
          SET state = 'cancelled', updated_at_ms = $1
          WHERE delegation_id = $2
            AND state IN ('planned', 'active')
        `,
          values: [nowMs, delegationId],
        }),
      ] as const
  );
  return await readAgentDelegation({ db: input.db, delegationId });
}
export async function cancelAgentDelegationWithSubscriptions(input: {
  db: PostgresDatabase;
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
  await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `
          UPDATE "openmeld"."agent_task_completion_subscriptions"
          SET
            state = 'cancelled',
            claim_id = NULL,
            claim_expires_at_ms = NULL,
            updated_at_ms = $1,
            settled_at_ms = COALESCE(settled_at_ms, $2)
          WHERE subscription_id = ANY($3::text[])
            AND state IN ('pending', 'ready', 'continuation_claimed')
        `,
          values: [nowMs, nowMs, subscriptionIds],
        }),
        await client.query({
          text: `
          UPDATE "openmeld"."agent_delegations"
          SET
            state = 'cancelled',
            generation = generation + 1,
            updated_at_ms = $1,
            completed_at_ms = $2
          WHERE delegation_id = $3
            AND state = 'active'
        `,
          values: [nowMs, nowMs, delegationId],
        }),
        await client.query({
          text: `
          UPDATE "openmeld"."agent_delegation_children"
          SET state = 'cancelled', updated_at_ms = $1
          WHERE delegation_id = $2
            AND state IN ('planned', 'active')
        `,
          values: [nowMs, delegationId],
        }),
      ] as const
  );
  return await readAgentDelegation({ db: input.db, delegationId });
}
export async function cancelAgentDelegationsByParentTask(input: {
  db: PostgresDatabase;
  nowMs: number;
  parentTask: AgentTaskHandle;
}): Promise<{
  childTasks: AgentTaskHandle[];
  continuationIdempotencyKeys: string[];
}> {
  const parentTask = agentTaskHandleSchema.parse(input.parentTask);
  const parentTaskKey = buildAgentTaskKey(parentTask);
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const rows = await input.db.query<{
    task_handle_json: string;
  }>({
    text: `
        SELECT child.task_handle_json
        FROM "openmeld"."agent_delegation_children" child
        INNER JOIN "openmeld"."agent_delegations" delegation
          ON delegation.delegation_id = child.delegation_id
        WHERE delegation.parent_task_key = $1
          AND delegation.state IN ('active', 'completed', 'cancelled')
          AND child.activated_at_ms IS NOT NULL
          AND child.state IN ('active', 'cancelled')
        ORDER BY child.child_index ASC NULLS FIRST
      `,
    values: [parentTaskKey],
  });
  const continuationRows = await input.db.query<{
    continuation_idempotency_key: string;
  }>({
    text: `
        SELECT DISTINCT continuation_idempotency_key
        FROM "openmeld"."agent_task_completion_subscriptions"
        WHERE observer_task_key = $1
          AND continuation_idempotency_key IS NOT NULL
          AND ((continuation_json)::jsonb #>> '{kind}') = 'resume_agent'
          AND state IN ('ready', 'continuation_claimed', 'settled', 'cancelled')
        ORDER BY continuation_idempotency_key ASC NULLS FIRST
      `,
    values: [parentTaskKey],
  });
  await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `
          UPDATE "openmeld"."agent_task_completion_subscriptions"
          SET
            state = 'cancelled',
            claim_id = NULL,
            claim_expires_at_ms = NULL,
            updated_at_ms = $1,
            settled_at_ms = COALESCE(settled_at_ms, $2)
          WHERE observer_task_key = $3
            AND state IN ('pending', 'ready', 'continuation_claimed')
        `,
          values: [nowMs, nowMs, parentTaskKey],
        }),
        await client.query({
          text: `
          UPDATE "openmeld"."agent_delegations"
          SET
            state = 'cancelled',
            generation = generation + 1,
            updated_at_ms = $1,
            completed_at_ms = COALESCE(completed_at_ms, $2)
          WHERE parent_task_key = $3
            AND state IN ('active', 'completed')
        `,
          values: [nowMs, nowMs, parentTaskKey],
        }),
        await client.query({
          text: `
          UPDATE "openmeld"."agent_delegation_children"
          SET state = 'cancelled', updated_at_ms = $1
          WHERE delegation_id IN (
            SELECT delegation_id
            FROM "openmeld"."agent_delegations"
            WHERE parent_task_key = $2
              AND state = 'cancelled'
          )
            AND state IN ('planned', 'active')
        `,
          values: [nowMs, parentTaskKey],
        }),
      ] as const
  );
  return {
    childTasks: (rows.rows ?? []).map((row) =>
      agentTaskHandleSchema.parse(parseJson(row.task_handle_json))
    ),
    continuationIdempotencyKeys: (continuationRows.rows ?? []).map((row) =>
      requireNonEmpty(
        row.continuation_idempotency_key,
        "continuationIdempotencyKey"
      )
    ),
  };
}
async function readAgentDelegationByIdempotencyKey(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
}): Promise<AgentDelegationRecord | null> {
  const row = await input.db
    .query<AgentDelegationRow>({
      text: `
        SELECT *
        FROM "openmeld"."agent_delegations"
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      values: [input.idempotencyKey],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? await mapDelegationRow(input.db, row) : null;
}
async function mapDelegationRow(
  db: PostgresDatabase,
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
  const childRows = await db.query<AgentDelegationChildRow>({
    text: `
        SELECT *
        FROM "openmeld"."agent_delegation_children"
        WHERE delegation_id = $1
        ORDER BY child_index ASC NULLS FIRST
      `,
    values: [row.delegation_id],
  });
  const children = (childRows.rows ?? []).map(mapDelegationChildRow);
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
