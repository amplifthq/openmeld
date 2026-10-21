import {
  isPostgresUniqueViolation,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
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
// Each Activity evidence probe is shaped as a bounded index seek. It asks for
// the first row at or after (organization_id, project_id) in that order, then
// checks that the row belongs to this Project. An index leading with
// (organization_id, project_id) answers that from its first entry, while other
// plans must read and sort every candidate row, so skewed column statistics no
// longer make a scan look cheap. A plain equality probe has no such cost gap:
// when one Project owns most rows, the planner estimates every equality probe
// as a match and picks a sequential scan or a backward scan of an unrelated
// time index, which reads the entire table for a Project with no Activity.
function projectActivityEvidenceProbe(table: string): string {
  return `EXISTS (
    SELECT 1 FROM (
      SELECT evidence.organization_id, evidence.project_id
      FROM "openmeld"."${table}" evidence
      WHERE (evidence.organization_id, evidence.project_id)
        >= (projects.organization_id, projects.id)
      ORDER BY evidence.organization_id, evidence.project_id
      LIMIT 1
    ) next_evidence
    WHERE next_evidence.organization_id = projects.organization_id
      AND next_evidence.project_id = projects.id
  )`;
}
const PROJECT_ACTIVITY_EVIDENCE = [
  "agent_activity_events",
  "agent_activity_sessions",
  "agent_activity_digests",
  "agent_activity_daily_aggregates",
  "agent_activity_daily_session_keys",
]
  .map(projectActivityEvidenceProbe)
  .join("\n  OR ");
// OFFSET 0 keeps the lateral subquery from being flattened, so the evidence
// chain runs once per Project even when a query also filters on it.
const PROJECT_SELECT = `
  SELECT
    projects.id,
    projects.organization_id,
    projects.name,
    projects.slug,
    projects.repository_fingerprint,
    projects.repository_url,
    projects.creation_request_signature,
    projects.created_by_user_id,
    projects.created_at_ms,
    projects.updated_at_ms,
    projects.archived_at_ms,
    CASE WHEN activity.has_activity THEN 1 ELSE 0 END AS has_activity
  FROM "openmeld"."projects" projects
  CROSS JOIN LATERAL (
    SELECT (${PROJECT_ACTIVITY_EVIDENCE}) AS has_activity
    OFFSET 0
  ) activity
`;
export async function listProjectRecords(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<StoredProject[]> {
  const result = await input.db.query<ProjectRow>({
    text: `
        ${PROJECT_SELECT}
        WHERE projects.organization_id = $1
          AND projects.archived_at_ms IS NULL
        ORDER BY projects.updated_at_ms DESC NULLS LAST, projects.id DESC NULLS LAST
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
        WHERE projects.organization_id = $1
          AND (projects.archived_at_ms IS NULL OR activity.has_activity)
        ORDER BY
          CASE WHEN projects.archived_at_ms IS NULL THEN 0 ELSE 1 END ASC NULLS FIRST,
          projects.updated_at_ms DESC NULLS LAST,
          projects.id DESC NULLS LAST
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
        WHERE projects.id = $1 AND projects.organization_id = $2
        LIMIT 1
      `,
      values: [input.projectId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapProjectRow(row) : null;
}
export type ProjectLifecycleRecord = Pick<StoredProject, "archivedAtMs" | "id">;
/**
 * Reads only whether a Project exists and whether it is archived. Use it on
 * paths that never present the Project, such as Agent Activity ingest, so they
 * do not pay for the Activity evidence chain.
 */
export async function readProjectLifecycleRecord(input: {
  db: PostgresDatabase;
  organizationId: string;
  projectId: string;
}): Promise<ProjectLifecycleRecord | null> {
  const row = await input.db
    .query<Pick<ProjectRow, "archived_at_ms" | "id">>({
      text: `
        SELECT id, archived_at_ms
        FROM "openmeld"."projects"
        WHERE id = $1 AND organization_id = $2
        LIMIT 1
      `,
      values: [input.projectId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return row
    ? {
        archivedAtMs:
          row.archived_at_ms === null ? null : Number(row.archived_at_ms),
        id: row.id,
      }
    : null;
}

export async function readActiveProjectIds(input: {
  db: PostgresDatabase;
  organizationId: string;
  projectIds: string[];
}): Promise<string[]> {
  if (input.projectIds.length === 0) {
    return [];
  }
  const placeholders = input.projectIds
    .map((_, index) => `$${index + 2}`)
    .join(", ");
  const rows = await input.db.query<{ id: string }>({
    text: `SELECT id FROM "openmeld"."projects" WHERE organization_id = $1
         AND archived_at_ms IS NULL AND id IN (${placeholders})`,
    values: [input.organizationId, ...input.projectIds],
  });
  return (rows.rows ?? []).map((row) => row.id);
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
  db: PostgresDatabase;
  organizationId: string;
  projectId: string;
}): Promise<ProjectRepositorySettings | null> {
  const row = await input.db
    .query<RepositorySettingsRow>({
      text: `SELECT repository_url, repository_fingerprint,
              additional_repository_urls_json, repository_settings_revision,
              repository_settings_updated_at_ms,
              repository_settings_updated_by_user_id
       FROM "openmeld"."projects" WHERE id = $1 AND organization_id = $2
         AND archived_at_ms IS NULL LIMIT 1`,
      values: [input.projectId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
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
  db: PostgresDatabase;
  defaultRepositoryFingerprint: string | null;
  defaultRepositoryUrl: string | null;
  expectedRevision: number;
  nowMs: number;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `UPDATE "openmeld"."projects" SET
         repository_url = $1, repository_fingerprint = $2,
         additional_repository_urls_json = $3,
         repository_settings_revision = repository_settings_revision + 1,
         repository_settings_updated_at_ms = GREATEST(COALESCE(repository_settings_updated_at_ms, 0) + 1, $4),
         repository_settings_updated_by_user_id = $5,
         updated_at_ms = GREATEST(updated_at_ms + 1, $6)
       WHERE id = $7 AND organization_id = $8 AND archived_at_ms IS NULL
         AND repository_settings_revision = $9`,
    values: [
      input.defaultRepositoryUrl,
      input.defaultRepositoryFingerprint,
      JSON.stringify(input.additionalRepositoryUrls),
      input.nowMs,
      input.userId,
      input.nowMs,
      input.projectId,
      input.organizationId,
      input.expectedRevision,
    ],
  });
  return Number(result.rowCount ?? 0) === 1;
}

type CommonAgentsRow = {
  common_agent_profile_ids_json: string;
  common_agents_revision: number;
  common_agents_updated_at_ms: number | null;
  common_agents_updated_by_user_id: string | null;
};

export async function readProjectCommonAgentsRecord(input: {
  db: PostgresDatabase;
  organizationId: string;
  projectId: string;
}): Promise<ProjectCommonAgents | null> {
  const row = await input.db
    .query<CommonAgentsRow>({
      text: `SELECT common_agent_profile_ids_json, common_agents_revision,
              common_agents_updated_at_ms, common_agents_updated_by_user_id
       FROM "openmeld"."projects" WHERE id = $1 AND organization_id = $2
         AND archived_at_ms IS NULL LIMIT 1`,
      values: [input.projectId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
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
  db: PostgresDatabase;
  organizationId: string;
  profileIds: string[];
}): Promise<string[]> {
  if (input.profileIds.length === 0) {
    return [];
  }
  const placeholders = input.profileIds
    .map((_, index) => `$${index + 2}`)
    .join(", ");
  const result = await input.db.query<{ profile_id: string }>({
    text: `SELECT profile_id FROM "openmeld"."openmeld_profiles"
       WHERE organization_id = $1 AND profile_kind = 'agent'
         AND status = 'active' AND profile_id IN (${placeholders})`,
    values: [input.organizationId, ...input.profileIds],
  });
  return (result.rows ?? []).map((row) => row.profile_id);
}

export async function updateProjectCommonAgentsRecord(input: {
  agentProfileIds: string[];
  db: PostgresDatabase;
  expectedRevision: number;
  nowMs: number;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `UPDATE "openmeld"."projects" SET
         common_agent_profile_ids_json = $1,
         common_agents_revision = common_agents_revision + 1,
         common_agents_updated_at_ms = GREATEST(COALESCE(common_agents_updated_at_ms, 0) + 1, $2),
         common_agents_updated_by_user_id = $3,
         updated_at_ms = GREATEST(updated_at_ms + 1, $4)
       WHERE id = $5 AND organization_id = $6 AND archived_at_ms IS NULL
         AND common_agents_revision = $7`,
    values: [
      JSON.stringify(input.agentProfileIds),
      input.nowMs,
      input.userId,
      input.nowMs,
      input.projectId,
      input.organizationId,
      input.expectedRevision,
    ],
  });
  return Number(result.rowCount ?? 0) === 1;
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
  db: PostgresDatabase;
  organizationId: string;
}): Promise<ProjectIssueRoutingCandidate[]> {
  const rows = await input.db.query<
    IssueRoutingRow & {
      id: string;
      name: string;
      slug: string;
      repository_url: string | null;
      additional_repository_urls_json: string;
    }
  >({
    text: `SELECT id, name, slug, repository_url, additional_repository_urls_json,
              issue_destination_json, issue_destination_revision,
              issue_destination_updated_at_ms,
              issue_destination_updated_by_user_id
       FROM "openmeld"."projects" WHERE organization_id = $1 AND archived_at_ms IS NULL
       ORDER BY id LIMIT $2`,
    values: [input.organizationId, ACTIVE_PROJECT_LIMIT],
  });
  return (rows.rows ?? []).map((row) => ({
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
  db: PostgresDatabase;
  organizationId: string;
  projectId: string;
}): Promise<ProjectIssueRouting | null> {
  const row = await input.db
    .query<IssueRoutingRow>({
      text: `SELECT issue_destination_json, issue_destination_revision,
              issue_destination_updated_at_ms,
              issue_destination_updated_by_user_id
       FROM "openmeld"."projects" WHERE id = $1 AND organization_id = $2
         AND archived_at_ms IS NULL LIMIT 1`,
      values: [input.projectId, input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
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
  db: PostgresDatabase;
  destination: ProjectIssueDestination | null;
  expectedRevision: number;
  nowMs: number;
  organizationId: string;
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `UPDATE "openmeld"."projects"
       SET issue_destination_json = $1,
           issue_destination_revision = issue_destination_revision + 1,
           issue_destination_updated_at_ms = GREATEST(COALESCE(issue_destination_updated_at_ms, 0) + 1, $2),
           issue_destination_updated_by_user_id = $3,
           updated_at_ms = GREATEST(updated_at_ms + 1, $4)
       WHERE id = $5 AND organization_id = $6
         AND archived_at_ms IS NULL AND issue_destination_revision = $7`,
    values: [
      input.destination === null ? null : JSON.stringify(input.destination),
      input.nowMs,
      input.userId,
      input.nowMs,
      input.projectId,
      input.organizationId,
      input.expectedRevision,
    ],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function insertProjectRecord(input: {
  db: PostgresDatabase;
  project: StoredProject;
}): Promise<"inserted" | "limit_reached"> {
  const result = await input.db.transaction(async (client) => {
    // Serialize the Organization's active Project limit before inserting.
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
      ],
    });
  });
  return result.rowCount === 1 ? "inserted" : "limit_reached";
}
export async function updateProjectRecord(input: {
  additionalRepositoryUrls?: string[];
  currentUpdatedAtMs: number;
  db: PostgresDatabase;
  project: StoredProject;
  userId: string;
}): Promise<"not_updated" | "updated"> {
  const repositorySettingsUpdate = input.additionalRepositoryUrls
    ? `,
          additional_repository_urls_json = $9,
          repository_settings_revision = repository_settings_revision + 1,
          repository_settings_updated_by_user_id = $10,
          repository_settings_updated_at_ms = GREATEST(COALESCE(repository_settings_updated_at_ms, 0) + 1, $11)`
    : "";
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."projects"
        SET
          name = $1,
          slug = $2,
          repository_fingerprint = $3,
          repository_url = $4,
          updated_at_ms = $5${repositorySettingsUpdate}
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
      ...(input.additionalRepositoryUrls
        ? [
            JSON.stringify(input.additionalRepositoryUrls),
            input.userId,
            input.project.updatedAtMs,
          ]
        : []),
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
