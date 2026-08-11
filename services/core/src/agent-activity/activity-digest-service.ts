import {
  AGENT_ACTIVITY_DIGEST_EVIDENCE_MAX_ITEMS,
  AGENT_ACTIVITY_EVENT_RETENTION_MS,
  summarizeAgentActivityDigestRpcResponseSchema,
} from "@openmeld/schemas";
import type {
  AgentActivityDigestEvidence,
  SummarizeAgentActivityDigestRpcInput,
} from "@openmeld/schemas/types";

const DIGEST_EVENT_THRESHOLD = 10;
const DIGEST_TIME_THRESHOLD_MS = 30 * 60_000;
const DIGEST_PENDING_TIMEOUT_MS = 10 * 60_000;
const DIGEST_RETENTION_MS = 90 * 24 * 60 * 60_000;
const DIGEST_PROJECTS_PER_TICK = 10;

type EligibleWindow = {
  event_count: number;
  organization_id: string;
  previous_cursor_sequence: number;
  project_id: string;
  source_cursor_sequence: number;
  window_ended_at_ms: number;
  window_started_at_ms: number;
};

type EvidenceRow = {
  event_id: string;
  event_type: AgentActivityDigestEvidence["eventType"];
  member_name: string;
  observed_at_ms: number;
  provider: AgentActivityDigestEvidence["provider"];
  status: AgentActivityDigestEvidence["status"];
  title: string | null;
};

export async function runAgentActivityDigestTick(input: {
  db: D1Database;
  nowMs: number;
  summarize: (
    request: SummarizeAgentActivityDigestRpcInput
  ) => Promise<unknown>;
}) {
  const recoveredPending = await failAbandonedPendingDigests(
    input.db,
    input.nowMs
  );
  const windows = await readEligibleWindows(input.db, input.nowMs);
  let completed = 0;
  let failed = 0;
  for (const window of windows) {
    const evidence = await readDigestEvidence(input.db, window);
    if (evidence.length === 0) {
      continue;
    }
    const digestId = await buildDigestId(window);
    const claim = await input.db
      .prepare(
        `
          INSERT INTO agent_activity_digests (
            id, organization_id, project_id,
            source_cursor_accepted_sequence,
            window_started_at_ms,
            window_ended_at_ms, event_count, citations_json,
            summary, status, failure_reason,
            created_at_ms, expires_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', NULL, 'pending', NULL, ?, ?)
          ON CONFLICT(
            organization_id, project_id, source_cursor_accepted_sequence
          ) DO NOTHING
        `
      )
      .bind(
        digestId,
        window.organization_id,
        window.project_id,
        window.source_cursor_sequence,
        Number(window.window_started_at_ms),
        Number(window.window_ended_at_ms),
        Number(window.event_count),
        input.nowMs,
        input.nowMs + DIGEST_RETENTION_MS
      )
      .run();
    if (Number(claim.meta.changes ?? 0) !== 1) {
      continue;
    }
    try {
      const response = summarizeAgentActivityDigestRpcResponseSchema.parse(
        await input.summarize({
          eventCount: Number(window.event_count),
          evidence,
          organizationId: window.organization_id,
          projectId: window.project_id,
          windowEndedAtMs: Number(window.window_ended_at_ms),
          windowStartedAtMs: Number(window.window_started_at_ms),
        })
      );
      const citations = requireEvidenceCitations(response.citations, evidence);
      const completion = await input.db
        .prepare(
          `
            UPDATE agent_activity_digests
            SET summary = ?, citations_json = ?, status = 'completed', failure_reason = NULL
            WHERE id = ? AND status = 'pending'
          `
        )
        .bind(response.summary, JSON.stringify(citations), digestId)
        .run();
      if (Number(completion.meta.changes ?? 0) === 1) {
        completed += 1;
      }
    } catch (error) {
      const failureReason = classifyDigestFailure(error);
      console.warn("[core.agent_activity.digest_failed]", {
        digestId,
        errorName: error instanceof Error ? error.name : "NonError",
        failureReason,
        organizationId: window.organization_id,
        projectId: window.project_id,
      });
      const failure = await input.db
        .prepare(
          `
            UPDATE agent_activity_digests
            SET status = 'failed', failure_reason = ?
            WHERE id = ? AND status = 'pending'
          `
        )
        .bind(failureReason, digestId)
        .run();
      if (Number(failure.meta.changes ?? 0) === 1) {
        failed += 1;
      }
    }
  }
  return { completed, failed, inspected: windows.length, recoveredPending };
}

function requireEvidenceCitations(
  citations: readonly { eventId: string; observedAtMs: number }[],
  evidence: readonly AgentActivityDigestEvidence[]
) {
  const evidenceById = new Map(
    evidence.map((event) => [event.eventId, event.observedAtMs])
  );
  for (const citation of citations) {
    if (evidenceById.get(citation.eventId) !== citation.observedAtMs) {
      throw new Error(
        "Agent Activity digest citation is outside its evidence."
      );
    }
  }
  return citations;
}

function classifyDigestFailure(error: unknown) {
  if (
    error instanceof Error &&
    error.message === "Agent Activity digest citation is outside its evidence."
  ) {
    return "summarization_citation_mismatch";
  }
  if (error instanceof Error && error.name === "ZodError") {
    return "summarization_invalid_output";
  }
  return "summarization_unavailable";
}

async function failAbandonedPendingDigests(db: D1Database, nowMs: number) {
  const result = await db
    .prepare(
      `
        UPDATE agent_activity_digests
        SET status = 'failed', failure_reason = 'summarization_interrupted'
        WHERE status = 'pending' AND created_at_ms < ?
      `
    )
    .bind(nowMs - DIGEST_PENDING_TIMEOUT_MS)
    .run();
  return Number(result.meta.changes ?? 0);
}

async function readEligibleWindows(db: D1Database, nowMs: number) {
  const result = await db
    .prepare(
      `
        WITH latest_ranked AS (
          SELECT organization_id, project_id,
            source_cursor_accepted_sequence,
            row_number() OVER (
              PARTITION BY organization_id, project_id
              ORDER BY source_cursor_accepted_sequence DESC
            ) AS cursor_rank
          FROM agent_activity_digests
        ), latest AS (
          SELECT organization_id, project_id,
            source_cursor_accepted_sequence
          FROM latest_ranked WHERE cursor_rank = 1
        )
        SELECT
          events.organization_id,
          events.project_id,
          coalesce(latest.source_cursor_accepted_sequence, 0) AS previous_cursor_sequence,
          max(events.accepted_sequence) AS source_cursor_sequence,
          min(events.observed_at_ms) AS window_started_at_ms,
          max(events.observed_at_ms) AS window_ended_at_ms,
          count(*) AS event_count
        FROM agent_activity_events AS events
        LEFT JOIN latest
          ON latest.organization_id = events.organization_id
          AND latest.project_id = events.project_id
        WHERE events.accepted_at_ms >= ?
          AND events.accepted_sequence >
            coalesce(latest.source_cursor_accepted_sequence, 0)
        GROUP BY events.organization_id, events.project_id
        HAVING count(*) >= ? OR min(events.observed_at_ms) <= ?
        ORDER BY window_ended_at_ms ASC
        LIMIT ?
      `
    )
    .bind(
      nowMs - AGENT_ACTIVITY_EVENT_RETENTION_MS,
      DIGEST_EVENT_THRESHOLD,
      nowMs - DIGEST_TIME_THRESHOLD_MS,
      DIGEST_PROJECTS_PER_TICK
    )
    .all<EligibleWindow>();
  return result.results ?? [];
}

async function readDigestEvidence(db: D1Database, window: EligibleWindow) {
  const result = await db
    .prepare(
      `
        SELECT events.event_id, events.event_type, events.observed_at_ms,
          events.provider, events.status, events.title,
          coalesce(users.name, 'Organization member') AS member_name
        FROM agent_activity_events AS events
        LEFT JOIN users ON users.id = events.member_user_id
        WHERE events.organization_id = ? AND events.project_id = ?
          AND events.accepted_sequence > ?
          AND events.accepted_sequence <= ?
        ORDER BY events.accepted_sequence ASC
        LIMIT ?
      `
    )
    .bind(
      window.organization_id,
      window.project_id,
      window.previous_cursor_sequence,
      window.source_cursor_sequence,
      AGENT_ACTIVITY_DIGEST_EVIDENCE_MAX_ITEMS
    )
    .all<EvidenceRow>();
  return (result.results ?? []).map((row) => ({
    eventId: row.event_id,
    eventType: row.event_type,
    memberName: row.member_name,
    observedAtMs: Number(row.observed_at_ms),
    provider: row.provider,
    status: row.status,
    title: row.title,
  }));
}

async function buildDigestId(window: EligibleWindow) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        organizationId: window.organization_id,
        projectId: window.project_id,
        sourceCursorSequence: window.source_cursor_sequence,
      })
    )
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `activity_digest_${hex}`;
}
