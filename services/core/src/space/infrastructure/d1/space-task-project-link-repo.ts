import type { SpaceTask } from "@openmeld/schemas/types";

export type SpaceTaskProjectCandidate = {
  spaceId: string;
  taskId: string;
};

// This projection contains only candidate keys. The Space Task read remains
// authoritative for both access and current content.
export async function projectSpaceTaskProjectLinks(input: {
  db: D1Database;
  organizationId: string;
  task: SpaceTask;
}): Promise<void> {
  const { task } = input;
  const updatedAtMs = Date.parse(task.updatedAt);
  const statements: D1PreparedStatement[] = [
    input.db
      .prepare(
        `INSERT INTO space_task_project_projection_states
          (space_id, task_id, organization_id, task_revision, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(space_id, task_id) DO UPDATE SET
           organization_id = excluded.organization_id,
           task_revision = excluded.task_revision,
           updated_at_ms = excluded.updated_at_ms
         WHERE excluded.task_revision >= space_task_project_projection_states.task_revision`
      )
      .bind(
        task.spaceId,
        task.taskId,
        input.organizationId,
        task.revision,
        updatedAtMs
      ),
    input.db
      .prepare(
        `DELETE FROM space_task_project_links
         WHERE space_id = ? AND task_id = ?
           AND EXISTS (
             SELECT 1 FROM space_task_project_projection_states
             WHERE space_id = ? AND task_id = ?
               AND organization_id = ? AND task_revision = ?
           )`
      )
      .bind(
        task.spaceId,
        task.taskId,
        task.spaceId,
        task.taskId,
        input.organizationId,
        task.revision
      ),
  ];
  for (const projectId of task.projectIds) {
    statements.push(
      input.db
        .prepare(
          `INSERT INTO space_task_project_links
            (space_id, task_id, project_id, organization_id, task_revision, updated_at_ms)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM space_task_project_projection_states
             WHERE space_id = ? AND task_id = ?
               AND organization_id = ? AND task_revision = ?
           )`
        )
        .bind(
          task.spaceId,
          task.taskId,
          projectId,
          input.organizationId,
          task.revision,
          updatedAtMs,
          task.spaceId,
          task.taskId,
          input.organizationId,
          task.revision
        )
    );
  }
  await input.db.batch(statements);
}

export async function listSpaceTaskProjectCandidates(input: {
  db: D1Database;
  organizationId: string;
  projectId: string;
  limit: number;
}): Promise<SpaceTaskProjectCandidate[]> {
  const rows = await input.db
    .prepare(
      `SELECT space_id, task_id FROM space_task_project_links
       WHERE organization_id = ? AND project_id = ?
       ORDER BY updated_at_ms DESC, space_id, task_id LIMIT ?`
    )
    .bind(input.organizationId, input.projectId, input.limit)
    .all<{ space_id: string; task_id: string }>();
  return (rows.results ?? []).map((row) => ({
    spaceId: row.space_id,
    taskId: row.task_id,
  }));
}
