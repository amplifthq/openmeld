import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { AGENT_ACTIVITY_STATS_DAILY_LIMIT } from "@openmeld/schemas";
import type {
  AgentActivityStatsDaily,
  AgentActivityStatsResponse,
} from "@openmeld/schemas/types";

type StatsTotalsRow = {
  since_utc_date: string | null;
  total_active_duration_ms: number;
  total_sessions: number;
};
type StatsDailyRow = {
  active_duration_ms: number;
  session_count: number;
  utc_date: string;
};
export async function readAgentActivityStats(input: {
  db: PostgresDatabase;
  organizationId: string;
  projectId?: string;
}): Promise<AgentActivityStatsResponse> {
  const scope = buildStatsScope(input);
  const [totals, dailyRows] = await Promise.all([
    input.db
      .query<StatsTotalsRow>({
        text: `
          SELECT
            min(utc_date) AS since_utc_date,
            coalesce(sum(active_duration_ms), 0) AS total_active_duration_ms,
            coalesce(sum(session_count), 0) AS total_sessions
          FROM "openmeld"."agent_activity_daily_aggregates"
          WHERE ${scope.whereClause}
        `,
        values: [...scope.bindings],
      })
      .then((result) => result.rows[0] ?? null),
    input.db.query<StatsDailyRow>({
      text: `
          SELECT
            utc_date,
            sum(active_duration_ms) AS active_duration_ms,
            sum(session_count) AS session_count
          FROM "openmeld"."agent_activity_daily_aggregates"
          WHERE ${scope.whereClause}
          GROUP BY utc_date
          ORDER BY utc_date DESC NULLS LAST
          LIMIT $${scope.bindings.length + 1}
        `,
      values: [...scope.bindings, AGENT_ACTIVITY_STATS_DAILY_LIMIT + 1],
    }),
  ]);
  if (!totals) {
    throw new Error("Agent Activity stats totals query returned no row.");
  }
  const rows = dailyRows.rows ?? [];
  const daily = rows
    .slice(0, AGENT_ACTIVITY_STATS_DAILY_LIMIT)
    .map(mapDailyRow)
    .reverse();
  return {
    daily,
    dailyTruncated: rows.length > AGENT_ACTIVITY_STATS_DAILY_LIMIT,
    organizationId: input.organizationId,
    sinceMs:
      totals.since_utc_date === null
        ? null
        : parseUtcDateStartMs(totals.since_utc_date),
    totalActiveDurationMs: Number(totals.total_active_duration_ms),
    totalSessions: Number(totals.total_sessions),
  };
}
function buildStatsScope(input: {
  organizationId: string;
  projectId?: string;
}): {
  bindings: string[];
  whereClause: string;
} {
  if (input.projectId) {
    return {
      bindings: [input.organizationId, input.projectId],
      whereClause: "organization_id = $1 AND project_id = $2",
    };
  }
  return {
    bindings: [input.organizationId],
    whereClause: "organization_id = $1",
  };
}
function mapDailyRow(row: StatsDailyRow): AgentActivityStatsDaily {
  return {
    activeDurationMs: Number(row.active_duration_ms),
    sessionCount: Number(row.session_count),
    utcDate: row.utc_date,
  };
}
function parseUtcDateStartMs(utcDate: string): number {
  const startMs = Date.parse(`${utcDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(startMs) ||
    new Date(startMs).toISOString().slice(0, 10) !== utcDate
  ) {
    throw new Error(`Stored Agent Activity UTC date is invalid: ${utcDate}.`);
  }
  return startMs;
}
