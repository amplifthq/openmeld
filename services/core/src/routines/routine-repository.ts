import {
  centerAgentRoutineAuthorizedActionsSchema,
  centerAgentRoutineCreationAttributionSchema,
  centerAgentRoutineExternalActionPolicySchema,
} from "@openmeld/schemas";
import type {
  CenterAgentAttribution,
  CenterAgentRoutine,
  CenterAgentRoutineAuthorizedAction,
  CenterAgentRoutineCreationAttribution,
  CenterAgentRoutineExternalActionPolicy,
  CenterAgentRoutineLastRunSummary,
  CenterAgentRoutineRun,
} from "@openmeld/schemas/types";
import type { RoutineExecutionEngine } from "./routine-execution-engine";

type RoutineAuditAction =
  | "create_routine"
  | "delete_routine"
  | "pause_routine"
  | "resume_routine"
  | "update_routine";

export type StoredRoutine = Omit<CenterAgentRoutine, "canManage"> & {
  authorizedActions: CenterAgentRoutineAuthorizedAction[];
  creationAttribution: CenterAgentRoutineCreationAttribution | null;
  externalActionPolicy: CenterAgentRoutineExternalActionPolicy;
};
export type NewStoredRoutine = StoredRoutine & {
  creationAttribution: CenterAgentRoutineCreationAttribution;
};
export type DueRoutine = StoredRoutine & {
  nextDueAt: number;
  status: "enabled";
};

export type RoutineRunExecutionRecord = CenterAgentRoutineRun & {
  continuationDelegationId: string | null;
  executionEngine: RoutineExecutionEngine | null;
  routineNameSnapshot: string | null;
};

type RoutineRow = {
  id: string;
  organization_id: string;
  name: string;
  instructions: string;
  authorized_actions_json: string;
  external_action_policy: CenterAgentRoutineExternalActionPolicy;
  schedule_kind: "cron" | "once";
  cron_expression: string | null;
  timezone: string | null;
  run_at_ms: number | null;
  destination_kind: "slack_thread" | "space";
  target_space_id: string | null;
  slack_team_id: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  slack_conversation_id: string | null;
  slack_thread_label: string | null;
  creation_attribution_json: string | null;
  status: "completed" | "enabled" | "paused";
  next_due_at: number | null;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at_ms: number;
  updated_at_ms: number;
  last_run_id: string | null;
  last_run_status: CenterAgentRoutineLastRunSummary["status"] | null;
  last_run_scheduled_for: number | null;
  last_run_failure_code: string | null;
  last_run_failure_detail: string | null;
  last_run_published_signal_id: string | null;
  last_run_started_at_ms: number | null;
  last_run_finished_at_ms: number | null;
};

type RoutineRunRow = {
  id: string;
  routine_id: string;
  organization_id: string;
  scheduled_for: number;
  status: CenterAgentRoutineRun["status"];
  failure_code: string | null;
  failure_detail: string | null;
  execution_engine: string | null;
  continuation_delegation_id: string | null;
  routine_name_snapshot: string | null;
  destination_kind_snapshot: "slack_thread" | "space" | null;
  target_space_id_snapshot: string | null;
  slack_team_id_snapshot: string | null;
  slack_channel_id_snapshot: string | null;
  slack_thread_ts_snapshot: string | null;
  slack_conversation_id_snapshot: string | null;
  slack_thread_label_snapshot: string | null;
  native_delivery_id: string | null;
  published_signal_id: string | null;
  started_at_ms: number | null;
  finished_at_ms: number | null;
};

export type UnpublishedFailedRoutineRun = {
  destinationKind: "slack_thread" | "space";
  failurePublicationAttemptCount: number;
  failureCode: string;
  failureDetail: string | null;
  organizationId: string;
  routineName: string;
  runId: string;
  slackChannelId: string | null;
  slackConversationId: string | null;
  slackTeamId: string | null;
  slackThreadTs: string | null;
  targetSpaceId: string | null;
};

const ROUTINE_RECORD_SELECT = `
  SELECT
    routine.id AS id,
    routine.organization_id AS organization_id,
    routine.name AS name,
    routine.instructions AS instructions,
    routine.authorized_actions_json AS authorized_actions_json,
    routine.external_action_policy AS external_action_policy,
    routine.schedule_kind AS schedule_kind,
    routine.cron_expression AS cron_expression,
    routine.timezone AS timezone,
    routine.run_at_ms AS run_at_ms,
    routine.destination_kind AS destination_kind,
    routine.target_space_id AS target_space_id,
    routine.slack_team_id AS slack_team_id,
    routine.slack_channel_id AS slack_channel_id,
    routine.slack_thread_ts AS slack_thread_ts,
    routine.slack_conversation_id AS slack_conversation_id,
    routine.slack_thread_label AS slack_thread_label,
    routine.creation_attribution_json AS creation_attribution_json,
    routine.status AS status,
    routine.next_due_at AS next_due_at,
    routine.created_by_user_id AS created_by_user_id,
    routine.updated_by_user_id AS updated_by_user_id,
    routine.created_at_ms AS created_at_ms,
    routine.updated_at_ms AS updated_at_ms,
    last_run.id AS last_run_id,
    last_run.status AS last_run_status,
    last_run.scheduled_for AS last_run_scheduled_for,
    last_run.failure_code AS last_run_failure_code,
    last_run.failure_detail AS last_run_failure_detail,
    last_run.published_signal_id AS last_run_published_signal_id,
    last_run.started_at_ms AS last_run_started_at_ms,
    last_run.finished_at_ms AS last_run_finished_at_ms
  FROM routines AS routine
  LEFT JOIN routine_runs AS last_run
    ON last_run.id = (
      SELECT latest_run.id
      FROM routine_runs AS latest_run
      WHERE latest_run.routine_id = routine.id
        AND latest_run.organization_id = routine.organization_id
      ORDER BY latest_run.scheduled_for DESC, latest_run.id DESC
      LIMIT 1
    )
`;

export type RoutineAuditActor = CenterAgentAttribution & {
  sourceNativeDeliveryId: string | null;
};

export type RoutineInsertOutcome = "inserted" | "not_inserted";
export type RoutineUpdateOutcome = "updated" | "not_updated";
export type RoutineDeleteOutcome = "deleted" | "not_deleted";
export type RoutineOccurrenceClaimOutcome =
  | { status: "claimed"; run: CenterAgentRoutineRun }
  | { status: "lost_race" };

export async function listRoutineRecords(input: {
  db: D1Database;
  organizationId: string;
}): Promise<StoredRoutine[]> {
  const result = await input.db
    .prepare(
      `
        ${ROUTINE_RECORD_SELECT}
        WHERE routine.organization_id = ?
        ORDER BY routine.updated_at_ms DESC, routine.id DESC
      `
    )
    .bind(input.organizationId)
    .all<RoutineRow>();

  return (result.results ?? []).map(mapRoutineRow);
}

export async function listDueRoutineRecords(input: {
  db: D1Database;
  limit: number;
  nowMs: number;
}): Promise<DueRoutine[]> {
  const result = await input.db
    .prepare(
      `
        ${ROUTINE_RECORD_SELECT}
        WHERE routine.status = 'enabled'
          AND routine.next_due_at <= ?
        ORDER BY routine.next_due_at ASC, routine.id ASC
        LIMIT ?
      `
    )
    .bind(input.nowMs, input.limit)
    .all<RoutineRow>();

  return (result.results ?? []).map((row) => {
    const routine = mapRoutineRow(row);
    if (routine.status !== "enabled" || routine.nextDueAt === null) {
      throw new Error(`Due Routine ${routine.id} has invalid schedule state`);
    }
    return routine as DueRoutine;
  });
}

export async function readRoutineRecord(input: {
  db: D1Database;
  organizationId: string;
  routineId: string;
}): Promise<StoredRoutine | null> {
  const row = await input.db
    .prepare(
      `
        ${ROUTINE_RECORD_SELECT}
        WHERE routine.id = ? AND routine.organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.routineId, input.organizationId)
    .first<RoutineRow>();

  return row ? mapRoutineRow(row) : null;
}

export async function countRoutineRecords(input: {
  db: D1Database;
  organizationId: string;
}): Promise<{ enabled: number; total: number }> {
  const row = await input.db
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'enabled' THEN 1 ELSE 0 END) AS enabled
        FROM routines
        WHERE organization_id = ?
      `
    )
    .bind(input.organizationId)
    .first<{ enabled: number | null; total: number }>();

  return {
    enabled: Number(row?.enabled ?? 0),
    total: Number(row?.total ?? 0),
  };
}

export async function isActiveCenterAgentProfile(input: {
  db: D1Database;
  organizationId: string;
  profileId: string;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        SELECT 1 AS present
        FROM openmeld_profiles
        WHERE profile_id = ?
          AND organization_id = ?
          AND profile_kind = 'agent'
          AND managed_role = 'center_agent'
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(input.profileId, input.organizationId)
    .first<{ present: number }>();
  return row?.present === 1;
}

export async function insertRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: D1Database;
  limit: number;
  routine: NewStoredRoutine;
}): Promise<RoutineInsertOutcome> {
  const insert = input.db
    .prepare(
      `
        INSERT INTO routines (
          id,
          organization_id,
          name,
          instructions,
          authorized_actions_json,
          external_action_policy,
          schedule_kind,
          cron_expression,
          timezone,
          run_at_ms,
          destination_kind,
          target_space_id,
          slack_team_id,
          slack_channel_id,
          slack_thread_ts,
          slack_conversation_id,
          slack_thread_label,
          creation_attribution_json,
          status,
          next_due_at,
          created_by_user_id,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, json_patch(
          json_object('displayName', ?),
          COALESCE(
            (
              SELECT json_object(
                'interactionSource',
                json_object(
                  'client', source_request.resource_id,
                  'kind', 'local_agent'
                )
              )
              FROM center_agent_audit_journal AS source_request
              WHERE source_request.organization_id = ?
                AND source_request.source_native_delivery_id = ?
                AND source_request.action = 'receive_local_agent_request'
                AND source_request.resource_type = 'local_agent_client'
              ORDER BY source_request.created_at ASC, source_request.id ASC
              LIMIT 1
            ),
            '{}'
          )
        ), 'enabled', ?, ?, ?, ?, ?
        WHERE (
          SELECT COUNT(*) FROM routines WHERE organization_id = ?
        ) < ?
      `
    )
    .bind(
      input.routine.id,
      input.routine.organizationId,
      input.routine.name,
      input.routine.instructions,
      JSON.stringify(input.routine.authorizedActions),
      input.routine.externalActionPolicy,
      input.routine.scheduleKind,
      input.routine.cronExpression,
      input.routine.timezone,
      input.routine.runAtMs,
      input.routine.destinationKind,
      input.routine.targetSpaceId,
      input.routine.slackTeamId,
      input.routine.slackChannelId,
      input.routine.slackThreadTs,
      input.routine.slackConversationId,
      input.routine.slackThreadLabel,
      input.routine.creationAttribution.displayName,
      input.routine.organizationId,
      input.actor.sourceNativeDeliveryId,
      input.routine.nextDueAt,
      input.routine.createdByUserId,
      input.routine.updatedByUserId,
      input.routine.createdAtMs,
      input.routine.updatedAtMs,
      input.routine.organizationId,
      input.limit
    );
  const audit = prepareConditionalRoutineAuditStatement({
    action: "create_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.routine.createdAtMs,
    organizationId: input.routine.organizationId,
    routineId: input.routine.id,
  });

  const results = await input.db.batch([insert, audit]);
  return changedExactlyOneRow(results[0]) ? "inserted" : "not_inserted";
}

export async function updateRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: D1Database;
  routine: StoredRoutine;
}): Promise<RoutineUpdateOutcome> {
  const update = input.db
    .prepare(
      `
        UPDATE routines
        SET
          name = ?,
          instructions = ?,
          authorized_actions_json = ?,
          external_action_policy = ?,
          schedule_kind = ?,
          cron_expression = ?,
          timezone = ?,
          run_at_ms = ?,
          destination_kind = ?,
          target_space_id = ?,
          slack_team_id = ?,
          slack_channel_id = ?,
          slack_thread_ts = ?,
          slack_conversation_id = ?,
          slack_thread_label = ?,
          next_due_at = ?,
          updated_by_user_id = ?,
          updated_at_ms = ?
        WHERE id = ? AND organization_id = ?
      `
    )
    .bind(
      input.routine.name,
      input.routine.instructions,
      JSON.stringify(input.routine.authorizedActions),
      input.routine.externalActionPolicy,
      input.routine.scheduleKind,
      input.routine.cronExpression,
      input.routine.timezone,
      input.routine.runAtMs,
      input.routine.destinationKind,
      input.routine.targetSpaceId,
      input.routine.slackTeamId,
      input.routine.slackChannelId,
      input.routine.slackThreadTs,
      input.routine.slackConversationId,
      input.routine.slackThreadLabel,
      input.routine.nextDueAt,
      input.routine.updatedByUserId,
      input.routine.updatedAtMs,
      input.routine.id,
      input.routine.organizationId
    );
  const audit = prepareConditionalRoutineAuditStatement({
    action: "update_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.routine.updatedAtMs,
    organizationId: input.routine.organizationId,
    routineId: input.routine.id,
  });
  const results = await input.db.batch([update, audit]);
  return changedExactlyOneRow(results[0]) ? "updated" : "not_updated";
}

export async function pauseRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  routineId: string;
  updatedByUserId: string;
}): Promise<RoutineUpdateOutcome> {
  const update = input.db
    .prepare(
      `
        UPDATE routines
        SET
          status = 'paused',
          next_due_at = NULL,
          updated_by_user_id = ?,
          updated_at_ms = ?
        WHERE id = ? AND organization_id = ? AND status = 'enabled'
      `
    )
    .bind(
      input.updatedByUserId,
      input.nowMs,
      input.routineId,
      input.organizationId
    );
  const audit = prepareConditionalRoutineAuditStatement({
    action: "pause_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    routineId: input.routineId,
  });
  const results = await input.db.batch([update, audit]);
  return changedExactlyOneRow(results[0]) ? "updated" : "not_updated";
}

export async function resumeRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: D1Database;
  nextDueAt: number;
  nowMs: number;
  organizationId: string;
  routineId: string;
  updatedByUserId: string;
}): Promise<RoutineUpdateOutcome> {
  const update = input.db
    .prepare(
      `
        UPDATE routines
        SET
          status = 'enabled',
          next_due_at = ?,
          updated_by_user_id = ?,
          updated_at_ms = ?
        WHERE id = ?
          AND organization_id = ?
          AND status = 'paused'
      `
    )
    .bind(
      input.nextDueAt,
      input.updatedByUserId,
      input.nowMs,
      input.routineId,
      input.organizationId
    );
  const audit = prepareConditionalRoutineAuditStatement({
    action: "resume_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    routineId: input.routineId,
  });
  const results = await input.db.batch([update, audit]);
  return changedExactlyOneRow(results[0]) ? "updated" : "not_updated";
}

export async function deleteRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  routineId: string;
}): Promise<RoutineDeleteOutcome> {
  const deletion = input.db
    .prepare(
      `
        DELETE FROM routines
        WHERE id = ? AND organization_id = ?
      `
    )
    .bind(input.routineId, input.organizationId);
  const audit = prepareConditionalRoutineAuditStatement({
    action: "delete_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    routineId: input.routineId,
  });
  const results = await input.db.batch([deletion, audit]);
  return changedExactlyOneRow(results[0]) ? "deleted" : "not_deleted";
}

export async function listRoutineRunRecords(input: {
  beforeScheduledFor?: number;
  db: D1Database;
  limit: number;
  organizationId: string;
  routineId: string;
}): Promise<CenterAgentRoutineRun[]> {
  const beforeScheduledFor =
    input.beforeScheduledFor ?? Number.MAX_SAFE_INTEGER;
  const result = await input.db
    .prepare(
      `
        SELECT
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          failure_code,
          failure_detail,
          routine_name_snapshot,
          destination_kind_snapshot,
          target_space_id_snapshot,
          slack_team_id_snapshot,
          slack_channel_id_snapshot,
          slack_thread_ts_snapshot,
          slack_conversation_id_snapshot,
          slack_thread_label_snapshot,
          native_delivery_id,
          published_signal_id,
          started_at_ms,
          finished_at_ms
        FROM routine_runs
        WHERE organization_id = ?
          AND routine_id = ?
          AND scheduled_for < ?
        ORDER BY scheduled_for DESC, id DESC
        LIMIT ?
      `
    )
    .bind(
      input.organizationId,
      input.routineId,
      beforeScheduledFor,
      input.limit
    )
    .all<RoutineRunRow>();
  return (result.results ?? []).map(mapRoutineRunRow);
}

export async function readRoutineRunRecord(input: {
  db: D1Database;
  runId: string;
}): Promise<CenterAgentRoutineRun | null> {
  const row = await readRoutineRunRow(input);
  return row ? mapRoutineRunRow(row) : null;
}

export async function readRoutineRunExecutionRecord(input: {
  db: D1Database;
  runId: string;
}): Promise<RoutineRunExecutionRecord | null> {
  const row = await readRoutineRunRow(input);
  return row
    ? {
        ...mapRoutineRunRow(row),
        continuationDelegationId: row.continuation_delegation_id,
        executionEngine: parseRoutineExecutionEngine(row.execution_engine),
        routineNameSnapshot: row.routine_name_snapshot,
      }
    : null;
}

async function readRoutineRunRow(input: {
  db: D1Database;
  runId: string;
}): Promise<RoutineRunRow | null> {
  return await input.db
    .prepare(
      `
        SELECT
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          failure_code,
          failure_detail,
          routine_name_snapshot,
          destination_kind_snapshot,
          target_space_id_snapshot,
          slack_team_id_snapshot,
          slack_channel_id_snapshot,
          slack_thread_ts_snapshot,
          slack_conversation_id_snapshot,
          slack_thread_label_snapshot,
          execution_engine,
          continuation_delegation_id,
          native_delivery_id,
          published_signal_id,
          started_at_ms,
          finished_at_ms
        FROM routine_runs
        WHERE id = ?
        LIMIT 1
      `
    )
    .bind(input.runId)
    .first<RoutineRunRow>();
}

export async function claimRoutineRunContinuationDelegation(input: {
  db: D1Database;
  delegationId: string;
  nativeDeliveryId: string;
  organizationId: string;
  runId: string;
}): Promise<"claimed" | "conflict" | "replay"> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET continuation_delegation_id = ?
        WHERE id = ?
          AND organization_id = ?
          AND execution_engine = 'workflow'
          AND status = 'submitted'
          AND native_delivery_id = ?
          AND continuation_delegation_id IS NULL
      `
    )
    .bind(
      input.delegationId,
      input.runId,
      input.organizationId,
      input.nativeDeliveryId
    )
    .run();
  if (Number(result.meta?.changes ?? 0) === 1) {
    return "claimed";
  }
  const run = await readRoutineRunExecutionRecord({
    db: input.db,
    runId: input.runId,
  });
  return run?.continuationDelegationId === input.delegationId
    ? "replay"
    : "conflict";
}

export async function releaseRoutineRunContinuationDelegation(input: {
  db: D1Database;
  delegationId: string;
  nativeDeliveryId: string;
  organizationId: string;
  runId: string;
}): Promise<"conflict" | "released" | "replay"> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET continuation_delegation_id = NULL
        WHERE id = ?
          AND organization_id = ?
          AND execution_engine = 'workflow'
          AND status = 'submitted'
          AND native_delivery_id = ?
          AND continuation_delegation_id = ?
      `
    )
    .bind(
      input.runId,
      input.organizationId,
      input.nativeDeliveryId,
      input.delegationId
    )
    .run();
  if (Number(result.meta?.changes ?? 0) === 1) {
    return "released";
  }
  const run = await readRoutineRunExecutionRecord({
    db: input.db,
    runId: input.runId,
  });
  return run?.continuationDelegationId === null ? "replay" : "conflict";
}

export async function claimRoutineOccurrenceAndAdvance(input: {
  db: D1Database;
  failureCode?: string | null;
  failureDetail?: string | null;
  finishedAtMs?: number | null;
  nextDueAt: number | null;
  nowMs: number;
  organizationId: string;
  routineId: string;
  runId: string;
  scheduledFor: number;
  status: "claimed" | "skipped";
  executionEngine?: RoutineExecutionEngine;
}): Promise<RoutineOccurrenceClaimOutcome> {
  const insert = input.db
    .prepare(
      `
        INSERT INTO routine_runs (
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          failure_code,
          failure_detail,
          routine_name_snapshot,
          destination_kind_snapshot,
          target_space_id_snapshot,
          slack_team_id_snapshot,
          slack_channel_id_snapshot,
          slack_thread_ts_snapshot,
          slack_conversation_id_snapshot,
          slack_thread_label_snapshot,
          execution_engine,
          started_at_ms,
          finished_at_ms
        )
        SELECT ?, id, organization_id, ?, ?, ?, ?, name, destination_kind,
          target_space_id, slack_team_id, slack_channel_id, slack_thread_ts,
          slack_conversation_id, slack_thread_label, ?, ?, ?
        FROM routines
        WHERE id = ?
          AND organization_id = ?
          AND status = 'enabled'
          AND next_due_at = ?
        ON CONFLICT(routine_id, scheduled_for) DO NOTHING
      `
    )
    .bind(
      input.runId,
      input.scheduledFor,
      input.status,
      input.failureCode ?? null,
      input.failureDetail ?? null,
      input.status === "claimed" ? (input.executionEngine ?? "legacy") : null,
      input.nowMs,
      input.finishedAtMs ?? null,
      input.routineId,
      input.organizationId,
      input.scheduledFor
    );
  const advance = input.db
    .prepare(
      `
        UPDATE routines
        SET
          next_due_at = ?,
          status = CASE
            WHEN schedule_kind = 'once' THEN 'completed'
            ELSE status
          END
        WHERE id = ?
          AND organization_id = ?
          AND status = 'enabled'
          AND next_due_at = ?
          AND changes() = 1
      `
    )
    .bind(
      input.nextDueAt,
      input.routineId,
      input.organizationId,
      input.scheduledFor
    );
  const results = await input.db.batch([insert, advance]);
  const inserted = changedExactlyOneRow(results[0]);
  const advanced = changedExactlyOneRow(results[1]);
  if (!(inserted || advanced)) {
    return { status: "lost_race" };
  }
  if (!(inserted && advanced)) {
    throw new Error(
      `Routine occurrence claim invariant failed for ${input.routineId} at ${input.scheduledFor}`
    );
  }
  const run = await readRoutineRunRecord({ db: input.db, runId: input.runId });
  if (!run) {
    throw new Error(`Routine occurrence claim lost Run ${input.runId}`);
  }
  return { run, status: "claimed" };
}

export async function quarantineInvalidRoutineSchedule(input: {
  db: D1Database;
  failureDetail: string;
  nowMs: number;
  organizationId: string;
  routineId: string;
  runId: string;
  scheduledFor: number;
}): Promise<RoutineOccurrenceClaimOutcome> {
  const insert = input.db
    .prepare(
      `
        INSERT INTO routine_runs (
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          failure_code,
          failure_detail,
          routine_name_snapshot,
          destination_kind_snapshot,
          target_space_id_snapshot,
          slack_team_id_snapshot,
          slack_channel_id_snapshot,
          slack_thread_ts_snapshot,
          slack_conversation_id_snapshot,
          slack_thread_label_snapshot,
          started_at_ms,
          finished_at_ms
        )
        SELECT ?, id, organization_id, ?, 'skipped', 'routine.schedule_invalid',
          ?, name, destination_kind, target_space_id, slack_team_id,
          slack_channel_id, slack_thread_ts, slack_conversation_id,
          slack_thread_label, ?, ?
        FROM routines
        WHERE id = ?
          AND organization_id = ?
          AND status = 'enabled'
          AND next_due_at = ?
        ON CONFLICT(routine_id, scheduled_for) DO NOTHING
      `
    )
    .bind(
      input.runId,
      input.scheduledFor,
      input.failureDetail,
      input.nowMs,
      input.nowMs,
      input.routineId,
      input.organizationId,
      input.scheduledFor
    );
  const pause = input.db
    .prepare(
      `
        UPDATE routines
        SET status = 'paused', next_due_at = NULL
        WHERE id = ?
          AND organization_id = ?
          AND status = 'enabled'
          AND next_due_at = ?
          AND changes() = 1
      `
    )
    .bind(input.routineId, input.organizationId, input.scheduledFor);
  const results = await input.db.batch([insert, pause]);
  const inserted = changedExactlyOneRow(results[0]);
  const paused = changedExactlyOneRow(results[1]);
  if (!(inserted || paused)) {
    return { status: "lost_race" };
  }
  if (!(inserted && paused)) {
    throw new Error(
      `Routine schedule quarantine invariant failed for ${input.routineId} at ${input.scheduledFor}`
    );
  }
  const run = await readRoutineRunRecord({ db: input.db, runId: input.runId });
  if (!run) {
    throw new Error(`Routine schedule quarantine lost Run ${input.runId}`);
  }
  return { run, status: "claimed" };
}

export async function failStaleClaimedRoutineRuns(input: {
  cutoffMs: number;
  db: D1Database;
  limit: number;
  nowMs: number;
}): Promise<number> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = 'failed',
          failure_code = 'routine.claim_timeout',
          failure_detail = 'Routine execution did not reach native delivery before the claim watchdog expired.',
          finished_at_ms = ?
        WHERE id IN (
          SELECT id
          FROM routine_runs
          WHERE status = 'claimed'
            AND COALESCE(execution_engine, 'legacy') = 'legacy'
            AND started_at_ms <= ?
          ORDER BY started_at_ms ASC, id ASC
          LIMIT ?
        )
          AND status = 'claimed'
      `
    )
    .bind(input.nowMs, input.cutoffMs, input.limit)
    .run();
  return Number(result.meta?.changes ?? 0);
}

export async function markClaimedRoutineRunFailed(input: {
  db: D1Database;
  failureCode: string;
  failureDetail: string;
  nowMs: number;
  runId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = 'failed',
          failure_code = ?,
          failure_detail = ?,
          finished_at_ms = ?
        WHERE id = ?
          AND status = 'claimed'
      `
    )
    .bind(input.failureCode, input.failureDetail, input.nowMs, input.runId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function markRoutineRunSubmitted(input: {
  db: D1Database;
  nativeDeliveryId?: string | null;
  runId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = 'submitted',
          native_delivery_id = ?
        WHERE id = ?
          AND status = 'claimed'
          AND native_delivery_id IS NULL
      `
    )
    .bind(input.nativeDeliveryId ?? null, input.runId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function attachRoutineRunNativeDelivery(input: {
  db: D1Database;
  nativeDeliveryId: string;
  runId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET native_delivery_id = ?
        WHERE id = ?
          AND status = 'submitted'
          AND native_delivery_id IS NULL
      `
    )
    .bind(input.nativeDeliveryId, input.runId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function markRoutineRunSkipped(input: {
  db: D1Database;
  failureCode: string;
  failureDetail: string;
  nowMs: number;
  runId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = 'skipped',
          failure_code = ?,
          failure_detail = ?,
          finished_at_ms = ?
        WHERE id = ?
          AND status = 'claimed'
      `
    )
    .bind(input.failureCode, input.failureDetail, input.nowMs, input.runId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function projectRoutineRunTerminal(input: {
  db: D1Database;
  failureCode?: string | null;
  failureDetail?: string | null;
  nativeDeliveryId?: string | null;
  nowMs: number;
  publishedSignalId?: string | null;
  runId: string;
  status: "completed" | "failed";
}): Promise<CenterAgentRoutineRun | null> {
  const terminalProjection = input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          status = ?,
          failure_code = ?,
          failure_detail = ?,
          published_signal_id = ?,
          finished_at_ms = ?
        WHERE id = ?
          AND (
            status = 'submitted'
            OR (? = 'failed' AND status = 'claimed')
          )
          AND (? IS NULL OR native_delivery_id = ?)
      `
    )
    .bind(
      input.status,
      input.failureCode ?? null,
      input.failureDetail ?? null,
      input.publishedSignalId ?? null,
      input.nowMs,
      input.runId,
      input.status,
      input.nativeDeliveryId ?? null,
      input.nativeDeliveryId ?? null
    );
  const publishedSignalId = input.publishedSignalId ?? null;
  const statements = [terminalProjection];
  if (publishedSignalId) {
    statements.push(
      input.db
        .prepare(
          `
            UPDATE routine_runs
            SET published_signal_id = ?
            WHERE id = ?
              AND status = ?
              AND published_signal_id IS NULL
              AND (? IS NULL OR native_delivery_id = ?)
          `
        )
        .bind(
          publishedSignalId,
          input.runId,
          input.status,
          input.nativeDeliveryId ?? null,
          input.nativeDeliveryId ?? null
        )
    );
  }
  await input.db.batch(statements);
  return await readRoutineRunRecord({ db: input.db, runId: input.runId });
}

export async function listUnpublishedFailedRoutineRuns(input: {
  db: D1Database;
  limit: number;
  nowMs: number;
}): Promise<UnpublishedFailedRoutineRun[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          failure_code,
          failure_detail,
          failure_publication_attempt_count,
          routine_name_snapshot,
          destination_kind_snapshot,
          target_space_id_snapshot,
          slack_team_id_snapshot,
          slack_channel_id_snapshot,
          slack_thread_ts_snapshot,
          slack_conversation_id_snapshot
        FROM routine_runs
        WHERE status = 'failed'
          AND published_signal_id IS NULL
          AND failure_code IS NOT NULL
          AND routine_name_snapshot IS NOT NULL
          AND (
            (
              COALESCE(destination_kind_snapshot, 'space') = 'space'
              AND target_space_id_snapshot IS NOT NULL
            )
            OR (
              destination_kind_snapshot = 'slack_thread'
              AND slack_team_id_snapshot IS NOT NULL
              AND slack_channel_id_snapshot IS NOT NULL
              AND slack_thread_ts_snapshot IS NOT NULL
              AND slack_conversation_id_snapshot IS NOT NULL
            )
          )
          AND (
            next_failure_publication_attempt_at_ms IS NULL
            OR next_failure_publication_attempt_at_ms <= ?
          )
        ORDER BY
          COALESCE(
            next_failure_publication_attempt_at_ms,
            finished_at_ms,
            0
          ) ASC,
          finished_at_ms ASC,
          id ASC
        LIMIT ?
      `
    )
    .bind(input.nowMs, input.limit)
    .all<{
      failure_code: string;
      failure_detail: string | null;
      failure_publication_attempt_count: number;
      id: string;
      organization_id: string;
      routine_name_snapshot: string;
      destination_kind_snapshot: "slack_thread" | "space" | null;
      slack_channel_id_snapshot: string | null;
      slack_conversation_id_snapshot: string | null;
      slack_team_id_snapshot: string | null;
      slack_thread_ts_snapshot: string | null;
      target_space_id_snapshot: string | null;
    }>();
  return (result.results ?? []).map((row) => ({
    destinationKind: row.destination_kind_snapshot ?? "space",
    failurePublicationAttemptCount: Number(
      row.failure_publication_attempt_count
    ),
    failureCode: row.failure_code,
    failureDetail: row.failure_detail,
    organizationId: row.organization_id,
    routineName: row.routine_name_snapshot,
    runId: row.id,
    slackChannelId: row.slack_channel_id_snapshot,
    slackConversationId: row.slack_conversation_id_snapshot,
    slackTeamId: row.slack_team_id_snapshot,
    slackThreadTs: row.slack_thread_ts_snapshot,
    targetSpaceId: row.target_space_id_snapshot,
  }));
}

export async function listPendingRoutineWorkflowRunIds(input: {
  db: D1Database;
  limit: number;
}): Promise<string[]> {
  const result = await input.db
    .prepare(
      `
        SELECT id
        FROM routine_runs
        WHERE execution_engine = 'workflow'
          AND status IN ('claimed', 'submitted')
        ORDER BY started_at_ms ASC, id ASC
        LIMIT ?
      `
    )
    .bind(input.limit)
    .all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id);
}

export async function recordFailedRoutineRunPublicationAttempt(input: {
  db: D1Database;
  nextAttemptAtMs: number;
  runId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          failure_publication_attempt_count = failure_publication_attempt_count + 1,
          next_failure_publication_attempt_at_ms = ?
        WHERE id = ?
          AND status = 'failed'
          AND published_signal_id IS NULL
      `
    )
    .bind(input.nextAttemptAtMs, input.runId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function markFailedRoutineRunPublished(input: {
  db: D1Database;
  publishedSignalId: string;
  runId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        UPDATE routine_runs
        SET
          published_signal_id = ?,
          next_failure_publication_attempt_at_ms = NULL
        WHERE id = ?
          AND status = 'failed'
          AND published_signal_id IS NULL
      `
    )
    .bind(input.publishedSignalId, input.runId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

function prepareConditionalRoutineAuditStatement(input: {
  action: RoutineAuditAction;
  actor: RoutineAuditActor;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  routineId: string;
}): D1PreparedStatement {
  const onBehalfOf = input.actor.onBehalfOf;
  // D1 batches execute sequentially and atomically. Keeping this audit as the
  // immediate next statement binds changes() to the Routine mutation result.
  return input.db
    .prepare(
      `
        INSERT INTO center_agent_audit_journal (
          id,
          organization_id,
          actor_profile_id,
          action,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          resource_type,
          resource_id,
          source_native_delivery_id,
          created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, 'routine', ?, ?, ?
        WHERE changes() = 1
      `
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.actor.actorProfileId,
      input.action,
      onBehalfOf?.profileId ?? null,
      onBehalfOf?.userId ?? null,
      onBehalfOf?.displayName ?? null,
      input.routineId,
      input.actor.sourceNativeDeliveryId,
      input.nowMs
    );
}

function changedExactlyOneRow(result: D1Result<unknown> | undefined): boolean {
  return Number(result?.meta.changes ?? 0) === 1;
}

function mapRoutineRow(row: RoutineRow): StoredRoutine {
  return {
    authorizedActions: centerAgentRoutineAuthorizedActionsSchema.parse(
      JSON.parse(row.authorized_actions_json) as unknown
    ),
    createdAtMs: Number(row.created_at_ms),
    createdByUserId: row.created_by_user_id,
    creationAttribution: row.creation_attribution_json
      ? centerAgentRoutineCreationAttributionSchema.parse(
          JSON.parse(row.creation_attribution_json) as unknown
        )
      : null,
    cronExpression: row.cron_expression,
    destinationKind: row.destination_kind,
    externalActionPolicy: centerAgentRoutineExternalActionPolicySchema.parse(
      row.external_action_policy
    ),
    id: row.id,
    instructions: row.instructions,
    lastRun: mapRoutineLastRunSummary(row),
    name: row.name,
    nextDueAt: row.next_due_at === null ? null : Number(row.next_due_at),
    organizationId: row.organization_id,
    runAtMs: row.run_at_ms === null ? null : Number(row.run_at_ms),
    scheduleKind: row.schedule_kind,
    slackChannelId: row.slack_channel_id,
    slackConversationId: row.slack_conversation_id,
    slackTeamId: row.slack_team_id,
    slackThreadLabel: row.slack_thread_label,
    slackThreadTs: row.slack_thread_ts,
    status: row.status,
    targetSpaceId: row.target_space_id,
    timezone: row.timezone,
    updatedAtMs: Number(row.updated_at_ms),
    updatedByUserId: row.updated_by_user_id,
  };
}

function mapRoutineLastRunSummary(
  row: RoutineRow
): CenterAgentRoutineLastRunSummary | null {
  if (row.last_run_id === null) {
    return null;
  }
  if (row.last_run_status === null || row.last_run_scheduled_for === null) {
    throw new Error(
      `Routine ${row.id} latest Run projection is missing required fields.`
    );
  }
  return {
    failureCode: row.last_run_failure_code,
    failureDetail: row.last_run_failure_detail,
    finishedAtMs:
      row.last_run_finished_at_ms === null
        ? null
        : Number(row.last_run_finished_at_ms),
    id: row.last_run_id,
    publishedSignalId: row.last_run_published_signal_id,
    scheduledFor: Number(row.last_run_scheduled_for),
    startedAtMs:
      row.last_run_started_at_ms === null
        ? null
        : Number(row.last_run_started_at_ms),
    status: row.last_run_status,
  };
}

function mapRoutineRunRow(row: RoutineRunRow): CenterAgentRoutineRun {
  return {
    destinationKind: row.destination_kind_snapshot ?? "space",
    failureCode: row.failure_code,
    failureDetail: row.failure_detail,
    finishedAtMs:
      row.finished_at_ms === null ? null : Number(row.finished_at_ms),
    id: row.id,
    nativeDeliveryId: row.native_delivery_id,
    organizationId: row.organization_id,
    publishedSignalId: row.published_signal_id,
    routineId: row.routine_id,
    scheduledFor: Number(row.scheduled_for),
    startedAtMs: row.started_at_ms === null ? null : Number(row.started_at_ms),
    status: row.status,
    slackChannelId: row.slack_channel_id_snapshot,
    slackConversationId: row.slack_conversation_id_snapshot,
    slackTeamId: row.slack_team_id_snapshot,
    slackThreadLabel: row.slack_thread_label_snapshot,
    slackThreadTs: row.slack_thread_ts_snapshot,
    targetSpaceId: row.target_space_id_snapshot,
  };
}

function parseRoutineExecutionEngine(
  value: string | null
): RoutineExecutionEngine | null {
  if (value === null) {
    return null;
  }
  if (value === "legacy" || value === "workflow") {
    return value;
  }
  throw new Error(`Routine Run has invalid execution engine ${value}`);
}
