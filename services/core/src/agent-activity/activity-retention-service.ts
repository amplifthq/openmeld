import { AGENT_ACTIVITY_EVENT_RETENTION_MS } from "@openmeld/schemas";
import type { AgentActivityEventType } from "@openmeld/schemas/types";
import { calculateAgentActivityDailyActiveDurations } from "./activity-active-duration";

const RETENTION_DELETE_LIMIT = 5000;
const DAILY_AGGREGATION_BATCH_LIMIT = 5000;
const DAILY_AGGREGATION_MAX_BATCHES = 10;
const DAILY_SESSION_KEY_RETENTION_DAYS = 29;

type DailyAggregationEventRow = {
  accepted_sequence: number;
  event_type: AgentActivityEventType;
  member_user_id: string;
  observed_at_ms: number;
  organization_id: string;
  project_id: string;
  provider_session_id: string;
};

export async function runAgentActivityDailyAggregation(input: {
  batchLimit?: number;
  db: D1Database;
  nowMs: number;
}) {
  const currentUtcDayStartedAtMs =
    Math.floor(input.nowMs / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
  let aggregates = 0;
  let events = 0;
  let sessionKeys = 0;
  const batchLimit = Math.min(
    resolveBatchLimit(input.batchLimit),
    DAILY_AGGREGATION_BATCH_LIMIT
  );
  for (let batch = 0; batch < DAILY_AGGREGATION_MAX_BATCHES; batch += 1) {
    const candidateRows = await input.db
      .prepare(
        `
          SELECT accepted_sequence, organization_id, project_id,
            member_user_id, provider_session_id, event_type, observed_at_ms
          FROM agent_activity_events
          WHERE daily_aggregated_at_ms IS NULL AND observed_at_ms < ?
          ORDER BY accepted_sequence ASC
          LIMIT ?
        `
      )
      .bind(currentUtcDayStartedAtMs, batchLimit)
      .all<DailyAggregationEventRow>();
    const candidates = candidateRows.results ?? [];
    if (candidates.length === 0) {
      break;
    }
    const acceptedSequencesJson = JSON.stringify(
      candidates.map((candidate) => candidate.accepted_sequence)
    );
    const expectedCandidateCount = candidates.length;
    // Duration is intentionally incremental over the current unaggregated
    // batch. A qualifying gap that crosses two batches is not bridged; this
    // accepted approximation keeps the existing bounded transaction shape.
    const activeDurationsJson = JSON.stringify(
      calculateAgentActivityDailyActiveDurations(
        candidates.map((candidate) => ({
          eventType: candidate.event_type,
          memberUserId: candidate.member_user_id,
          observedAtMs: Number(candidate.observed_at_ms),
          organizationId: candidate.organization_id,
          projectId: candidate.project_id,
          providerSessionId: candidate.provider_session_id,
        }))
      )
    );
    const [keyResult, aggregateResult, eventResult] = await input.db.batch([
      input.db
        .prepare(
          `
            WITH candidate AS (
              SELECT accepted_sequence, id, organization_id, project_id,
                member_user_id, observed_at_ms, daily_session_key
              FROM agent_activity_events
              WHERE daily_aggregated_at_ms IS NULL
                AND accepted_sequence IN (
                  SELECT CAST(value AS INTEGER) FROM json_each(?)
                )
            ), ranked AS (
              SELECT *, row_number() OVER (
                PARTITION BY daily_session_key ORDER BY accepted_sequence ASC
              ) AS session_rank
              FROM candidate
            )
            INSERT INTO agent_activity_daily_session_keys (
              daily_session_key, organization_id, project_id, member_user_id,
              utc_date, first_event_storage_id, created_at_ms, expires_at_ms
            )
            SELECT daily_session_key, organization_id, project_id,
              member_user_id,
              strftime('%Y-%m-%d', observed_at_ms / 1000, 'unixepoch'),
              id, ?,
              (CAST(observed_at_ms / 86400000 AS INTEGER) + ?) * 86400000
            FROM ranked
            WHERE session_rank = 1
              AND (SELECT count(*) FROM candidate) = ?
            ON CONFLICT(daily_session_key) DO NOTHING
          `
        )
        .bind(
          acceptedSequencesJson,
          input.nowMs,
          DAILY_SESSION_KEY_RETENTION_DAYS,
          expectedCandidateCount
        ),
      input.db
        .prepare(
          `
            WITH duration_values AS (
              SELECT
                json_extract(value, '$.organizationId') AS organization_id,
                json_extract(value, '$.projectId') AS project_id,
                json_extract(value, '$.memberUserId') AS member_user_id,
                json_extract(value, '$.utcDate') AS utc_date,
                json_extract(value, '$.activeDurationMs') AS active_duration_ms
              FROM json_each(?)
            ), candidate AS (
              SELECT accepted_sequence, id, organization_id, project_id,
                member_user_id, provider, observed_at_ms, daily_session_key
              FROM agent_activity_events
              WHERE daily_aggregated_at_ms IS NULL
                AND accepted_sequence IN (
                  SELECT CAST(value AS INTEGER) FROM json_each(?)
                )
            )
            INSERT INTO agent_activity_daily_aggregates (
              id, organization_id, project_id, member_user_id, utc_date,
              active_duration_ms, session_count, event_count, first_observed_at_ms,
              last_observed_at_ms, provider_counts_json, updated_at_ms
            )
            SELECT
              'activity_daily_' || organization_id || '_' || project_id || '_' ||
                member_user_id || '_' || strftime('%Y-%m-%d', observed_at_ms / 1000, 'unixepoch'),
              organization_id, project_id, member_user_id,
              strftime('%Y-%m-%d', observed_at_ms / 1000, 'unixepoch'),
              coalesce((
                SELECT duration.active_duration_ms
                FROM duration_values AS duration
                WHERE duration.organization_id = candidate.organization_id
                  AND duration.project_id = candidate.project_id
                  AND duration.member_user_id = candidate.member_user_id
                  AND duration.utc_date = strftime(
                    '%Y-%m-%d', candidate.observed_at_ms / 1000, 'unixepoch'
                  )
              ), 0),
              count(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM agent_activity_daily_session_keys AS session_keys
                WHERE session_keys.daily_session_key = candidate.daily_session_key
                  AND session_keys.first_event_storage_id = candidate.id
              ) THEN daily_session_key END),
              count(*), min(observed_at_ms), max(observed_at_ms),
              json_object(
                'codex', sum(provider = 'codex'),
                'claude-code', sum(provider = 'claude-code'),
                'cursor', sum(provider = 'cursor'),
                'opencode', sum(provider = 'opencode')
              ), ?
            FROM candidate
            WHERE (SELECT count(*) FROM candidate) = ?
            GROUP BY organization_id, project_id, member_user_id,
              strftime('%Y-%m-%d', observed_at_ms / 1000, 'unixepoch')
            ON CONFLICT(organization_id, project_id, member_user_id, utc_date)
            DO UPDATE SET
              active_duration_ms = agent_activity_daily_aggregates.active_duration_ms + excluded.active_duration_ms,
              session_count = agent_activity_daily_aggregates.session_count + excluded.session_count,
              event_count = agent_activity_daily_aggregates.event_count + excluded.event_count,
              first_observed_at_ms = min(agent_activity_daily_aggregates.first_observed_at_ms, excluded.first_observed_at_ms),
              last_observed_at_ms = max(agent_activity_daily_aggregates.last_observed_at_ms, excluded.last_observed_at_ms),
              provider_counts_json = json_object(
                'codex', coalesce(json_extract(agent_activity_daily_aggregates.provider_counts_json, '$.codex'), 0) + coalesce(json_extract(excluded.provider_counts_json, '$.codex'), 0),
                'claude-code', coalesce(json_extract(agent_activity_daily_aggregates.provider_counts_json, '$.claude-code'), 0) + coalesce(json_extract(excluded.provider_counts_json, '$.claude-code'), 0),
                'cursor', coalesce(json_extract(agent_activity_daily_aggregates.provider_counts_json, '$.cursor'), 0) + coalesce(json_extract(excluded.provider_counts_json, '$.cursor'), 0),
                'opencode', coalesce(json_extract(agent_activity_daily_aggregates.provider_counts_json, '$.opencode'), 0) + coalesce(json_extract(excluded.provider_counts_json, '$.opencode'), 0)
              ),
              updated_at_ms = excluded.updated_at_ms
          `
        )
        .bind(
          activeDurationsJson,
          acceptedSequencesJson,
          input.nowMs,
          expectedCandidateCount
        ),
      input.db
        .prepare(
          `
            WITH candidate AS (
              SELECT accepted_sequence
              FROM agent_activity_events
              WHERE daily_aggregated_at_ms IS NULL
                AND accepted_sequence IN (
                  SELECT CAST(value AS INTEGER) FROM json_each(?)
                )
            )
            UPDATE agent_activity_events
            SET daily_aggregated_at_ms = ?
            WHERE accepted_sequence IN (SELECT accepted_sequence FROM candidate)
              AND (SELECT count(*) FROM candidate) = ?
          `
        )
        .bind(acceptedSequencesJson, input.nowMs, expectedCandidateCount),
    ]);
    sessionKeys += Number(keyResult?.meta.changes ?? 0);
    aggregates += Number(aggregateResult?.meta.changes ?? 0);
    const batchEvents = Number(eventResult?.meta.changes ?? 0);
    if (batchEvents === 0) {
      // Another aggregation may have consumed part of the pre-read batch.
      // The transaction writes nothing unless every candidate is still
      // unaggregated, so retry from a fresh bounded read.
      continue;
    }
    if (batchEvents !== expectedCandidateCount) {
      throw new Error(
        `Agent Activity daily aggregation marked ${batchEvents} of ${expectedCandidateCount} guarded events.`
      );
    }
    events += batchEvents;
    if (batchEvents < batchLimit) {
      break;
    }
  }
  return { aggregates, events, sessionKeys };
}

export async function runAgentActivityRetention(input: {
  batchLimit?: number;
  db: D1Database;
  nowMs: number;
}) {
  const cutoff = input.nowMs - AGENT_ACTIVITY_EVENT_RETENTION_MS;
  const batchLimit = resolveBatchLimit(input.batchLimit);
  const [events, sessions, links, digests, dailySessionKeys] =
    await input.db.batch([
      input.db
        .prepare(
          `
          WITH candidate AS (
            SELECT id FROM agent_activity_events
            WHERE observed_at_ms < ? AND daily_aggregated_at_ms IS NOT NULL
            ORDER BY accepted_sequence ASC
            LIMIT ?
          )
          DELETE FROM agent_activity_events
          WHERE id IN (SELECT id FROM candidate)
        `
        )
        .bind(cutoff, batchLimit),
      input.db
        .prepare(
          `DELETE FROM agent_activity_sessions WHERE id IN (
          SELECT id FROM agent_activity_sessions
          WHERE last_observed_at_ms < ? ORDER BY expires_at_ms ASC LIMIT ?
        )`
        )
        .bind(cutoff, RETENTION_DELETE_LIMIT),
      input.db
        .prepare(
          `DELETE FROM agent_activity_execution_links WHERE id IN (
          SELECT id FROM agent_activity_execution_links
          WHERE created_at_ms < ? ORDER BY created_at_ms ASC LIMIT ?
        )`
        )
        .bind(cutoff, RETENTION_DELETE_LIMIT),
      input.db
        .prepare(
          `DELETE FROM agent_activity_digests WHERE id IN (
          SELECT id FROM agent_activity_digests
          WHERE expires_at_ms < ? ORDER BY expires_at_ms ASC LIMIT ?
        )`
        )
        .bind(input.nowMs, RETENTION_DELETE_LIMIT),
      input.db
        .prepare(
          `DELETE FROM agent_activity_daily_session_keys WHERE daily_session_key IN (
          SELECT daily_session_key FROM agent_activity_daily_session_keys
          WHERE expires_at_ms < ? ORDER BY expires_at_ms ASC LIMIT ?
        )`
        )
        .bind(input.nowMs, RETENTION_DELETE_LIMIT),
    ]);
  return {
    aggregates: 0,
    dailySessionKeys: Number(dailySessionKeys?.meta.changes ?? 0),
    digests: Number(digests?.meta.changes ?? 0),
    events: Number(events?.meta.changes ?? 0),
    executionLinks: Number(links?.meta.changes ?? 0),
    sessions: Number(sessions?.meta.changes ?? 0),
  };
}

function resolveBatchLimit(value: number | undefined) {
  if (value === undefined) {
    return RETENTION_DELETE_LIMIT;
  }
  if (!(Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Agent Activity retention batch limit must be positive.");
  }
  return Math.min(value, RETENTION_DELETE_LIMIT);
}
