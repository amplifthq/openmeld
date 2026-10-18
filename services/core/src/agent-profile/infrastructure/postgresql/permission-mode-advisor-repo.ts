import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { buildAgentTaskKey } from "@openmeld/schemas";
import {
  RUNTIME_COORDINATOR_INTERACTION_ATTENTION_EVENT_PREFIX,
  runtimeCoordinatorInteractionAttentionCode,
} from "../../../runtime-transport/application/runtime-coordinator-interaction-attention";

const EXECUTION_SCAN_LIMIT = 500;
const PROFILE_SCAN_LIMIT = 200;

export type PermissionModeAdvisoryRow = {
  advisoryJson: string;
  agentProfileId: string;
  cardOfferedAtMs: number | null;
  cardResolvedAtMs: number | null;
  cardSpaceId: string | null;
  cardStatus: "applied" | "dismissed" | "pending" | null;
  currentPermissionMode: string;
  lastSuggestedAtMs: number;
  organizationId: string;
  ownerUserId: string;
  suggestedDispatchId: string;
  suggestedPermissionMode: string;
  suggestionId: string;
  waitingApprovalCount: number;
};

type AdvisoryDbRow = {
  advisory_json: string;
  agent_profile_id: string;
  card_offered_at_ms: number | string | null;
  card_resolved_at_ms: number | string | null;
  card_space_id: string | null;
  card_status: string | null;
  current_permission_mode: string;
  last_suggested_at_ms: number | string;
  organization_id: string;
  owner_user_id: string;
  suggested_dispatch_id: string;
  suggested_permission_mode: string;
  suggestion_id: string;
  waiting_approval_count: number | string;
};

const ADVISORY_TABLE = '"openmeld"."agent_profile_permission_mode_advisories"';

export async function readPermissionModeAdvisoryRow(input: {
  agentProfileId: string;
  db: PostgresDatabase;
}): Promise<PermissionModeAdvisoryRow | null> {
  const result = await input.db.query<AdvisoryDbRow>({
    text: `SELECT * FROM ${ADVISORY_TABLE} WHERE agent_profile_id = $1 LIMIT 1`,
    values: [input.agentProfileId],
  });
  const row = result.rows[0];
  return row ? toAdvisoryRow(row) : null;
}

export async function readPermissionModeAdvisoryRowBySuggestionId(input: {
  db: PostgresDatabase;
  suggestionId: string;
}): Promise<PermissionModeAdvisoryRow | null> {
  const result = await input.db.query<AdvisoryDbRow>({
    text: `SELECT * FROM ${ADVISORY_TABLE} WHERE suggestion_id = $1 LIMIT 1`,
    values: [input.suggestionId],
  });
  const row = result.rows[0];
  return row ? toAdvisoryRow(row) : null;
}

export type PermissionAdvisorExecution = {
  oneHopRequesterProfileId: string;
  /** Null for Wakes admitted before Core recorded request chains. */
  rootRequesterProfileId: string | null;
  runtimeCoordinatorExecutionId: string;
  sourceClientMessageId: string;
  spaceId: string;
};

/**
 * Recent RuntimeCoordinator executions of one Agent Profile with the
 * requester recorded in the Dispatch Ledger. One row per execution, so a
 * retried ledger row cannot duplicate an execution.
 */
export async function listRecentPermissionAdvisorExecutions(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  updatedSinceMs: number;
}): Promise<PermissionAdvisorExecution[]> {
  const result = await input.db.query<{
    request_chain_root_profile_id: string | null;
    runtime_coordinator_execution_id: string;
    source_client_message_id: string;
    source_profile_id: string;
    space_id: string;
  }>({
    text: `
      SELECT DISTINCT ON (execution.runtime_coordinator_execution_id)
        execution.runtime_coordinator_execution_id,
        execution.space_id,
        execution.source_client_message_id,
        ledger.source_profile_id,
        ledger.request_chain_root_profile_id
      FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" AS execution
      JOIN "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
        ON ledger.dispatch_id = execution.dispatch_id
        AND ledger.target_profile_id = execution.target_profile_id
      WHERE execution.target_profile_id = $1
        AND execution.updated_at_ms >= $2
        AND execution.source_client_message_id IS NOT NULL
        AND ledger.source_profile_id IS NOT NULL
      ORDER BY execution.runtime_coordinator_execution_id, ledger.first_seen_at_ms
      LIMIT ${EXECUTION_SCAN_LIMIT}
    `,
    values: [input.agentProfileId, input.updatedSinceMs],
  });
  return result.rows.map((row) => ({
    oneHopRequesterProfileId: row.source_profile_id,
    rootRequesterProfileId: row.request_chain_root_profile_id,
    runtimeCoordinatorExecutionId: row.runtime_coordinator_execution_id,
    sourceClientMessageId: row.source_client_message_id,
    spaceId: row.space_id,
  }));
}

export async function readPermissionAdvisorRequesterProfiles(input: {
  db: PostgresDatabase;
  profileIds: readonly string[];
}): Promise<Map<string, { ownerUserId: string | null; profileName: string }>> {
  const profiles = new Map<
    string,
    { ownerUserId: string | null; profileName: string }
  >();
  const profileIds = [...new Set(input.profileIds)].slice(
    0,
    PROFILE_SCAN_LIMIT
  );
  if (profileIds.length === 0) {
    return profiles;
  }
  const result = await input.db.query<{
    owner_user_id: string | null;
    profile_id: string;
    profile_name: string;
  }>({
    text: `
      SELECT profile_id, owner_user_id, profile_name
      FROM "openmeld"."openmeld_profiles"
      WHERE profile_id = ANY($1::text[])
    `,
    values: [profileIds],
  });
  for (const row of result.rows) {
    profiles.set(row.profile_id, {
      ownerUserId: row.owner_user_id,
      profileName: row.profile_name,
    });
  }
  return profiles;
}

/**
 * Permission interactions raised in the window, read from the Agent Task
 * needs-attention records RuntimeCoordinator already writes for each
 * interaction. The table key (task, event) holds one row per interaction, so
 * a replayed interaction request is never counted twice.
 */
export async function listPermissionInteractionTaskKeys(input: {
  db: PostgresDatabase;
  occurredSinceMs: number;
  tasks: readonly {
    sourceClientMessageId: string;
    spaceId: string;
    targetProfileId: string;
  }[];
}): Promise<{ eventId: string; taskKey: string }[]> {
  const taskKeys = [
    ...new Set(
      input.tasks.map((task) =>
        buildAgentTaskKey({
          kind: "space_wake",
          sourceClientMessageId: task.sourceClientMessageId,
          spaceId: task.spaceId,
          targetProfileId: task.targetProfileId,
          v: 1,
        })
      )
    ),
  ];
  if (taskKeys.length === 0) {
    return [];
  }
  const result = await input.db.query<{ event_id: string; task_key: string }>({
    text: `
        SELECT task_key, event_id
        FROM "openmeld"."agent_task_needs_attention_observations"
        WHERE task_key = ANY($1::text[])
          AND occurred_at_ms >= $2
          AND starts_with(event_id, $3)
          AND observation_json::jsonb ->> 'attentionCode' = $4
      `,
    values: [
      taskKeys,
      input.occurredSinceMs,
      RUNTIME_COORDINATOR_INTERACTION_ATTENTION_EVENT_PREFIX,
      runtimeCoordinatorInteractionAttentionCode("permission"),
    ],
  });
  return result.rows.map((row) => ({
    eventId: row.event_id,
    taskKey: row.task_key,
  }));
}

/**
 * Records one suggestion. The write succeeds only when the Profile has no
 * suggestion inside the cooldown, so concurrent Wakes cannot both suggest.
 */
export async function claimPermissionModeAdvisory(input: {
  advisoryJson: string;
  agentProfileId: string;
  cooldownCutoffMs: number;
  currentPermissionMode: string;
  db: PostgresDatabase;
  dispatchId: string;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
  suggestedPermissionMode: string;
  suggestionId: string;
  waitingApprovalCount: number;
}): Promise<boolean> {
  const result = await input.db.query<{ suggestion_id: string }>({
    text: `
      INSERT INTO ${ADVISORY_TABLE} (
        agent_profile_id, organization_id, owner_user_id, suggestion_id,
        last_suggested_at_ms, suggested_dispatch_id, advisory_json,
        current_permission_mode, suggested_permission_mode,
        waiting_approval_count, card_status, card_space_id,
        card_offered_at_ms, card_resolved_at_ms, updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, NULL, NULL, $5)
      ON CONFLICT (agent_profile_id) DO UPDATE SET
        organization_id = excluded.organization_id,
        owner_user_id = excluded.owner_user_id,
        suggestion_id = excluded.suggestion_id,
        last_suggested_at_ms = excluded.last_suggested_at_ms,
        suggested_dispatch_id = excluded.suggested_dispatch_id,
        advisory_json = excluded.advisory_json,
        current_permission_mode = excluded.current_permission_mode,
        suggested_permission_mode = excluded.suggested_permission_mode,
        waiting_approval_count = excluded.waiting_approval_count,
        card_status = NULL,
        card_space_id = NULL,
        card_offered_at_ms = NULL,
        card_resolved_at_ms = NULL,
        updated_at_ms = excluded.updated_at_ms
      WHERE ${ADVISORY_TABLE}.last_suggested_at_ms <= $11
      RETURNING suggestion_id
    `,
    values: [
      input.agentProfileId,
      input.organizationId,
      input.ownerUserId,
      input.suggestionId,
      input.nowMs,
      input.dispatchId,
      input.advisoryJson,
      input.currentPermissionMode,
      input.suggestedPermissionMode,
      input.waitingApprovalCount,
      input.cooldownCutoffMs,
    ],
  });
  return result.rows[0]?.suggestion_id === input.suggestionId;
}

/** Opens the owner-only card for the suggestion the given Wake received. */
export async function offerPermissionModeSuggestionCard(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  dispatchId: string;
  nowMs: number;
  ownerUserId: string;
  spaceId: string;
  suggestedSinceMs: number;
}): Promise<PermissionModeAdvisoryRow | null> {
  const result = await input.db.query<AdvisoryDbRow>({
    text: `
      UPDATE ${ADVISORY_TABLE}
      SET card_status = 'pending',
        card_space_id = $5,
        card_offered_at_ms = $4,
        updated_at_ms = $4
      WHERE agent_profile_id = $1
        AND suggested_dispatch_id = $2
        AND owner_user_id = $3
        AND last_suggested_at_ms >= $6
        AND card_status IS NULL
      RETURNING *
    `,
    values: [
      input.agentProfileId,
      input.dispatchId,
      input.ownerUserId,
      input.nowMs,
      input.spaceId,
      input.suggestedSinceMs,
    ],
  });
  const row = result.rows[0];
  return row ? toAdvisoryRow(row) : null;
}

export async function listPendingPermissionModeSuggestionCards(input: {
  db: PostgresDatabase;
  offeredSinceMs: number;
  organizationId: string;
  ownerUserId: string;
  spaceId: string;
}): Promise<PermissionModeAdvisoryRow[]> {
  const result = await input.db.query<AdvisoryDbRow>({
    text: `
      SELECT *
      FROM ${ADVISORY_TABLE}
      WHERE owner_user_id = $1
        AND card_status = 'pending'
        AND card_space_id = $2
        AND organization_id = $3
        AND card_offered_at_ms >= $4
      ORDER BY card_offered_at_ms, agent_profile_id
      LIMIT 50
    `,
    values: [
      input.ownerUserId,
      input.spaceId,
      input.organizationId,
      input.offeredSinceMs,
    ],
  });
  return result.rows.map(toAdvisoryRow);
}

export async function resolvePermissionModeSuggestionCard(input: {
  db: PostgresDatabase;
  nowMs: number;
  ownerUserId: string;
  resolution: "applied" | "dismissed";
  suggestionId: string;
}): Promise<boolean> {
  const result = await input.db.query<{ suggestion_id: string }>({
    text: `
      UPDATE ${ADVISORY_TABLE}
      SET card_status = $3,
        card_resolved_at_ms = $4,
        updated_at_ms = $4
      WHERE suggestion_id = $1
        AND owner_user_id = $2
        AND card_status = 'pending'
      RETURNING suggestion_id
    `,
    values: [
      input.suggestionId,
      input.ownerUserId,
      input.resolution,
      input.nowMs,
    ],
  });
  return result.rows.length === 1;
}

function toAdvisoryRow(row: AdvisoryDbRow): PermissionModeAdvisoryRow {
  return {
    advisoryJson: row.advisory_json,
    agentProfileId: row.agent_profile_id,
    cardOfferedAtMs: toNullableNumber(row.card_offered_at_ms),
    cardResolvedAtMs: toNullableNumber(row.card_resolved_at_ms),
    cardSpaceId: row.card_space_id,
    cardStatus: parseCardStatus(row.card_status),
    currentPermissionMode: row.current_permission_mode,
    lastSuggestedAtMs: Number(row.last_suggested_at_ms),
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    suggestedDispatchId: row.suggested_dispatch_id,
    suggestedPermissionMode: row.suggested_permission_mode,
    suggestionId: row.suggestion_id,
    waitingApprovalCount: Number(row.waiting_approval_count),
  };
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function parseCardStatus(
  value: string | null
): PermissionModeAdvisoryRow["cardStatus"] {
  if (value === null) {
    return null;
  }
  if (value === "pending" || value === "applied" || value === "dismissed") {
    return value;
  }
  throw new Error(`Unknown permission-mode suggestion card status: ${value}`);
}
