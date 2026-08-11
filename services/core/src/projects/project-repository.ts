import {
  ACTIVE_PROJECT_LIMIT,
  AGENT_ACTIVITY_SNAPSHOT_PROJECT_LIMIT,
} from "@openmeld/schemas";
import type { Project } from "@openmeld/schemas/types";

export type StoredProject = Omit<
  Project,
  "canArchive" | "canManage" | "repositoryUrl"
> & {
  hasActivity: boolean;
  repositoryUrl: string | null;
};

type ProjectRow = {
  archived_at_ms: number | null;
  created_at_ms: number;
  created_by_user_id: string;
  has_activity: number;
  id: string;
  name: string;
  organization_id: string;
  repository_fingerprint: string | null;
  repository_url: string | null;
  slug: string;
  updated_at_ms: number;
};

type ArchiveDiagnosticRow = Pick<
  ProjectRow,
  "archived_at_ms" | "created_by_user_id" | "has_activity" | "updated_at_ms"
>;

export type ArchiveProjectOutcome =
  | "archived"
  | "conflict"
  | "has_activity"
  | "not_found";

const PROJECT_ACTIVITY_EVIDENCE = `
  EXISTS (
    SELECT 1 FROM agent_activity_events events
    WHERE events.organization_id = projects.organization_id
      AND events.project_id = projects.id
  )
  OR EXISTS (
    SELECT 1 FROM agent_activity_sessions sessions
    WHERE sessions.organization_id = projects.organization_id
      AND sessions.project_id = projects.id
  )
  OR EXISTS (
    SELECT 1 FROM agent_activity_digests digests
    WHERE digests.organization_id = projects.organization_id
      AND digests.project_id = projects.id
  )
  OR EXISTS (
    SELECT 1 FROM agent_activity_daily_aggregates daily_aggregates
    WHERE daily_aggregates.organization_id = projects.organization_id
      AND daily_aggregates.project_id = projects.id
  )
  OR EXISTS (
    SELECT 1 FROM agent_activity_daily_session_keys daily_session_keys
    WHERE daily_session_keys.organization_id = projects.organization_id
      AND daily_session_keys.project_id = projects.id
  )
  OR EXISTS (
    SELECT 1
    FROM agent_activity_execution_links execution_links
    INNER JOIN agent_activity_sessions linked_sessions
      ON linked_sessions.id = execution_links.activity_session_id
    WHERE execution_links.organization_id = projects.organization_id
      AND linked_sessions.organization_id = projects.organization_id
      AND linked_sessions.project_id = projects.id
  )
`;

const PROJECT_SELECT = `
  SELECT
    id,
    organization_id,
    name,
    slug,
    repository_fingerprint,
    repository_url,
    created_by_user_id,
    created_at_ms,
    updated_at_ms,
    archived_at_ms,
    CASE WHEN ${PROJECT_ACTIVITY_EVIDENCE} THEN 1 ELSE 0 END AS has_activity
  FROM projects
`;

export async function listProjectRecords(input: {
  db: D1Database;
  organizationId: string;
}): Promise<StoredProject[]> {
  const result = await input.db
    .prepare(
      `
        ${PROJECT_SELECT}
        WHERE organization_id = ?
          AND archived_at_ms IS NULL
        ORDER BY updated_at_ms DESC, id DESC
        LIMIT ?
      `
    )
    .bind(input.organizationId, ACTIVE_PROJECT_LIMIT)
    .all<ProjectRow>();
  return (result.results ?? []).map(mapProjectRow);
}

export async function listActivitySnapshotProjectRecords(input: {
  db: D1Database;
  organizationId: string;
}): Promise<StoredProject[]> {
  const result = await input.db
    .prepare(
      `
        ${PROJECT_SELECT}
        WHERE organization_id = ?
          AND (
            archived_at_ms IS NULL
            OR ${PROJECT_ACTIVITY_EVIDENCE}
          )
        ORDER BY
          CASE WHEN archived_at_ms IS NULL THEN 0 ELSE 1 END ASC,
          updated_at_ms DESC,
          id DESC
        LIMIT ?
      `
    )
    .bind(input.organizationId, AGENT_ACTIVITY_SNAPSHOT_PROJECT_LIMIT)
    .all<ProjectRow>();
  return (result.results ?? []).map(mapProjectRow);
}

export async function readProjectRecord(input: {
  db: D1Database;
  organizationId: string;
  projectId: string;
}): Promise<StoredProject | null> {
  const row = await input.db
    .prepare(
      `
        ${PROJECT_SELECT}
        WHERE id = ? AND organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.projectId, input.organizationId)
    .first<ProjectRow>();
  return row ? mapProjectRow(row) : null;
}

export async function insertProjectRecord(input: {
  db: D1Database;
  project: StoredProject;
}): Promise<"inserted" | "limit_reached"> {
  const result = await input.db
    .prepare(
      `
        INSERT INTO projects (
          id,
          organization_id,
          name,
          slug,
          repository_fingerprint,
          repository_url,
          created_by_user_id,
          created_at_ms,
          updated_at_ms,
          archived_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (
          SELECT COUNT(*)
          FROM projects
          WHERE organization_id = ? AND archived_at_ms IS NULL
        ) < ?
      `
    )
    .bind(
      input.project.id,
      input.project.organizationId,
      input.project.name,
      input.project.slug,
      input.project.repositoryFingerprint,
      input.project.repositoryUrl,
      input.project.createdByUserId,
      input.project.createdAtMs,
      input.project.updatedAtMs,
      input.project.archivedAtMs,
      input.project.organizationId,
      ACTIVE_PROJECT_LIMIT
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1 ? "inserted" : "limit_reached";
}

export async function updateProjectRecord(input: {
  currentUpdatedAtMs: number;
  db: D1Database;
  project: StoredProject;
}): Promise<"not_updated" | "updated"> {
  const result = await input.db
    .prepare(
      `
        UPDATE projects
        SET
          name = ?,
          slug = ?,
          repository_fingerprint = ?,
          repository_url = ?,
          updated_at_ms = ?
        WHERE id = ?
          AND organization_id = ?
          AND updated_at_ms = ?
          AND archived_at_ms IS NULL
      `
    )
    .bind(
      input.project.name,
      input.project.slug,
      input.project.repositoryFingerprint,
      input.project.repositoryUrl,
      input.project.updatedAtMs,
      input.project.id,
      input.project.organizationId,
      input.currentUpdatedAtMs
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1 ? "updated" : "not_updated";
}

export async function archiveProjectRecord(input: {
  authorityMode: "creator_grace" | "owner";
  currentUpdatedAtMs: number;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<ArchiveProjectOutcome> {
  const creatorConditions =
    input.authorityMode === "creator_grace"
      ? `
          AND created_by_user_id = ?
          AND NOT (${PROJECT_ACTIVITY_EVIDENCE})
        `
      : "";
  const bindings = [
    input.nowMs,
    input.nowMs,
    input.projectId,
    input.organizationId,
    input.currentUpdatedAtMs,
    ...(input.authorityMode === "creator_grace" ? [input.userId] : []),
  ];
  const result = await input.db
    .prepare(
      `
        UPDATE projects
        SET archived_at_ms = ?, updated_at_ms = ?
        WHERE id = ?
          AND organization_id = ?
          AND updated_at_ms = ?
          AND archived_at_ms IS NULL
          ${creatorConditions}
      `
    )
    .bind(...bindings)
    .run();
  if (Number(result.meta.changes ?? 0) === 1) {
    return "archived";
  }

  const diagnostic = await input.db
    .prepare(
      `
        SELECT
          archived_at_ms,
          created_by_user_id,
          updated_at_ms,
          CASE WHEN ${PROJECT_ACTIVITY_EVIDENCE} THEN 1 ELSE 0 END AS has_activity
        FROM projects
        WHERE id = ? AND organization_id = ?
        LIMIT 1
      `
    )
    .bind(input.projectId, input.organizationId)
    .first<ArchiveDiagnosticRow>();
  if (!diagnostic) {
    return "not_found";
  }
  if (
    input.authorityMode === "creator_grace" &&
    diagnostic.archived_at_ms === null &&
    diagnostic.created_by_user_id === input.userId &&
    Number(diagnostic.updated_at_ms) === input.currentUpdatedAtMs &&
    Number(diagnostic.has_activity) === 1
  ) {
    return "has_activity";
  }
  return "conflict";
}

export function isProjectSlugConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "UNIQUE constraint failed: projects.organization_id, projects.slug"
    )
  );
}

function mapProjectRow(row: ProjectRow): StoredProject {
  return {
    archivedAtMs:
      row.archived_at_ms === null ? null : Number(row.archived_at_ms),
    createdAtMs: Number(row.created_at_ms),
    createdByUserId: row.created_by_user_id,
    hasActivity: Number(row.has_activity) === 1,
    id: row.id,
    name: row.name,
    organizationId: row.organization_id,
    repositoryFingerprint: row.repository_fingerprint,
    repositoryUrl: row.repository_url,
    slug: row.slug,
    updatedAtMs: Number(row.updated_at_ms),
  };
}
