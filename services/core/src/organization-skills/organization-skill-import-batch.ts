import {
  organizationSkillGitHubRepositoryPreviewSchema,
  organizationSkillImportBatchResultSchema,
  organizationSkillImportBatchSchema,
} from "@openmeld/schemas";
import type {
  OrganizationSkillGitHubRepositoryPreview,
  OrganizationSkillImportBatch,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";

type BatchRow = {
  batch_id: string;
  commit_sha: string;
  created_at: number;
  organization_id: string;
  owner_user_id: string;
  preview_json: string;
  repository: string;
  results_json: string;
  source_url: string;
};

export async function readOrganizationSkillImportBatch(input: {
  batchId: string;
  db: D1Database;
  organizationId: string;
  userId: string;
}): Promise<OrganizationSkillImportBatch | null> {
  const row = await input.db
    .prepare(
      `SELECT * FROM organization_skill_import_batches
       WHERE organization_id = ? AND batch_id = ? AND owner_user_id = ? LIMIT 1`
    )
    .bind(input.organizationId, input.batchId, input.userId)
    .first<BatchRow>();
  return row ? parseBatch(row) : null;
}

export async function beginOrganizationSkillImportBatch(input: {
  batchId: string;
  db: D1Database;
  organizationId: string;
  preview: OrganizationSkillGitHubRepositoryPreview;
  selectedPaths?: string[];
  sourceUrl: string;
  userId: string;
}): Promise<OrganizationSkillImportBatch> {
  const existing = await readOrganizationSkillImportBatch(input);
  if (existing) {
    if (
      existing.sourceUrl !== input.sourceUrl ||
      JSON.stringify(existing.preview.skills) !==
        JSON.stringify(input.preview.skills) ||
      !selectionMatches(existing, input.selectedPaths)
    ) {
      throw batchConflict();
    }
    return existing;
  }
  const selectedPaths = new Set(
    input.selectedPaths ?? input.preview.skills.map((item) => item.path)
  );
  if (
    selectedPaths.size !==
      (input.selectedPaths?.length ?? selectedPaths.size) ||
    [...selectedPaths].some(
      (path) => !input.preview.skills.some((item) => item.path === path)
    )
  ) {
    throw batchConflict();
  }
  const existingPaths = new Set(
    (
      await input.db
        .prepare(
          `SELECT source_path FROM organization_skills
       WHERE organization_id = ? AND source_kind = 'github'
         AND source_repository = ? AND removed_at IS NULL`
        )
        .bind(input.organizationId, input.preview.repository)
        .all<{ source_path: string }>()
    ).results.map((row) => row.source_path)
  );
  const results = input.preview.skills.map((item) => {
    const selected = selectedPaths.has(item.path);
    const error =
      (selected ? item.blocker?.message : "Not selected") ??
      (existingPaths.has(item.path) ? "Already in Team" : undefined);
    return organizationSkillImportBatchResultSchema.parse({
      path: item.path,
      ...(error === undefined ? {} : { error }),
      selected,
      status: error === undefined ? "pending" : "skipped",
    });
  });
  await input.db
    .prepare(
      `INSERT OR IGNORE INTO organization_skill_import_batches
     (batch_id, commit_sha, organization_id, owner_user_id, preview_json,
      repository, results_json, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.batchId,
      input.preview.commitSha,
      input.organizationId,
      input.userId,
      JSON.stringify(input.preview),
      input.preview.repository,
      JSON.stringify(results),
      input.sourceUrl
    )
    .run();
  const batch = await readOrganizationSkillImportBatch(input);
  if (
    !batch ||
    batch.sourceUrl !== input.sourceUrl ||
    JSON.stringify(batch.preview.skills) !==
      JSON.stringify(input.preview.skills) ||
    !selectionMatches(batch, input.selectedPaths)
  ) {
    throw batchConflict();
  }
  return batch;
}

export function requireBatchCandidate(input: {
  batch: OrganizationSkillImportBatch;
  expectedCommitSha: string;
  url: string;
}): number {
  if (input.batch.preview.commitSha !== input.expectedCommitSha) {
    throw batchConflict();
  }
  const index = input.batch.preview.skills.findIndex(
    (item) => item.url === input.url
  );
  if (
    index < 0 ||
    !input.batch.results[index]?.selected ||
    input.batch.results[index]?.status === "skipped"
  ) {
    throw batchConflict();
  }
  return index;
}

export function selectionMatches(
  batch: OrganizationSkillImportBatch,
  selectedPaths?: string[]
): boolean {
  if (selectedPaths === undefined) {
    return true;
  }
  const selected = new Set(selectedPaths);
  return (
    selected.size === selectedPaths.length &&
    batch.results.every(
      (result) => result.selected === selected.has(result.path)
    )
  );
}

export async function recordOrganizationSkillImportBatchResult(input: {
  batchId: string;
  db: D1Database;
  index: number;
  organizationId: string;
  result: OrganizationSkillImportBatch["results"][number];
  userId: string;
}): Promise<void> {
  const result = organizationSkillImportBatchResultSchema.parse(input.result);
  const path = `$[${input.index}]`;
  await input.db
    .prepare(
      `UPDATE organization_skill_import_batches
     SET results_json = json_set(results_json, ?, json(?))
     WHERE organization_id = ? AND batch_id = ? AND owner_user_id = ?
       AND json_extract(results_json, ? || '.path') = ?
       AND json_extract(results_json, ? || '.status') != 'installed'`
    )
    .bind(
      path,
      JSON.stringify(result),
      input.organizationId,
      input.batchId,
      input.userId,
      path,
      result.path,
      path
    )
    .run();
}

function parseBatch(row: BatchRow): OrganizationSkillImportBatch {
  return organizationSkillImportBatchSchema.parse({
    batchId: row.batch_id,
    createdAt: new Date(row.created_at).toISOString(),
    organizationId: row.organization_id,
    preview: organizationSkillGitHubRepositoryPreviewSchema.parse(
      JSON.parse(row.preview_json)
    ),
    results: JSON.parse(row.results_json),
    sourceUrl: row.source_url,
  });
}

function batchConflict(): Error {
  return createCoreRpcHttpError({
    code: "organization_skill.batch_conflict",
    reason: "This batch ID belongs to a different Skill install plan.",
    status: 409,
  });
}
