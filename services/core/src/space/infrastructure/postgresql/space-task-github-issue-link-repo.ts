import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
import type { SpaceTask } from "@openmeld/schemas/types";
export type SpaceTaskGitHubIssueLinkRecord = {
  detachedAtMs: number | null;
  number: number;
  organizationId: string;
  ownerLogin: string;
  repo: string;
  spaceId: string;
  taskId: string;
  url: string;
};
export async function projectSpaceTaskGitHubIssueLinks(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  spaceId: string;
  task: SpaceTask;
}): Promise<void> {
  const nextGithub = input.task.externalWorkItems.filter(
    (item) => item.provider === "github"
  );
  // Reconcile the current Task snapshot in one batch so recovery also removes
  // links whose detach mutation never reached this projection.
  const statements: QueryConfig[] = [
    {
      text: `UPDATE "openmeld"."space_task_github_issue_links"
         SET detached_at_ms = $1, updated_at_ms = $2
         WHERE space_id = $3 AND task_id = $4
           AND provider = 'github' AND detached_at_ms IS NULL`,
      values: [input.nowMs, input.nowMs, input.spaceId, input.task.taskId],
    },
  ];
  for (const item of nextGithub) {
    statements.push({
      text: `
            INSERT INTO "openmeld"."space_task_github_issue_links" (
              space_id,
              task_id,
              provider,
              owner_login,
              repo,
              number,
              url,
              organization_id,
              attached_at_ms,
              detached_at_ms,
              last_observed_state,
              last_observed_at_ms,
              updated_at_ms
            )
            VALUES ($1, $2, 'github', $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11)
            ON CONFLICT(space_id, task_id, provider, owner_login, repo, number) DO UPDATE SET
              url = excluded.url,
              organization_id = excluded.organization_id,
              detached_at_ms = NULL,
              last_observed_state = excluded.last_observed_state,
              last_observed_at_ms = excluded.last_observed_at_ms,
              updated_at_ms = excluded.updated_at_ms
          `,
      values: [
        input.spaceId,
        input.task.taskId,
        item.owner.toLowerCase(),
        item.repo.toLowerCase(),
        item.number,
        item.url,
        input.organizationId,
        input.nowMs,
        item.lastObservedState,
        item.lastObservedAt ? Date.parse(item.lastObservedAt) : null,
        input.nowMs,
      ],
    });
  }
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
}
export async function listActiveSpaceTaskGitHubIssueLinks(input: {
  db: PostgresDatabase;
  number: number;
  owner: string;
  repo: string;
}): Promise<SpaceTaskGitHubIssueLinkRecord[]> {
  const rows = await input.db.query<{
    detached_at_ms: number | null;
    number: number;
    organization_id: string;
    owner_login: string;
    repo: string;
    space_id: string;
    task_id: string;
    url: string;
  }>({
    text: `
        SELECT space_id, task_id, owner_login, repo, number, url, organization_id, detached_at_ms
        FROM "openmeld"."space_task_github_issue_links"
        WHERE provider = 'github'
          AND owner_login = $1
          AND repo = $2
          AND number = $3
          AND detached_at_ms IS NULL
      `,
    values: [input.owner.toLowerCase(), input.repo.toLowerCase(), input.number],
  });
  return (rows.rows ?? []).map((row) => ({
    detachedAtMs: row.detached_at_ms,
    number: row.number,
    organizationId: row.organization_id,
    ownerLogin: row.owner_login,
    repo: row.repo,
    spaceId: row.space_id,
    taskId: row.task_id,
    url: row.url,
  }));
}
