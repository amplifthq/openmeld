import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
import type { SpaceTask } from "@openmeld/schemas/types";

export type SpaceTaskProjectCandidate = {
  spaceId: string;
  taskId: string;
};

// This projection contains only candidate keys. The Space Task read remains
// authoritative for both access and current content.
export async function projectSpaceTaskProjectLinks(input: {
  db: PostgresDatabase;
  organizationId: string;
  task: SpaceTask;
}): Promise<void> {
  const { task } = input;
  const updatedAtMs = Date.parse(task.updatedAt);
  const statements: QueryConfig[] = [
    {
      text: `INSERT INTO "openmeld"."space_task_project_projection_states"
          (space_id, task_id, organization_id, task_revision, updated_at_ms)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(space_id, task_id) DO UPDATE SET
           organization_id = excluded.organization_id,
           task_revision = excluded.task_revision,
           updated_at_ms = excluded.updated_at_ms
         WHERE excluded.task_revision >= space_task_project_projection_states.task_revision`,
      values: [
        task.spaceId,
        task.taskId,
        input.organizationId,
        task.revision,
        updatedAtMs,
      ],
    },
    {
      text: `DELETE FROM "openmeld"."space_task_project_links"
         WHERE space_id = $1 AND task_id = $2
           AND EXISTS (
             SELECT 1 FROM "openmeld"."space_task_project_projection_states"
             WHERE space_id = $3 AND task_id = $4
               AND organization_id = $5 AND task_revision = $6
           )`,
      values: [
        task.spaceId,
        task.taskId,
        task.spaceId,
        task.taskId,
        input.organizationId,
        task.revision,
      ],
    },
  ];
  for (const projectId of task.projectIds) {
    statements.push({
      text: `INSERT INTO "openmeld"."space_task_project_links"
            (space_id, task_id, project_id, organization_id, task_revision, updated_at_ms)
           SELECT $1, $2, $3, $4, $5, $6
           WHERE EXISTS (
             SELECT 1 FROM "openmeld"."space_task_project_projection_states"
             WHERE space_id = $7 AND task_id = $8
               AND organization_id = $9 AND task_revision = $10
           )`,
      values: [
        task.spaceId,
        task.taskId,
        projectId,
        input.organizationId,
        task.revision,
        updatedAtMs,
        task.spaceId,
        task.taskId,
        input.organizationId,
        task.revision,
      ],
    });
  }
  await input.db.transaction(async (client) => {
    for (const statement of statements) {
      await client.query(statement);
    }
  });
}

export async function listSpaceTaskProjectCandidates(input: {
  db: PostgresDatabase;
  organizationId: string;
  projectId: string;
  limit: number;
}): Promise<SpaceTaskProjectCandidate[]> {
  const rows = await input.db.query<{ space_id: string; task_id: string }>({
    text: `SELECT space_id, task_id FROM "openmeld"."space_task_project_links"
       WHERE organization_id = $1 AND project_id = $2
       ORDER BY updated_at_ms DESC, space_id, task_id LIMIT $3`,
    values: [input.organizationId, input.projectId, input.limit],
  });
  return (rows.rows ?? []).map((row) => ({
    spaceId: row.space_id,
    taskId: row.task_id,
  }));
}
