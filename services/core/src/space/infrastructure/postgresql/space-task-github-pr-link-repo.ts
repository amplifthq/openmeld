import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
import type { SpaceTask } from "@openmeld/schemas/types";

export type SpaceTaskGitHubPullRequestLinkRecord = {
  detachedAtMs: number | null;
  number: number;
  organizationId: string;
  ownerLogin: string;
  repo: string;
  spaceId: string;
  taskId: string;
  url: string;
};

export async function projectSpaceTaskGitHubPullRequestLink(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  spaceId: string;
  task: SpaceTask;
}): Promise<void> {
  const pr = input.task.pullRequest ?? null;
  const statements: QueryConfig[] = [
    {
      text: `UPDATE "openmeld"."space_task_github_pr_links"
         SET detached_at_ms = $1, updated_at_ms = $2
         WHERE space_id = $3 AND task_id = $4 AND detached_at_ms IS NULL`,
      values: [
        pr ? null : input.nowMs,
        input.nowMs,
        input.spaceId,
        input.task.taskId,
      ],
    },
  ];
  if (pr) {
    statements.push({
      text: `
            INSERT INTO "openmeld"."space_task_github_pr_links" (
              space_id,
              task_id,
              owner_login,
              repo,
              number,
              url,
              organization_id,
              attached_at_ms,
              detached_at_ms,
              updated_at_ms
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9)
            ON CONFLICT(space_id, task_id, owner_login, repo, number) DO UPDATE SET
              url = excluded.url,
              organization_id = excluded.organization_id,
              detached_at_ms = NULL,
              updated_at_ms = excluded.updated_at_ms
          `,
      values: [
        input.spaceId,
        input.task.taskId,
        pr.owner.toLowerCase(),
        pr.repo.toLowerCase(),
        pr.number,
        pr.url,
        input.organizationId,
        input.nowMs,
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

export async function listActiveSpaceTaskGitHubPullRequestLinks(input: {
  db: PostgresDatabase;
  number: number;
  owner: string;
  repo: string;
}): Promise<SpaceTaskGitHubPullRequestLinkRecord[]> {
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
        FROM "openmeld"."space_task_github_pr_links"
        WHERE owner_login = $1
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
