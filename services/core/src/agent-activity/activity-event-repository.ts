import type { AgentActivityEvent } from "@openmeld/schemas/types";

type StoredEventIdentity = { canonical_payload_hash: string };

export async function acceptAgentActivityEventRecord(input: {
  db: D1Database;
  deviceId: string;
  event: AgentActivityEvent;
  memberUserId: string;
  nowMs: number;
  openMeldServiceRuntimeId: string;
}): Promise<
  | "accepted"
  | "event_id_conflict"
  | "project_archived"
  | "project_missing"
  | "reused"
> {
  const canonical = await canonicalizeAgentActivityEvent(input.event);
  const existing = await readStoredEventIdentity(
    input.db,
    input.event.organizationId,
    input.event.eventId
  );
  if (existing) {
    return existing.canonical_payload_hash === canonical.hash
      ? "reused"
      : "event_id_conflict";
  }
  const sessionId = await buildActivitySessionId({
    deviceId: input.deviceId,
    memberUserId: input.memberUserId,
    organizationId: input.event.organizationId,
    provider: input.event.provider,
    providerSessionId: input.event.providerSessionId,
  });
  const providerMetadataJson = stableStringify(input.event.providerMetadata);
  const storageEventId = await buildActivityEventStorageId({
    eventId: input.event.eventId,
    organizationId: input.event.organizationId,
  });
  const dailySessionKey = await buildDailySessionKey({
    deviceId: input.deviceId,
    memberUserId: input.memberUserId,
    observedAtMs: input.event.observedAtMs,
    organizationId: input.event.organizationId,
    projectId: input.event.projectId,
    provider: input.event.provider,
    providerSessionId: input.event.providerSessionId,
  });
  const [insertResult] = await input.db.batch([
    input.db
      .prepare(
        `
          INSERT INTO agent_activity_events (
            id, event_id, canonical_payload_hash, organization_id, project_id,
            member_user_id, device_id, openmeld_service_runtime_id, provider,
            client_kind, provider_session_id, event_type, title, model, status,
            git_branch, git_commit, repository_fingerprint, started_at_ms,
            observed_at_ms, expires_at_ms, provider_metadata_json, accepted_at_ms,
            daily_session_key, daily_aggregated_at_ms
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
          WHERE EXISTS (
            SELECT 1
            FROM projects
            WHERE id = ?
              AND organization_id = ?
              AND archived_at_ms IS NULL
          )
          ON CONFLICT(organization_id, event_id) DO NOTHING
        `
      )
      .bind(
        storageEventId,
        input.event.eventId,
        canonical.hash,
        input.event.organizationId,
        input.event.projectId,
        input.memberUserId,
        input.deviceId,
        input.openMeldServiceRuntimeId,
        input.event.provider,
        input.event.clientKind,
        input.event.providerSessionId,
        input.event.eventType,
        input.event.title,
        input.event.model,
        input.event.status,
        input.event.gitBranch,
        input.event.gitCommit,
        input.event.repositoryFingerprint,
        input.event.startedAtMs,
        input.event.observedAtMs,
        input.event.expiresAtMs,
        providerMetadataJson,
        input.nowMs,
        dailySessionKey,
        input.event.projectId,
        input.event.organizationId
      ),
    input.db
      .prepare(
        `
          INSERT INTO agent_activity_sessions (
            id, organization_id, project_id, member_user_id, device_id,
            openmeld_service_runtime_id, provider, client_kind,
            provider_session_id, title, model, status, git_branch, git_commit,
            repository_fingerprint, started_at_ms, last_observed_at_ms,
            expires_at_ms, provider_metadata_json, last_event_id,
            last_accepted_sequence, created_at_ms, updated_at_ms
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (
              SELECT accepted_sequence FROM agent_activity_events
              WHERE organization_id = ? AND event_id = ?
                AND canonical_payload_hash = ?
            ), ?, ?
          WHERE EXISTS (
            SELECT 1 FROM agent_activity_events
            WHERE organization_id = ? AND event_id = ?
              AND canonical_payload_hash = ?
          )
          ON CONFLICT(
            organization_id, member_user_id, device_id, provider,
            provider_session_id
          ) DO UPDATE SET
            project_id = excluded.project_id,
            openmeld_service_runtime_id = excluded.openmeld_service_runtime_id,
            client_kind = CASE
              WHEN excluded.client_kind = 'unknown'
                THEN agent_activity_sessions.client_kind
              ELSE excluded.client_kind
            END,
            title = coalesce(excluded.title, agent_activity_sessions.title),
            model = coalesce(excluded.model, agent_activity_sessions.model),
            status = excluded.status,
            git_branch = coalesce(
              excluded.git_branch,
              agent_activity_sessions.git_branch
            ),
            git_commit = coalesce(
              excluded.git_commit,
              agent_activity_sessions.git_commit
            ),
            repository_fingerprint = excluded.repository_fingerprint,
            started_at_ms = coalesce(
              agent_activity_sessions.started_at_ms,
              excluded.started_at_ms
            ),
            last_observed_at_ms = excluded.last_observed_at_ms,
            expires_at_ms = excluded.expires_at_ms,
            provider_metadata_json = json_patch(
              agent_activity_sessions.provider_metadata_json,
              excluded.provider_metadata_json
            ),
            last_event_id = excluded.last_event_id,
            last_accepted_sequence = excluded.last_accepted_sequence,
            updated_at_ms = excluded.updated_at_ms
          WHERE excluded.last_observed_at_ms >
              agent_activity_sessions.last_observed_at_ms
            OR (
              excluded.last_observed_at_ms =
                agent_activity_sessions.last_observed_at_ms
              AND excluded.last_accepted_sequence >
                agent_activity_sessions.last_accepted_sequence
            )
        `
      )
      .bind(
        sessionId,
        input.event.organizationId,
        input.event.projectId,
        input.memberUserId,
        input.deviceId,
        input.openMeldServiceRuntimeId,
        input.event.provider,
        input.event.clientKind,
        input.event.providerSessionId,
        input.event.title,
        input.event.model,
        input.event.status,
        input.event.gitBranch,
        input.event.gitCommit,
        input.event.repositoryFingerprint,
        input.event.startedAtMs,
        input.event.observedAtMs,
        input.event.expiresAtMs,
        providerMetadataJson,
        input.event.eventId,
        input.event.organizationId,
        input.event.eventId,
        canonical.hash,
        input.nowMs,
        input.nowMs,
        input.event.organizationId,
        input.event.eventId,
        canonical.hash
      ),
  ]);
  if (!insertResult) {
    throw new Error(
      "Agent Activity event batch did not return insert evidence."
    );
  }
  if (Number(insertResult.meta.changes ?? 0) === 1) {
    return "accepted";
  }
  const raced = await readStoredEventIdentity(
    input.db,
    input.event.organizationId,
    input.event.eventId
  );
  if (raced) {
    return raced.canonical_payload_hash === canonical.hash
      ? "reused"
      : "event_id_conflict";
  }
  const project = await input.db
    .prepare(
      `
        SELECT archived_at_ms
        FROM projects
        WHERE id = ? AND organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.event.projectId, input.event.organizationId)
    .first<{ archived_at_ms: number | null }>();
  if (!project) {
    return "project_missing";
  }
  return project.archived_at_ms === null
    ? "event_id_conflict"
    : "project_archived";
}

async function readStoredEventIdentity(
  db: D1Database,
  organizationId: string,
  eventId: string
): Promise<StoredEventIdentity | null> {
  return await db
    .prepare(
      `
        SELECT canonical_payload_hash
        FROM agent_activity_events
        WHERE organization_id = ? AND event_id = ?
        LIMIT 1
      `
    )
    .bind(organizationId, eventId)
    .first<StoredEventIdentity>();
}

async function buildActivityEventStorageId(input: {
  eventId: string;
  organizationId: string;
}): Promise<string> {
  const digest = await sha256Hex(stableStringify(input));
  return `activity_event_${digest}`;
}

async function canonicalizeAgentActivityEvent(event: AgentActivityEvent) {
  const json = stableStringify(event);
  return { hash: `sha256:${await sha256Hex(json)}` };
}

async function buildActivitySessionId(input: {
  deviceId: string;
  memberUserId: string;
  organizationId: string;
  provider: string;
  providerSessionId: string;
}): Promise<string> {
  const digest = await sha256Hex(stableStringify(input));
  return `activity_session_${digest}`;
}

async function buildDailySessionKey(input: {
  deviceId: string;
  memberUserId: string;
  observedAtMs: number;
  organizationId: string;
  projectId: string;
  provider: string;
  providerSessionId: string;
}) {
  const utcDate = new Date(input.observedAtMs).toISOString().slice(0, 10);
  return `sha256:${await sha256Hex(
    stableStringify({
      deviceId: input.deviceId,
      memberUserId: input.memberUserId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      utcDate,
    })
  )}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)])
    );
  }
  return value;
}
