import {
  isPostgresUniqueViolation,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
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
  creationRequestSignature?: string | null;
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
  creation_request_signature: string | null;
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
// A newest-event probe uses the existing project/time index even before VACUUM
// marks recent pages all-visible. An unordered EXISTS can choose a sequential
// scan, then read the entire event table for every project with no activity.
const PROJECT_ACTIVITY_EVIDENCE = `
  (SELECT true FROM "openmeld"."agent_activity_events" events
    WHERE events.organization_id = projects.organization_id
      AND events.project_id = projects.id
    ORDER BY events.observed_at_ms DESC LIMIT 1
  ) IS TRUE
  OR EXISTS (
    SELECT 1 FROM "openmeld"."agent_activity_sessions" sessions
    WHERE sessions.organization_id = projects.organization_id
      AND sessions.project_id = projects.id
  )
  OR EXISTS (
    SELECT 1 FROM "openmeld"."agent_activity_digests" digests
    WHERE digests.organization_id = projects.organization_id
      AND digests.project_id = projects.id
  )
  OR EXISTS (
    SELECT 1 FROM "openmeld"."agent_activity_daily_aggregates" daily_aggregates
    WHERE daily_aggregates.organization_id = projects.organization_id
      AND daily_aggregates.project_id = projects.id
  )
  OR EXISTS (
    SELECT 1 FROM "openmeld"."agent_activity_daily_session_keys" daily_session_keys
    WHERE daily_session_keys.organization_id = projects.organization_id
      AND daily_session_keys.project_id = projects.id
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
    creation_request_signature,
    created_by_user_id,
    created_at_ms,
    updated_at_ms,
    archived_at_ms,
    CASE WHEN ${PROJECT_ACTIVITY_EVIDENCE} THEN 1 ELSE 0 END AS has_activity
  FROM "openmeld"."projects"
`;
export async function listProjectRecords(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<StoredProject[]> {
  const result = await input.db.query<ProjectRow>({
    text: `
        ${PROJECT_SELECT}
        WHERE organization_id = $1
          AND archived_at_ms IS NULL
        ORDER BY updated_at_ms DESC NULLS LAST, id DESC NULLS LAST
        LIMIT $2
      `,
    values: [input.organizationId, ACTIVE_PROJECT_LIMIT],
  });
  return (result.rows ?? []).map(mapProjectRow);
}
export async function listActivitySnapshotProjectRecords(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<StoredProject[]> {
  const result = await input.db.query<ProjectRow>({
    text: `
        ${PROJECT_SELECT}
        WHERE organization_id = $1
          AND (
            archived_at_ms IS NULL
            OR ${PROJECT_ACTIVITY_EVIDENCE}
          )
        ORDER BY
          CASE WHEN archived_at_ms IS NULL THEN 0 ELSE 1 END ASC NULLS FIRST,
          updated_at_ms DESC NULLS LAST,
          id DESC NULLS LAST
        LIMIT $2
      `,
    values: [input.organizationId, AGENT_ACTIVITY_SNAPSHOT_PROJECT_LIMIT],
  });
  return (result.rows ?? []).map(mapProjectRow);
}
export async function readProjectRecord(input: {
  db: PostgresDatabase;
  organizationId: string;
  projectId: string;
}): Promise<StoredProject | null> {
  const row = await input.db
    .query<ProjectRow>({
      text: `
        ${PROJECT_SELECT}
        WHERE id = $1 AND organization_id = $2
        LIMIT 1
      `,
      values: [input.projectId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapProjectRow(row) : null;
}
export async function insertProjectRecord(input: {
  db: PostgresDatabase;
  project: StoredProject;
  rejectDuplicateRepository?: boolean;
}): Promise<"inserted" | "limit_reached"> {
  const result = await input.db.transaction(async (client) => {
    // Serialize the Organization's creation policy, including the active limit
    // and contextual repository reuse, before reading its current Projects.
    await client.query({
      text: 'SELECT id FROM "openmeld"."organizations" WHERE id = $1 FOR UPDATE',
      values: [input.project.organizationId],
    });
    return client.query({
      text: `
        INSERT INTO "openmeld"."projects" (
          id,
          organization_id,
          name,
          slug,
          repository_fingerprint,
          repository_url,
          creation_request_signature,
          created_by_user_id,
          created_at_ms,
          updated_at_ms,
          archived_at_ms
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        WHERE (
          SELECT COUNT(*)
          FROM "openmeld"."projects"
          WHERE organization_id = $12 AND archived_at_ms IS NULL
        ) < $13
        AND ($14 = 0 OR NOT EXISTS (
          SELECT 1 FROM "openmeld"."projects" WHERE organization_id = $15
            AND repository_fingerprint = $16 AND archived_at_ms IS NULL
        ))
      `,
      values: [
        input.project.id,
        input.project.organizationId,
        input.project.name,
        input.project.slug,
        input.project.repositoryFingerprint,
        input.project.repositoryUrl,
        input.project.creationRequestSignature ?? null,
        input.project.createdByUserId,
        input.project.createdAtMs,
        input.project.updatedAtMs,
        input.project.archivedAtMs,
        input.project.organizationId,
        ACTIVE_PROJECT_LIMIT,
        input.rejectDuplicateRepository ? 1 : 0,
        input.project.organizationId,
        input.project.repositoryFingerprint,
      ],
    });
  });
  return result.rowCount === 1 ? "inserted" : "limit_reached";
}
export async function updateProjectRecord(input: {
  currentUpdatedAtMs: number;
  db: PostgresDatabase;
  project: StoredProject;
}): Promise<"not_updated" | "updated"> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."projects"
        SET
          name = $1,
          slug = $2,
          repository_fingerprint = $3,
          repository_url = $4,
          updated_at_ms = $5
        WHERE id = $6
          AND organization_id = $7
          AND updated_at_ms = $8
          AND archived_at_ms IS NULL
      `,
    values: [
      input.project.name,
      input.project.slug,
      input.project.repositoryFingerprint,
      input.project.repositoryUrl,
      input.project.updatedAtMs,
      input.project.id,
      input.project.organizationId,
      input.currentUpdatedAtMs,
    ],
  });
  return Number(result.rowCount ?? 0) === 1 ? "updated" : "not_updated";
}
export async function archiveProjectRecord(input: {
  authorityMode: "creator_grace" | "owner";
  currentUpdatedAtMs: number;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<ArchiveProjectOutcome> {
  const creatorConditions =
    input.authorityMode === "creator_grace"
      ? `
          AND created_by_user_id = $6
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
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."projects"
        SET archived_at_ms = $1, updated_at_ms = $2
        WHERE id = $3
          AND organization_id = $4
          AND updated_at_ms = $5
          AND archived_at_ms IS NULL
          ${creatorConditions}
      `,
    values: [...bindings],
  });
  if (Number(result.rowCount ?? 0) === 1) {
    return "archived";
  }
  const diagnostic = await input.db
    .query<ArchiveDiagnosticRow>({
      text: `
        SELECT
          archived_at_ms,
          created_by_user_id,
          updated_at_ms,
          CASE WHEN ${PROJECT_ACTIVITY_EVIDENCE} THEN 1 ELSE 0 END AS has_activity
        FROM "openmeld"."projects"
        WHERE id = $1 AND organization_id = $2
        LIMIT 1
      `,
      values: [input.projectId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
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
  return isPostgresUniqueViolation(error, "projects_org_slug_unique");
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
    creationRequestSignature: row.creation_request_signature,
    slug: row.slug,
    updatedAtMs: Number(row.updated_at_ms),
  };
}
