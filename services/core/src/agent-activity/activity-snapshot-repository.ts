import {
  AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS,
  agentActivityDigestCitationSchema,
  agentActivityPublicSessionSchema,
  claudeCodeAgentActivityProviderMetadataSchema,
  codexAgentActivityProviderMetadataSchema,
  cursorAgentActivityProviderMetadataSchema,
  openCodeAgentActivityProviderMetadataSchema,
} from "@openmeld/schemas";
import type {
  AgentActivityPublicDigest,
  AgentActivityPublicEvent,
  AgentActivityPublicSession,
  AgentActivitySnapshotQuery,
} from "@openmeld/schemas/types";

type SessionRow = {
  client_kind: AgentActivityPublicSession["clientKind"];
  expires_at_ms: number;
  git_branch: string | null;
  git_commit: string | null;
  id: string;
  last_observed_at_ms: number;
  member_name: string;
  member_user_id: string;
  model: string | null;
  project_id: string;
  provider: AgentActivityPublicSession["provider"];
  provider_metadata_json: string;
  started_at_ms: number | null;
  status: AgentActivityPublicSession["status"];
  title: string | null;
};

type EventRow = {
  client_kind: AgentActivityPublicEvent["clientKind"];
  event_id: string;
  event_type: AgentActivityPublicEvent["eventType"];
  member_name: string;
  member_user_id: string;
  observed_at_ms: number;
  project_id: string;
  provider: AgentActivityPublicEvent["provider"];
  status: AgentActivityPublicEvent["status"];
  title: string | null;
};

type DigestRow = {
  created_at_ms: number;
  citations_json: string;
  event_count: number;
  failure_reason: string | null;
  id: string;
  project_id: string;
  status: AgentActivityPublicDigest["status"];
  summary: string | null;
  window_ended_at_ms: number;
  window_started_at_ms: number;
};

export async function readAgentActivityPublicDigests(input: {
  db: D1Database;
  organizationId: string;
  query: AgentActivitySnapshotQuery;
}): Promise<{ digests: AgentActivityPublicDigest[]; truncated: boolean }> {
  if (input.query.memberUserId || input.query.provider || input.query.status) {
    return { digests: [], truncated: false };
  }
  const rows = await input.db
    .prepare(
      `
        WITH ranked AS (
          SELECT
            id, project_id, window_started_at_ms, window_ended_at_ms,
            citations_json, event_count, summary, status, failure_reason,
            created_at_ms,
            row_number() OVER (
              PARTITION BY project_id, status
              ORDER BY created_at_ms DESC, id DESC
            ) AS status_rank
          FROM agent_activity_digests
          WHERE organization_id = ?
            AND status IN ('completed', 'failed')
            AND (? IS NULL OR project_id = ?)
        )
        SELECT
          id, project_id, window_started_at_ms, window_ended_at_ms,
          citations_json, event_count, summary, status, failure_reason,
          created_at_ms
        FROM ranked candidate
        WHERE status_rank = 1
          AND (
            status = 'completed'
            OR created_at_ms > coalesce(
              (
                SELECT max(completed.created_at_ms)
                FROM ranked completed
                WHERE completed.project_id = candidate.project_id
                  AND completed.status = 'completed'
              ),
              -1
            )
          )
        ORDER BY created_at_ms DESC, id DESC
        LIMIT 501
      `
    )
    .bind(
      input.organizationId,
      input.query.projectId ?? null,
      input.query.projectId ?? null
    )
    .all<DigestRow>();
  const digests = (rows.results ?? []).map((row) => ({
    citations: agentActivityDigestCitationSchema
      .array()
      .max(20)
      .parse(JSON.parse(row.citations_json)),
    createdAtMs: Number(row.created_at_ms),
    eventCount: Number(row.event_count),
    failureReason: row.failure_reason,
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    summary: row.summary,
    windowEndedAtMs: Number(row.window_ended_at_ms),
    windowStartedAtMs: Number(row.window_started_at_ms),
  }));
  return { digests: digests.slice(0, 500), truncated: digests.length > 500 };
}

export async function readAgentActivityPublicSessions(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  query: AgentActivitySnapshotQuery;
}): Promise<{ sessions: AgentActivityPublicSession[]; truncated: boolean }> {
  const scoped = buildFilters(
    input.organizationId,
    input.query,
    "sessions",
    input.nowMs
  );
  const rows = await input.db
    .prepare(
      `
        SELECT
          sessions.id,
          sessions.project_id,
          sessions.member_user_id,
          coalesce(users.name, 'Organization member') AS member_name,
          sessions.provider,
          sessions.client_kind,
          sessions.provider_metadata_json,
          sessions.title,
          sessions.model,
          CASE
            WHEN sessions.status = 'active' AND sessions.expires_at_ms <= ?
              THEN 'unknown'
            ELSE sessions.status
          END AS status,
          sessions.git_branch,
          sessions.git_commit,
          sessions.started_at_ms,
          sessions.last_observed_at_ms,
          sessions.expires_at_ms
        FROM agent_activity_sessions sessions
        LEFT JOIN users ON users.id = sessions.member_user_id
        WHERE ${scoped.sql}
        ORDER BY
          CASE
            WHEN sessions.status = 'active' AND sessions.expires_at_ms > ?
              THEN 0
            ELSE 1
          END ASC,
          sessions.last_observed_at_ms DESC,
          sessions.id DESC
        LIMIT 501
      `
    )
    .bind(input.nowMs, ...scoped.bindings, input.nowMs)
    .all<SessionRow>();
  const sessions = (rows.results ?? [])
    .slice(0, 500)
    .map((row) =>
      mapPublicSessionRow(row, input.query.includeProviderMetadata === true)
    );
  return { sessions, truncated: (rows.results ?? []).length > 500 };
}

function mapPublicSessionRow(
  row: SessionRow,
  includeProviderMetadata: boolean
): AgentActivityPublicSession {
  return agentActivityPublicSessionSchema.parse({
    clientKind: row.client_kind,
    expiresAtMs: Number(row.expires_at_ms),
    gitBranch: row.git_branch,
    gitCommit: row.git_commit,
    id: row.id,
    isActive: row.status === "active",
    lastObservedAtMs: Number(row.last_observed_at_ms),
    memberName: row.member_name,
    memberUserId: row.member_user_id,
    model: row.model,
    projectId: row.project_id,
    provider: row.provider,
    ...(includeProviderMetadata
      ? { providerMetadata: parsePublicProviderMetadata(row) }
      : {}),
    startedAtMs: row.started_at_ms === null ? null : Number(row.started_at_ms),
    status: row.status,
    title: row.title,
  });
}

function parsePublicProviderMetadata(row: SessionRow): unknown {
  try {
    const raw: unknown = JSON.parse(row.provider_metadata_json);
    if (row.provider === "codex") {
      return requireValidStoredProviderMetadata(
        codexAgentActivityProviderMetadataSchema,
        raw
      );
    }
    if (row.provider === "claude-code") {
      const metadata = {
        ...requireValidStoredProviderMetadata(
          claudeCodeAgentActivityProviderMetadataSchema,
          raw
        ),
      };
      Reflect.deleteProperty(metadata, "parentSessionId");
      return metadata;
    }
    if (row.provider === "cursor") {
      return requireValidStoredProviderMetadata(
        cursorAgentActivityProviderMetadataSchema,
        raw
      );
    }
    const metadata = {
      ...requireValidStoredProviderMetadata(
        openCodeAgentActivityProviderMetadataSchema,
        raw
      ),
    };
    Reflect.deleteProperty(metadata, "parentSessionId");
    return metadata;
  } catch (error) {
    throw new Error(
      `Stored Agent Activity provider metadata is invalid for session ${row.id}.`,
      { cause: error }
    );
  }
}

function requireValidStoredProviderMetadata<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: unknown[] }; success: false };
  },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Stored Agent Activity provider metadata failed validation.",
      {
        cause: parsed.error,
      }
    );
  }
  return parsed.data;
}

export async function readAgentActivityPublicEvents(input: {
  db: D1Database;
  organizationId: string;
  query: AgentActivitySnapshotQuery;
}): Promise<AgentActivityPublicEvent[]> {
  const scoped = buildFilters(input.organizationId, input.query, "events");
  const rows = await input.db
    .prepare(
      `
        SELECT
          events.event_id,
          events.project_id,
          events.member_user_id,
          coalesce(users.name, 'Organization member') AS member_name,
          events.provider,
          events.client_kind,
          events.event_type,
          events.title,
          events.status,
          events.observed_at_ms
        FROM agent_activity_events events
        LEFT JOIN users ON users.id = events.member_user_id
        WHERE ${scoped.sql}
        ORDER BY events.observed_at_ms DESC, events.event_id DESC
        LIMIT 100
      `
    )
    .bind(...scoped.bindings)
    .all<EventRow>();
  return (rows.results ?? []).map((row) => ({
    clientKind: row.client_kind,
    eventId: row.event_id,
    eventType: row.event_type,
    memberName: row.member_name,
    memberUserId: row.member_user_id,
    observedAtMs: Number(row.observed_at_ms),
    projectId: row.project_id,
    provider: row.provider,
    status: row.status,
    title: row.title,
  }));
}

export const AGENT_ACTIVITY_STALENESS_THRESHOLD_MS =
  AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS;

function buildFilters(
  organizationId: string,
  query: AgentActivitySnapshotQuery,
  alias: "events" | "sessions",
  nowMs?: number
) {
  const clauses = [`${alias}.organization_id = ?`];
  const bindings: unknown[] = [organizationId];
  for (const [column, value] of [
    ["project_id", query.projectId],
    ["member_user_id", query.memberUserId],
    ["provider", query.provider],
  ] as const) {
    if (value !== undefined) {
      clauses.push(`${alias}.${column} = ?`);
      bindings.push(value);
    }
  }
  if (query.status !== undefined) {
    if (alias === "sessions" && query.status === "active") {
      clauses.push("sessions.status = 'active' AND sessions.expires_at_ms > ?");
      bindings.push(nowMs);
    } else if (alias === "sessions" && query.status === "unknown") {
      clauses.push(
        "(sessions.status = 'unknown' OR (sessions.status = 'active' AND sessions.expires_at_ms <= ?))"
      );
      bindings.push(nowMs);
    } else {
      clauses.push(`${alias}.status = ?`);
      bindings.push(query.status);
    }
  }
  return { bindings, sql: clauses.join(" AND ") };
}
