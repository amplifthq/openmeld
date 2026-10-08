import type { PostgresDatabase, QueryResult } from "@openmeld/db/postgresql";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_BATCH_LIMIT = 500;
const MAX_RETENTION_BATCH_LIMIT = 1000;
const ACTIVE_SUBSCRIPTION_STATES = "'pending', 'ready', 'continuation_claimed'";
export const AGENT_CONTROLLER_TASK_EVENT_RETENTION_MS = 30 * DAY_MS;
export const AGENT_CONTROLLER_TASK_REGISTRATION_RETENTION_MS = 90 * DAY_MS;
export type AgentControllerTaskRetentionResult = {
  lifecycleEventsDeleted: number;
  registeredTasksDeleted: number;
  terminalOutcomesDeleted: number;
  wakePublicationsDeleted: number;
};
export async function runAgentControllerTaskRetention(input: {
  db: PostgresDatabase;
  limit?: number;
  nowMs: number;
}): Promise<AgentControllerTaskRetentionResult> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const limit = normalizeLimit(input.limit);
  const eventCutoffMs = Math.max(
    0,
    nowMs - AGENT_CONTROLLER_TASK_EVENT_RETENTION_MS
  );
  const taskCutoffMs = Math.max(
    0,
    nowMs - AGENT_CONTROLLER_TASK_REGISTRATION_RETENTION_MS
  );
  const [lifecycleEvents, registeredTasks, terminalOutcomes, wakePublications] =
    await input.db.transaction(
      async (client) =>
        [
          await client.query({
            text: `
            DELETE FROM "openmeld"."agent_controller_task_lifecycle_events"
            WHERE event_id IN (
              SELECT event.event_id
              FROM "openmeld"."agent_controller_task_lifecycle_events" AS event
              WHERE (
                  (
                    event.processed_at_ms IS NOT NULL
                    AND event.processed_at_ms < $1
                  )
                  OR (
                    event.processed_at_ms IS NULL
                    AND event.observed_at_ms < $2
                  )
                )
                AND ${hasNoActiveCoordinationReferences("event.task_key")}
              ORDER BY
                COALESCE(event.processed_at_ms, event.observed_at_ms) ASC NULLS FIRST,
                event.event_id ASC NULLS FIRST
              LIMIT $3
            )
          `,
            values: [eventCutoffMs, eventCutoffMs, limit],
          }),
          await client.query({
            text: `
            DELETE FROM "openmeld"."agent_controller_tasks"
            WHERE task_key IN (
              SELECT task.task_key
              FROM "openmeld"."agent_controller_tasks" AS task
              INNER JOIN "openmeld"."agent_task_terminal_outcomes" AS outcome
                ON outcome.task_key = task.task_key
              WHERE outcome.observed_at_ms < $1
                AND ${hasNoActiveCoordinationReferences("task.task_key")}
                AND ${hasNoUnprocessedLifecycleEvents("task.task_key")}
              ORDER BY outcome.observed_at_ms ASC NULLS FIRST, task.task_key ASC NULLS FIRST
              LIMIT $2
            )
          `,
            values: [taskCutoffMs, limit],
          }),
          await client.query({
            text: `
            DELETE FROM "openmeld"."agent_task_terminal_outcomes"
            WHERE task_key IN (
              SELECT outcome.task_key
              FROM "openmeld"."agent_task_terminal_outcomes" AS outcome
              WHERE outcome.task_key ILIKE 'controller_task:%'
                AND outcome.observed_at_ms < $1
                AND NOT EXISTS (
                  SELECT 1
                  FROM "openmeld"."agent_controller_tasks" AS task
                  WHERE task.task_key = outcome.task_key
                )
                AND ${hasNoActiveCoordinationReferences("outcome.task_key")}
                AND ${hasNoUnprocessedLifecycleEvents("outcome.task_key")}
              ORDER BY outcome.observed_at_ms ASC NULLS FIRST, outcome.task_key ASC NULLS FIRST
              LIMIT $2
            )
          `,
            values: [taskCutoffMs, limit],
          }),
          await client.query({
            text: `
            DELETE FROM "openmeld"."center_agent_wake_publications"
            WHERE publication_id IN (
              SELECT publication.publication_id
              FROM "openmeld"."center_agent_wake_publications" AS publication
              WHERE publication.state IN ('completed', 'failed')
                AND publication.completed_at_ms < $1
                AND NOT EXISTS (
                  SELECT 1
                  FROM "openmeld"."agent_delegations" AS delegation
                  WHERE delegation.delegation_id = publication.delegation_id
                    AND delegation.state = 'active'
                )
              ORDER BY
                publication.completed_at_ms ASC NULLS FIRST,
                publication.publication_id ASC NULLS FIRST
              LIMIT $2
            )
          `,
            values: [taskCutoffMs, limit],
          }),
        ] as const
    );
  return {
    lifecycleEventsDeleted: changes(lifecycleEvents),
    registeredTasksDeleted: changes(registeredTasks),
    terminalOutcomesDeleted: changes(terminalOutcomes),
    wakePublicationsDeleted: changes(wakePublications),
  };
}
function hasNoUnprocessedLifecycleEvents(taskKeySql: string): string {
  return `
    NOT EXISTS (
      SELECT 1
      FROM "openmeld"."agent_controller_task_lifecycle_events" AS lifecycle_event
      WHERE lifecycle_event.task_key = ${taskKeySql}
        AND lifecycle_event.processed_at_ms IS NULL
    )
  `;
}
function hasNoActiveCoordinationReferences(taskKeySql: string): string {
  return `
    NOT EXISTS (
      SELECT 1
      FROM "openmeld"."agent_task_completion_subscriptions" AS subscription
      WHERE subscription.state IN (${ACTIVE_SUBSCRIPTION_STATES})
        AND (
          subscription.watched_task_key = ${taskKeySql}
          OR subscription.observer_task_key = ${taskKeySql}
          OR subscription.continuation_task_key = ${taskKeySql}
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "openmeld"."agent_delegations" AS delegation
      WHERE delegation.state = 'active'
        AND delegation.parent_task_key = ${taskKeySql}
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "openmeld"."agent_delegation_children" AS child
      INNER JOIN "openmeld"."agent_delegations" AS delegation
        ON delegation.delegation_id = child.delegation_id
      WHERE delegation.state = 'active'
        AND child.task_key = ${taskKeySql}
    )
  `;
}
function changes(
  result: QueryResult<Record<string, unknown>> | undefined
): number {
  return Math.max(0, Math.trunc(Number(result?.rowCount ?? 0)));
}
function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_RETENTION_BATCH_LIMIT;
  }
  if (!(Number.isFinite(value) && value > 0)) {
    throw new Error("limit must be a positive number");
  }
  return Math.min(MAX_RETENTION_BATCH_LIMIT, Math.trunc(value));
}
function requireTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}
