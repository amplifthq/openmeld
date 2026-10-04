import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
import {
  buildMessageChannelConversationId,
  centerAgentRoutineAuthorizedActionsSchema,
  centerAgentRoutineCreationAttributionSchema,
  centerAgentRoutineExternalActionPolicySchema,
  messageChannelConversationLocatorSchema,
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
  agentProfileId?: string | null;
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
  agentProfileIdSnapshot: string | null;
  continuationDelegationId: string | null;
  executionEngine: RoutineExecutionEngine | null;
  routineNameSnapshot: string | null;
};
type RoutineRow = {
  agent_profile_id: string | null;
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
  message_channel_destination_json: string | null;
  destination_kind: "slack_thread" | "space" | "message_channel";
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
  agent_profile_id_snapshot: string | null;
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
  message_channel_destination_json_snapshot: string | null;
  destination_kind_snapshot:
    | "slack_thread"
    | "space"
    | "message_channel"
    | null;
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
  messageChannelLocator?: CenterAgentRoutine["messageChannelLocator"];
  destinationKind: "slack_thread" | "space" | "message_channel";
  failurePublicationAttemptCount: number;
  failureCode: string;
  failureDetail: string | null;
  organizationId: string;
  routineId: string;
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
    routine.agent_profile_id AS agent_profile_id,
    routine.organization_id AS organization_id,
    routine.name AS name,
    routine.instructions AS instructions,
    routine.authorized_actions_json AS authorized_actions_json,
    routine.external_action_policy AS external_action_policy,
    routine.schedule_kind AS schedule_kind,
    routine.cron_expression AS cron_expression,
    routine.timezone AS timezone,
    routine.run_at_ms AS run_at_ms,
    routine.message_channel_destination_json AS message_channel_destination_json,
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
  FROM "openmeld"."routines" AS routine
  LEFT JOIN "openmeld"."routine_runs" AS last_run
    ON last_run.id = (
      SELECT latest_run.id
      FROM "openmeld"."routine_runs" AS latest_run
      WHERE latest_run.routine_id = routine.id
        AND latest_run.organization_id = routine.organization_id
      ORDER BY latest_run.scheduled_for DESC NULLS LAST, latest_run.id DESC NULLS LAST
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
  | {
      status: "claimed";
      run: CenterAgentRoutineRun;
    }
  | {
      status: "lost_race";
    };
export async function listRoutineRecords(input: {
  agentProfileId?: string | null;
  db: PostgresDatabase;
  organizationId: string;
}): Promise<StoredRoutine[]> {
  const result = await input.db.query<RoutineRow>({
    text: `
        ${ROUTINE_RECORD_SELECT}
        WHERE routine.organization_id = $1
          AND routine.agent_profile_id IS NOT DISTINCT FROM $2
        ORDER BY routine.updated_at_ms DESC NULLS LAST, routine.id DESC NULLS LAST
      `,
    values: [input.organizationId, input.agentProfileId ?? null],
  });
  return (result.rows ?? []).map(mapRoutineRow);
}
export async function listDueRoutineRecords(input: {
  db: PostgresDatabase;
  limit: number;
  nowMs: number;
}): Promise<DueRoutine[]> {
  const result = await input.db.query<RoutineRow>({
    text: `
        ${ROUTINE_RECORD_SELECT}
        WHERE routine.status = 'enabled'
          AND routine.next_due_at <= $1
        ORDER BY routine.next_due_at ASC NULLS FIRST, routine.id ASC NULLS FIRST
        LIMIT $2
      `,
    values: [input.nowMs, input.limit],
  });
  return (result.rows ?? []).map((row) => {
    const routine = mapRoutineRow(row);
    if (routine.status !== "enabled" || routine.nextDueAt === null) {
      throw new Error(`Due Routine ${routine.id} has invalid schedule state`);
    }
    return routine as DueRoutine;
  });
}
export async function readRoutineRecord(input: {
  db: PostgresDatabase;
  organizationId: string;
  routineId: string;
}): Promise<StoredRoutine | null> {
  const row = await input.db
    .query<RoutineRow>({
      text: `
        ${ROUTINE_RECORD_SELECT}
        WHERE routine.id = $1 AND routine.organization_id = $2
        LIMIT 1
      `,
      values: [input.routineId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapRoutineRow(row) : null;
}
export async function countRoutineRecords(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<{
  enabled: number;
  total: number;
}> {
  const row = await input.db
    .query<{
      enabled: number | null;
      total: number;
    }>({
      text: `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'enabled' THEN 1 ELSE 0 END) AS enabled
        FROM "openmeld"."routines"
        WHERE organization_id = $1
      `,
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return {
    enabled: Number(row?.enabled ?? 0),
    total: Number(row?.total ?? 0),
  };
}
export async function isActiveCenterAgentProfile(input: {
  db: PostgresDatabase;
  organizationId: string;
  profileId: string;
}): Promise<boolean> {
  const row = await input.db
    .query<{
      present: number;
    }>({
      text: `
        SELECT 1 AS present
        FROM "openmeld"."openmeld_profiles"
        WHERE profile_id = $1
          AND organization_id = $2
          AND profile_kind = 'agent'
          AND managed_role = 'center_agent'
          AND status = 'active'
        LIMIT 1
      `,
      values: [input.profileId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return row?.present === 1;
}
export async function insertRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: PostgresDatabase;
  limit: number;
  routine: NewStoredRoutine;
}): Promise<RoutineInsertOutcome> {
  const insert = {
    text: `
        INSERT INTO "openmeld"."routines" (
          id,
          agent_profile_id,
          organization_id,
          name,
          instructions,
          authorized_actions_json,
          external_action_policy,
          schedule_kind,
          cron_expression,
          timezone,
          run_at_ms,
          message_channel_destination_json,
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
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, ((jsonb_build_object('displayName', $20::text))::jsonb || (COALESCE(
            (
              SELECT jsonb_build_object(
                'interactionSource',
                jsonb_build_object(
                  'client', source_request.resource_id,
                  'kind', 'local_agent'
                )
              )
              FROM "openmeld"."center_agent_audit_journal" AS source_request
              WHERE source_request.organization_id = $21
                AND source_request.source_native_delivery_id = $22
                AND source_request.action = 'receive_local_agent_request'
                AND source_request.resource_type = 'local_agent_client'
              ORDER BY source_request.created_at ASC NULLS FIRST, source_request.id ASC NULLS FIRST
              LIMIT 1
            ),
            '{}'
          ))::jsonb)::text, 'enabled', $23, $24, $25, $26, $27
        WHERE (
          SELECT COUNT(*) FROM "openmeld"."routines" WHERE organization_id = $28
        ) < $29
      `,
    values: [
      input.routine.id,
      input.routine.agentProfileId ?? null,
      input.routine.organizationId,
      input.routine.name,
      input.routine.instructions,
      JSON.stringify(input.routine.authorizedActions),
      input.routine.externalActionPolicy,
      input.routine.scheduleKind,
      input.routine.cronExpression,
      input.routine.timezone,
      input.routine.runAtMs,
      serializeMessageChannelDestination(input.routine.messageChannelLocator),
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
      input.limit,
    ],
  };
  const audit = prepareConditionalRoutineAuditStatement({
    action: "create_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.routine.createdAtMs,
    organizationId: input.routine.organizationId,
    routineId: input.routine.id,
  });
  return (await mutateRoutineWithAudit(input.db, insert, audit))
    ? "inserted"
    : "not_inserted";
}
export async function updateRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: PostgresDatabase;
  routine: StoredRoutine;
}): Promise<RoutineUpdateOutcome> {
  const update = {
    text: `
        UPDATE "openmeld"."routines"
        SET
          name = $1,
          instructions = $2,
          authorized_actions_json = $3,
          external_action_policy = $4,
          schedule_kind = $5,
          cron_expression = $6,
          timezone = $7,
          run_at_ms = $8,
          message_channel_destination_json = $9,
          destination_kind = $10,
          target_space_id = $11,
          slack_team_id = $12,
          slack_channel_id = $13,
          slack_thread_ts = $14,
          slack_conversation_id = $15,
          slack_thread_label = $16,
          next_due_at = $17,
          updated_by_user_id = $18,
          updated_at_ms = $19
        WHERE id = $20 AND organization_id = $21
      `,
    values: [
      input.routine.name,
      input.routine.instructions,
      JSON.stringify(input.routine.authorizedActions),
      input.routine.externalActionPolicy,
      input.routine.scheduleKind,
      input.routine.cronExpression,
      input.routine.timezone,
      input.routine.runAtMs,
      serializeMessageChannelDestination(input.routine.messageChannelLocator),
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
      input.routine.organizationId,
    ],
  };
  const audit = prepareConditionalRoutineAuditStatement({
    action: "update_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.routine.updatedAtMs,
    organizationId: input.routine.organizationId,
    routineId: input.routine.id,
  });
  return (await mutateRoutineWithAudit(input.db, update, audit))
    ? "updated"
    : "not_updated";
}
export async function pauseRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  routineId: string;
  updatedByUserId: string;
}): Promise<RoutineUpdateOutcome> {
  const update = {
    text: `
        UPDATE "openmeld"."routines"
        SET
          status = 'paused',
          next_due_at = NULL,
          updated_by_user_id = $1,
          updated_at_ms = $2
        WHERE id = $3 AND organization_id = $4 AND status = 'enabled'
      `,
    values: [
      input.updatedByUserId,
      input.nowMs,
      input.routineId,
      input.organizationId,
    ],
  };
  const audit = prepareConditionalRoutineAuditStatement({
    action: "pause_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    routineId: input.routineId,
  });
  return (await mutateRoutineWithAudit(input.db, update, audit))
    ? "updated"
    : "not_updated";
}
export async function resumeRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: PostgresDatabase;
  nextDueAt: number;
  nowMs: number;
  organizationId: string;
  routineId: string;
  updatedByUserId: string;
}): Promise<RoutineUpdateOutcome> {
  const update = {
    text: `
        UPDATE "openmeld"."routines"
        SET
          status = 'enabled',
          next_due_at = $1,
          updated_by_user_id = $2,
          updated_at_ms = $3
        WHERE id = $4
          AND organization_id = $5
          AND status = 'paused'
      `,
    values: [
      input.nextDueAt,
      input.updatedByUserId,
      input.nowMs,
      input.routineId,
      input.organizationId,
    ],
  };
  const audit = prepareConditionalRoutineAuditStatement({
    action: "resume_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    routineId: input.routineId,
  });
  return (await mutateRoutineWithAudit(input.db, update, audit))
    ? "updated"
    : "not_updated";
}
export async function deleteRoutineRecord(input: {
  actor: RoutineAuditActor;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  routineId: string;
}): Promise<RoutineDeleteOutcome> {
  const deletion = {
    text: `
        DELETE FROM "openmeld"."routines"
        WHERE id = $1 AND organization_id = $2
      `,
    values: [input.routineId, input.organizationId],
  };
  const audit = prepareConditionalRoutineAuditStatement({
    action: "delete_routine",
    actor: input.actor,
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    routineId: input.routineId,
  });
  return (await mutateRoutineWithAudit(input.db, deletion, audit))
    ? "deleted"
    : "not_deleted";
}
export async function listRoutineRunRecords(input: {
  agentProfileId?: string;
  beforeScheduledFor?: number;
  db: PostgresDatabase;
  limit: number;
  organizationId: string;
  routineId: string;
}): Promise<CenterAgentRoutineRun[]> {
  const beforeScheduledFor =
    input.beforeScheduledFor ?? Number.MAX_SAFE_INTEGER;
  const result = await input.db.query<RoutineRunRow>({
    text: `
        SELECT
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          failure_code,
          failure_detail,
          routine_name_snapshot,
          message_channel_destination_json_snapshot,
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
        FROM "openmeld"."routine_runs"
        WHERE organization_id = $1
          AND routine_id = $2
          AND agent_profile_id_snapshot IS NOT DISTINCT FROM $3
          AND scheduled_for < $4
        ORDER BY scheduled_for DESC NULLS LAST, id DESC NULLS LAST
        LIMIT $5
      `,
    values: [
      input.organizationId,
      input.routineId,
      input.agentProfileId ?? null,
      beforeScheduledFor,
      input.limit,
    ],
  });
  return (result.rows ?? []).map(mapRoutineRunRow);
}
export async function readRoutineRunRecord(input: {
  db: PostgresDatabase;
  runId: string;
}): Promise<CenterAgentRoutineRun | null> {
  const row = await readRoutineRunRow(input);
  return row ? mapRoutineRunRow(row) : null;
}
export async function readRoutineRunExecutionRecord(input: {
  db: PostgresDatabase;
  runId: string;
}): Promise<RoutineRunExecutionRecord | null> {
  const row = await readRoutineRunRow(input);
  return row
    ? {
        ...mapRoutineRunRow(row),
        agentProfileIdSnapshot: row.agent_profile_id_snapshot,
        continuationDelegationId: row.continuation_delegation_id,
        executionEngine: parseRoutineExecutionEngine(row.execution_engine),
        routineNameSnapshot: row.routine_name_snapshot,
      }
    : null;
}
async function readRoutineRunRow(input: {
  db: PostgresDatabase;
  runId: string;
}): Promise<RoutineRunRow | null> {
  return await input.db
    .query<RoutineRunRow>({
      text: `
        SELECT
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          failure_code,
          failure_detail,
          routine_name_snapshot,
          agent_profile_id_snapshot,
          message_channel_destination_json_snapshot,
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
        FROM "openmeld"."routine_runs"
        WHERE id = $1
        LIMIT 1
      `,
      values: [input.runId],
    })
    .then((result) => result.rows[0] ?? null);
}
export async function claimRoutineRunContinuationDelegation(input: {
  db: PostgresDatabase;
  delegationId: string;
  nativeDeliveryId: string;
  organizationId: string;
  runId: string;
}): Promise<"claimed" | "conflict" | "replay"> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET continuation_delegation_id = $1
        WHERE id = $2
          AND organization_id = $3
          AND execution_engine = 'workflow'
          AND status = 'submitted'
          AND native_delivery_id = $4
          AND continuation_delegation_id IS NULL
      `,
    values: [
      input.delegationId,
      input.runId,
      input.organizationId,
      input.nativeDeliveryId,
    ],
  });
  if (Number(result.rowCount ?? 0) === 1) {
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
  db: PostgresDatabase;
  delegationId: string;
  nativeDeliveryId: string;
  organizationId: string;
  runId: string;
}): Promise<"conflict" | "released" | "replay"> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET continuation_delegation_id = NULL
        WHERE id = $1
          AND organization_id = $2
          AND execution_engine = 'workflow'
          AND status = 'submitted'
          AND native_delivery_id = $3
          AND continuation_delegation_id = $4
      `,
    values: [
      input.runId,
      input.organizationId,
      input.nativeDeliveryId,
      input.delegationId,
    ],
  });
  if (Number(result.rowCount ?? 0) === 1) {
    return "released";
  }
  const run = await readRoutineRunExecutionRecord({
    db: input.db,
    runId: input.runId,
  });
  return run?.continuationDelegationId === null ? "replay" : "conflict";
}
export async function claimRoutineOccurrenceAndAdvance(input: {
  db: PostgresDatabase;
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
  const insert = {
    text: `
        INSERT INTO "openmeld"."routine_runs" (
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          failure_code,
          failure_detail,
          routine_name_snapshot,
          agent_profile_id_snapshot,
          message_channel_destination_json_snapshot,
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
        SELECT $1, id, organization_id, $2, $3, $4, $5, name, agent_profile_id, message_channel_destination_json, destination_kind,
          target_space_id, slack_team_id, slack_channel_id, slack_thread_ts,
          slack_conversation_id, slack_thread_label, $6, $7, $8
        FROM "openmeld"."routines"
        WHERE id = $9
          AND organization_id = $10
          AND status = 'enabled'
          AND next_due_at = $11
        ON CONFLICT(routine_id, scheduled_for) DO NOTHING
      `,
    values: [
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
      input.scheduledFor,
    ],
  };
  const advance = {
    text: `
        UPDATE "openmeld"."routines"
        SET
          next_due_at = $1,
          status = CASE
            WHEN schedule_kind = 'once' THEN 'completed'
            ELSE status
          END
        WHERE id = $2
          AND organization_id = $3
          AND status = 'enabled'
          AND next_due_at = $4
      `,
    values: [
      input.nextDueAt,
      input.routineId,
      input.organizationId,
      input.scheduledFor,
    ],
  };
  const claimed = await input.db.transaction(async (client) => {
    if ((await client.query(insert)).rowCount !== 1) {
      return false;
    }
    if ((await client.query(advance)).rowCount !== 1) {
      throw new Error(
        `Routine occurrence claim invariant failed for ${input.routineId} at ${input.scheduledFor}`
      );
    }
    return true;
  });
  if (!claimed) {
    return { status: "lost_race" };
  }
  const run = await readRoutineRunRecord({ db: input.db, runId: input.runId });
  if (!run) {
    throw new Error(`Routine occurrence claim lost Run ${input.runId}`);
  }
  return { run, status: "claimed" };
}
export async function quarantineInvalidRoutineSchedule(input: {
  db: PostgresDatabase;
  failureDetail: string;
  nowMs: number;
  organizationId: string;
  routineId: string;
  runId: string;
  scheduledFor: number;
}): Promise<RoutineOccurrenceClaimOutcome> {
  const insert = {
    text: `
        INSERT INTO "openmeld"."routine_runs" (
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          failure_code,
          failure_detail,
          routine_name_snapshot,
          agent_profile_id_snapshot,
          message_channel_destination_json_snapshot,
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
        SELECT $1, id, organization_id, $2, 'skipped', 'routine.schedule_invalid',
          $3, name, agent_profile_id, message_channel_destination_json, destination_kind, target_space_id, slack_team_id,
          slack_channel_id, slack_thread_ts, slack_conversation_id,
          slack_thread_label, $4, $5
        FROM "openmeld"."routines"
        WHERE id = $6
          AND organization_id = $7
          AND status = 'enabled'
          AND next_due_at = $8
        ON CONFLICT(routine_id, scheduled_for) DO NOTHING
      `,
    values: [
      input.runId,
      input.scheduledFor,
      input.failureDetail,
      input.nowMs,
      input.nowMs,
      input.routineId,
      input.organizationId,
      input.scheduledFor,
    ],
  };
  const pause = {
    text: `
        UPDATE "openmeld"."routines"
        SET status = 'paused', next_due_at = NULL
        WHERE id = $1
          AND organization_id = $2
          AND status = 'enabled'
          AND next_due_at = $3
      `,
    values: [input.routineId, input.organizationId, input.scheduledFor],
  };
  const claimed = await input.db.transaction(async (client) => {
    if ((await client.query(insert)).rowCount !== 1) {
      return false;
    }
    if ((await client.query(pause)).rowCount !== 1) {
      throw new Error(
        `Routine schedule quarantine invariant failed for ${input.routineId} at ${input.scheduledFor}`
      );
    }
    return true;
  });
  if (!claimed) {
    return { status: "lost_race" };
  }
  const run = await readRoutineRunRecord({ db: input.db, runId: input.runId });
  if (!run) {
    throw new Error(`Routine schedule quarantine lost Run ${input.runId}`);
  }
  return { run, status: "claimed" };
}
export async function failStaleClaimedRoutineRuns(input: {
  cutoffMs: number;
  db: PostgresDatabase;
  limit: number;
  nowMs: number;
}): Promise<number> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = 'failed',
          failure_code = 'routine.claim_timeout',
          failure_detail = 'Routine execution did not reach native delivery before the claim watchdog expired.',
          finished_at_ms = $1
        WHERE id IN (
          SELECT id
          FROM "openmeld"."routine_runs"
          WHERE status = 'claimed'
            AND COALESCE(execution_engine, 'legacy') = 'legacy'
            AND started_at_ms <= $2
          ORDER BY started_at_ms ASC NULLS FIRST, id ASC NULLS FIRST
          LIMIT $3
        )
          AND status = 'claimed'
      `,
    values: [input.nowMs, input.cutoffMs, input.limit],
  });
  return Number(result.rowCount ?? 0);
}
export async function markClaimedRoutineRunFailed(input: {
  db: PostgresDatabase;
  failureCode: string;
  failureDetail: string;
  nowMs: number;
  runId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = 'failed',
          failure_code = $1,
          failure_detail = $2,
          finished_at_ms = $3
        WHERE id = $4
          AND status = 'claimed'
      `,
    values: [input.failureCode, input.failureDetail, input.nowMs, input.runId],
  });
  return Number(result?.rowCount ?? 0) === 1;
}
export async function markRoutineRunSubmitted(input: {
  db: PostgresDatabase;
  nativeDeliveryId?: string | null;
  runId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = 'submitted',
          native_delivery_id = $1
        WHERE id = $2
          AND status = 'claimed'
          AND native_delivery_id IS NULL
      `,
    values: [input.nativeDeliveryId ?? null, input.runId],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function attachRoutineRunNativeDelivery(input: {
  db: PostgresDatabase;
  nativeDeliveryId: string;
  runId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET native_delivery_id = $1
        WHERE id = $2
          AND status = 'submitted'
          AND native_delivery_id IS NULL
      `,
    values: [input.nativeDeliveryId, input.runId],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function markRoutineRunSkipped(input: {
  db: PostgresDatabase;
  failureCode: string;
  failureDetail: string;
  nowMs: number;
  runId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = 'skipped',
          failure_code = $1,
          failure_detail = $2,
          finished_at_ms = $3
        WHERE id = $4
          AND status = 'claimed'
      `,
    values: [input.failureCode, input.failureDetail, input.nowMs, input.runId],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function projectRoutineRunTerminal(input: {
  db: PostgresDatabase;
  failureCode?: string | null;
  failureDetail?: string | null;
  nativeDeliveryId?: string | null;
  nowMs: number;
  publishedSignalId?: string | null;
  runId: string;
  status: "completed" | "failed";
}): Promise<CenterAgentRoutineRun | null> {
  const terminalProjection = {
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          status = $1,
          failure_code = $2,
          failure_detail = $3,
          published_signal_id = $4,
          finished_at_ms = $5
        WHERE id = $6
          AND (
            status = 'submitted'
            OR ($7 = 'failed' AND status = 'claimed')
          )
          AND ($8::text IS NULL OR native_delivery_id = $9)
      `,
    values: [
      input.status,
      input.failureCode ?? null,
      input.failureDetail ?? null,
      input.publishedSignalId ?? null,
      input.nowMs,
      input.runId,
      input.status,
      input.nativeDeliveryId ?? null,
      input.nativeDeliveryId ?? null,
    ],
  };
  const publishedSignalId = input.publishedSignalId ?? null;
  const statements = [terminalProjection];
  if (publishedSignalId) {
    statements.push({
      text: `
            UPDATE "openmeld"."routine_runs"
            SET published_signal_id = $1
            WHERE id = $2
              AND status = $3
              AND published_signal_id IS NULL
              AND ($4::text IS NULL OR native_delivery_id = $5)
          `,
      values: [
        publishedSignalId,
        input.runId,
        input.status,
        input.nativeDeliveryId ?? null,
        input.nativeDeliveryId ?? null,
      ],
    });
  }
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  return await readRoutineRunRecord({ db: input.db, runId: input.runId });
}
export async function listUnpublishedFailedRoutineRuns(input: {
  db: PostgresDatabase;
  limit: number;
  nowMs: number;
}): Promise<UnpublishedFailedRoutineRun[]> {
  const result = await input.db.query<{
    failure_code: string;
    failure_detail: string | null;
    failure_publication_attempt_count: number;
    id: string;
    organization_id: string;
    routine_id: string;
    routine_name_snapshot: string;
    message_channel_destination_json_snapshot: string | null;
    destination_kind_snapshot:
      | "slack_thread"
      | "space"
      | "message_channel"
      | null;
    slack_channel_id_snapshot: string | null;
    slack_conversation_id_snapshot: string | null;
    slack_team_id_snapshot: string | null;
    slack_thread_ts_snapshot: string | null;
    target_space_id_snapshot: string | null;
  }>({
    text: `
        SELECT
          id,
          routine_id,
          organization_id,
          failure_code,
          failure_detail,
          failure_publication_attempt_count,
          routine_name_snapshot,
          message_channel_destination_json_snapshot,
          destination_kind_snapshot,
          target_space_id_snapshot,
          slack_team_id_snapshot,
          slack_channel_id_snapshot,
          slack_thread_ts_snapshot,
          slack_conversation_id_snapshot
        FROM "openmeld"."routine_runs"
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
              destination_kind_snapshot = 'message_channel'
              AND message_channel_destination_json_snapshot IS NOT NULL
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
            OR next_failure_publication_attempt_at_ms <= $1
          )
        ORDER BY
          COALESCE(
            next_failure_publication_attempt_at_ms,
            finished_at_ms,
            0
          ) ASC NULLS FIRST,
          finished_at_ms ASC NULLS FIRST,
          id ASC NULLS FIRST
        LIMIT $2
      `,
    values: [input.nowMs, input.limit],
  });
  return (result.rows ?? []).map((row) => ({
    messageChannelLocator: parseMessageChannelDestination(
      row.message_channel_destination_json_snapshot
    ),
    destinationKind: row.destination_kind_snapshot ?? "space",
    failurePublicationAttemptCount: Number(
      row.failure_publication_attempt_count
    ),
    failureCode: row.failure_code,
    failureDetail: row.failure_detail,
    organizationId: row.organization_id,
    routineId: row.routine_id,
    routineName: row.routine_name_snapshot,
    runId: row.id,
    slackChannelId: row.slack_channel_id_snapshot,
    slackConversationId: row.slack_conversation_id_snapshot,
    slackTeamId: row.slack_team_id_snapshot,
    slackThreadTs: row.slack_thread_ts_snapshot,
    targetSpaceId: row.target_space_id_snapshot,
  }));
}
export async function claimRoutineWorkflowCheckBatch(input: {
  db: PostgresDatabase;
  limit: number;
  nowMs: number;
}): Promise<string[]> {
  const result = await input.db.query<{
    id: string;
  }>({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET workflow_last_checked_at_ms = $1
        WHERE id IN (
          SELECT id
          FROM "openmeld"."routine_runs"
          WHERE execution_engine = 'workflow'
            AND status IN ('claimed', 'submitted')
            AND workflow_last_checked_at_ms < $2
          ORDER BY workflow_last_checked_at_ms ASC NULLS FIRST, started_at_ms ASC NULLS FIRST, id ASC NULLS FIRST
          LIMIT $3
        )
        RETURNING id
      `,
    values: [input.nowMs, input.nowMs, input.limit],
  });
  return (result.rows ?? []).map((row) => row.id);
}
export async function recordFailedRoutineRunPublicationAttempt(input: {
  db: PostgresDatabase;
  nextAttemptAtMs: number;
  runId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          failure_publication_attempt_count = failure_publication_attempt_count + 1,
          next_failure_publication_attempt_at_ms = $1
        WHERE id = $2
          AND status = 'failed'
          AND published_signal_id IS NULL
      `,
    values: [input.nextAttemptAtMs, input.runId],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function markFailedRoutineRunPublished(input: {
  db: PostgresDatabase;
  publishedSignalId: string;
  runId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."routine_runs"
        SET
          published_signal_id = $1,
          next_failure_publication_attempt_at_ms = NULL
        WHERE id = $2
          AND status = 'failed'
          AND published_signal_id IS NULL
      `,
    values: [input.publishedSignalId, input.runId],
  });
  return Number(result.rowCount ?? 0) === 1;
}
function prepareConditionalRoutineAuditStatement(input: {
  action: RoutineAuditAction;
  actor: RoutineAuditActor;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  routineId: string;
}): QueryConfig {
  const onBehalfOf = input.actor.onBehalfOf;
  // The repository writes this audit only after the same transaction's
  // Routine mutation reports exactly one changed row.
  return {
    text: `
        INSERT INTO "openmeld"."center_agent_audit_journal" (
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
        SELECT $1, $2, $3, $4, $5, $6, $7, 'routine', $8, $9, $10
      `,
    values: [
      crypto.randomUUID(),
      input.organizationId,
      input.actor.actorProfileId,
      input.action,
      onBehalfOf?.profileId ?? null,
      onBehalfOf?.userId ?? null,
      onBehalfOf?.displayName ?? null,
      input.routineId,
      input.actor.sourceNativeDeliveryId,
      input.nowMs,
    ],
  };
}

async function mutateRoutineWithAudit(
  db: PostgresDatabase,
  mutation: QueryConfig,
  audit: QueryConfig
): Promise<boolean> {
  return await db.transaction(async (client) => {
    if ((await client.query(mutation)).rowCount !== 1) {
      return false;
    }
    await client.query(audit);
    return true;
  });
}
function mapRoutineRow(row: RoutineRow): StoredRoutine {
  return {
    agentProfileId: row.agent_profile_id,
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
    messageChannelLocator: parseMessageChannelDestination(
      row.message_channel_destination_json
    ),
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
  const messageChannelLocator = parseMessageChannelDestination(
    row.message_channel_destination_json_snapshot
  );
  return {
    ...(messageChannelLocator ? { messageChannelLocator } : {}),
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
function serializeMessageChannelDestination(
  locator: CenterAgentRoutine["messageChannelLocator"]
): string | null {
  return locator
    ? JSON.stringify({
        conversationId: buildMessageChannelConversationId(locator),
        locator,
      })
    : null;
}
function parseMessageChannelDestination(
  value: string | null
): CenterAgentRoutine["messageChannelLocator"] {
  if (!value) {
    return undefined;
  }
  const stored = JSON.parse(value);
  const locator = messageChannelConversationLocatorSchema.parse(stored.locator);
  if (buildMessageChannelConversationId(locator) !== stored.conversationId) {
    throw new Error("Stored Routine destination is inconsistent");
  }
  return locator;
}
