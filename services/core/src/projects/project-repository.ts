import { buildRepositoryFingerprint } from "@openmeld/projects";
import {
  ACTIVE_PROJECT_LIMIT,
  AGENT_ACTIVITY_SNAPSHOT_PROJECT_LIMIT,
  projectCommonAgentsSchema,
  projectIssueDestinationSchema,
} from "@openmeld/schemas";
import type {
  Project,
  ProjectCommonAgents,
  ProjectIssueDestination,
  ProjectIssueRouting,
  ProjectRepositorySettings,
} from "@openmeld/schemas/types";

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
    creation_request_signature,
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

export async function readActiveProjectIds(input: {
  db: D1Database;
  organizationId: string;
  projectIds: string[];
}): Promise<string[]> {
  if (input.projectIds.length === 0) {
    return [];
  }
  const placeholders = input.projectIds.map(() => "?").join(", ");
  const rows = await input.db
    .prepare(
      `SELECT id FROM projects WHERE organization_id = ?
         AND archived_at_ms IS NULL AND id IN (${placeholders})`
    )
    .bind(input.organizationId, ...input.projectIds)
    .all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
}

type IssueRoutingRow = {
  issue_destination_json: string | null;
  issue_destination_revision: number;
  issue_destination_updated_at_ms: number | null;
  issue_destination_updated_by_user_id: string | null;
};

type RepositorySettingsRow = {
  additional_repository_urls_json: string;
  repository_fingerprint: string | null;
  repository_url: string | null;
  repository_settings_revision: number;
  repository_settings_updated_at_ms: number | null;
  repository_settings_updated_by_user_id: string | null;
};

export async function readProjectRepositorySettingsRecord(input: {
  db: D1Database;
  organizationId: string;
  projectId: string;
}): Promise<ProjectRepositorySettings | null> {
  const row = await input.db
    .prepare(
      `SELECT repository_url, repository_fingerprint,
              additional_repository_urls_json, repository_settings_revision,
              repository_settings_updated_at_ms,
              repository_settings_updated_by_user_id
       FROM projects WHERE id = ? AND organization_id = ?
         AND archived_at_ms IS NULL LIMIT 1`
    )
    .bind(input.projectId, input.organizationId)
    .first<RepositorySettingsRow>();
  if (!row) {
    return null;
  }
  const additional = parseStringArray(
    row.additional_repository_urls_json,
    "Stored Project repositories are invalid."
  );
  const urls = [row.repository_url, ...additional].filter(
    (value): value is string => value !== null
  );
  const repositories = await Promise.all(
    urls.map(async (repositoryUrl) => {
      const repositoryFingerprint =
        await buildRepositoryFingerprint(repositoryUrl);
      if (!repositoryFingerprint) {
        throw new Error("Stored Project repository identity is invalid.");
      }
      return {
        repositoryUrl,
        repositoryFingerprint,
        isDefault: repositoryUrl === row.repository_url,
      };
    })
  );
  return {
    projectId: input.projectId,
    repositories,
    legacyDefaultFingerprint:
      row.repository_url === null ? row.repository_fingerprint : null,
    revision: row.repository_settings_revision,
    updatedAtMs: row.repository_settings_updated_at_ms,
    updatedByUserId: row.repository_settings_updated_by_user_id,
  };
}

export async function updateProjectRepositorySettingsRecord(input: {
  additionalRepositoryUrls: string[];
  db: D1Database;
  defaultRepositoryFingerprint: string | null;
  defaultRepositoryUrl: string | null;
  expectedRevision: number;
  nowMs: number;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `UPDATE projects SET
         repository_url = ?, repository_fingerprint = ?,
         additional_repository_urls_json = ?,
         repository_settings_revision = repository_settings_revision + 1,
         repository_settings_updated_at_ms = MAX(COALESCE(repository_settings_updated_at_ms, 0) + 1, ?),
         repository_settings_updated_by_user_id = ?,
         updated_at_ms = MAX(updated_at_ms + 1, ?)
       WHERE id = ? AND organization_id = ? AND archived_at_ms IS NULL
         AND repository_settings_revision = ?`
    )
    .bind(
      input.defaultRepositoryUrl,
      input.defaultRepositoryFingerprint,
      JSON.stringify(input.additionalRepositoryUrls),
      input.nowMs,
      input.userId,
      input.nowMs,
      input.projectId,
      input.organizationId,
      input.expectedRevision
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

type CommonAgentsRow = {
  common_agent_profile_ids_json: string;
  common_agents_revision: number;
  common_agents_updated_at_ms: number | null;
  common_agents_updated_by_user_id: string | null;
};

export async function readProjectCommonAgentsRecord(input: {
  db: D1Database;
  organizationId: string;
  projectId: string;
}): Promise<ProjectCommonAgents | null> {
  const row = await input.db
    .prepare(
      `SELECT common_agent_profile_ids_json, common_agents_revision,
              common_agents_updated_at_ms, common_agents_updated_by_user_id
       FROM projects WHERE id = ? AND organization_id = ?
         AND archived_at_ms IS NULL LIMIT 1`
    )
    .bind(input.projectId, input.organizationId)
    .first<CommonAgentsRow>();
  if (!row) {
    return null;
  }
  const agentProfileIds = parseStringArray(
    row.common_agent_profile_ids_json,
    "Stored Project Common Agents are invalid."
  );
  return projectCommonAgentsSchema.parse({
    projectId: input.projectId,
    agentProfileIds,
    revision: row.common_agents_revision,
    updatedAtMs: row.common_agents_updated_at_ms,
    updatedByUserId: row.common_agents_updated_by_user_id,
  });
}

export async function readActiveAgentProfileIds(input: {
  db: D1Database;
  organizationId: string;
  profileIds: string[];
}): Promise<string[]> {
  if (input.profileIds.length === 0) {
    return [];
  }
  const placeholders = input.profileIds.map(() => "?").join(", ");
  const result = await input.db
    .prepare(
      `SELECT profile_id FROM openmeld_profiles
       WHERE organization_id = ? AND profile_kind = 'agent'
         AND status = 'active' AND profile_id IN (${placeholders})`
    )
    .bind(input.organizationId, ...input.profileIds)
    .all<{ profile_id: string }>();
  return (result.results ?? []).map((row) => row.profile_id);
}

export async function updateProjectCommonAgentsRecord(input: {
  agentProfileIds: string[];
  db: D1Database;
  expectedRevision: number;
  nowMs: number;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `UPDATE projects SET
         common_agent_profile_ids_json = ?,
         common_agents_revision = common_agents_revision + 1,
         common_agents_updated_at_ms = MAX(COALESCE(common_agents_updated_at_ms, 0) + 1, ?),
         common_agents_updated_by_user_id = ?,
         updated_at_ms = MAX(updated_at_ms + 1, ?)
       WHERE id = ? AND organization_id = ? AND archived_at_ms IS NULL
         AND common_agents_revision = ?`
    )
    .bind(
      JSON.stringify(input.agentProfileIds),
      input.nowMs,
      input.userId,
      input.nowMs,
      input.projectId,
      input.organizationId,
      input.expectedRevision
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

function parseStringArray(value: string, message: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(message);
  }
  if (
    !(Array.isArray(parsed) && parsed.every((item) => typeof item === "string"))
  ) {
    throw new Error(message);
  }
  return parsed;
}

export type ProjectIssueRoutingCandidate = {
  id: string;
  name: string;
  slug: string;
  repositoryUrl: string | null;
  repositoryUrls?: string[];
  routing: ProjectIssueRouting;
};

export async function listProjectIssueRoutingCandidates(input: {
  db: D1Database;
  organizationId: string;
}): Promise<ProjectIssueRoutingCandidate[]> {
  const rows = await input.db
    .prepare(
      `SELECT id, name, slug, repository_url, additional_repository_urls_json,
              issue_destination_json, issue_destination_revision,
              issue_destination_updated_at_ms,
              issue_destination_updated_by_user_id
       FROM projects WHERE organization_id = ? AND archived_at_ms IS NULL
       ORDER BY id LIMIT ?`
    )
    .bind(input.organizationId, ACTIVE_PROJECT_LIMIT)
    .all<
      IssueRoutingRow & {
        id: string;
        name: string;
        slug: string;
        repository_url: string | null;
        additional_repository_urls_json: string;
      }
    >();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    repositoryUrl: row.repository_url,
    repositoryUrls: [
      ...(row.repository_url ? [row.repository_url] : []),
      ...parseStringArray(
        row.additional_repository_urls_json,
        "Stored Project repositories are invalid."
      ),
    ],
    routing: mapIssueRoutingRow(row.id, row),
  }));
}

export async function readProjectIssueRoutingRecord(input: {
  db: D1Database;
  organizationId: string;
  projectId: string;
}): Promise<ProjectIssueRouting | null> {
  const row = await input.db
    .prepare(
      `SELECT issue_destination_json, issue_destination_revision,
              issue_destination_updated_at_ms,
              issue_destination_updated_by_user_id
       FROM projects WHERE id = ? AND organization_id = ?
         AND archived_at_ms IS NULL LIMIT 1`
    )
    .bind(input.projectId, input.organizationId)
    .first<IssueRoutingRow>();
  if (!row) {
    return null;
  }
  return mapIssueRoutingRow(input.projectId, row);
}

function mapIssueRoutingRow(
  projectId: string,
  row: IssueRoutingRow
): ProjectIssueRouting {
  let rawDestination: unknown = null;
  try {
    rawDestination = row.issue_destination_json
      ? JSON.parse(row.issue_destination_json)
      : null;
  } catch {
    throw new Error("Stored Project issue destination is invalid.");
  }
  const destination = projectIssueDestinationSchema
    .nullable()
    .safeParse(rawDestination);
  if (!destination.success) {
    throw new Error("Stored Project issue destination is invalid.");
  }
  return {
    projectId,
    destination: destination.data,
    revision: row.issue_destination_revision,
    updatedAtMs: row.issue_destination_updated_at_ms,
    updatedByUserId: row.issue_destination_updated_by_user_id,
  };
}

export async function updateProjectIssueRoutingRecord(input: {
  db: D1Database;
  destination: ProjectIssueDestination | null;
  expectedRevision: number;
  nowMs: number;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `UPDATE projects
       SET issue_destination_json = ?,
           issue_destination_revision = issue_destination_revision + 1,
           issue_destination_updated_at_ms = MAX(COALESCE(issue_destination_updated_at_ms, 0) + 1, ?),
           issue_destination_updated_by_user_id = ?,
           updated_at_ms = MAX(updated_at_ms + 1, ?)
       WHERE id = ? AND organization_id = ?
         AND archived_at_ms IS NULL AND issue_destination_revision = ?`
    )
    .bind(
      input.destination === null ? null : JSON.stringify(input.destination),
      input.nowMs,
      input.userId,
      input.nowMs,
      input.projectId,
      input.organizationId,
      input.expectedRevision
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
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
          creation_request_signature,
          created_by_user_id,
          created_at_ms,
          updated_at_ms,
          archived_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      input.project.creationRequestSignature ?? null,
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
  additionalRepositoryUrls?: string[];
  currentUpdatedAtMs: number;
  db: D1Database;
  project: StoredProject;
  userId: string;
}): Promise<"not_updated" | "updated"> {
  const repositorySettingsUpdate = input.additionalRepositoryUrls
    ? `,
          additional_repository_urls_json = ?,
          repository_settings_revision = repository_settings_revision + 1,
          repository_settings_updated_by_user_id = ?,
          repository_settings_updated_at_ms = MAX(COALESCE(repository_settings_updated_at_ms, 0) + 1, ?)`
    : "";
  const result = await input.db
    .prepare(
      `
        UPDATE projects
        SET
          name = ?,
          slug = ?,
          repository_fingerprint = ?,
          repository_url = ?,
          updated_at_ms = ?${repositorySettingsUpdate}
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
      ...(input.additionalRepositoryUrls
        ? [
            JSON.stringify(input.additionalRepositoryUrls),
            input.userId,
            input.project.updatedAtMs,
          ]
        : []),
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
    creationRequestSignature: row.creation_request_signature,
    slug: row.slug,
    updatedAtMs: Number(row.updated_at_ms),
  };
}
