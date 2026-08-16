import {
  buildCenterAgentProfileReportComputerPath,
  centerAgentMemberResearchBatchSchema,
} from "@openmeld/schemas";
import type { CenterAgentMemberResearchBatch } from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";

export type ResearchBatchRow = {
  created_at_ms: number;
  direct_message_space_id: string;
  id: string;
  organization_id: string;
  requested_by_display_name: string;
  requested_by_member_id: string;
  requested_by_profile_id: string;
  requested_by_user_id: string;
  scope: "all" | "member";
  status: "completed" | "queued" | "running";
  updated_at_ms: number;
};

export type ResearchTaskRow = {
  batch_id: string;
  created_at_ms: number;
  failure_code: string | null;
  finished_at_ms: number | null;
  id: string;
  position: number;
  started_at_ms: number | null;
  status: "completed" | "failed" | "queued" | "running";
  subject_display_name: string;
  subject_user_id: string;
};

export type ResearchSubject = {
  displayName: string;
  userId: string;
};

export type ResearchRequester = {
  displayName: string;
  memberId: string;
  profileId: string;
  userId: string;
};

export async function readResearchRequester(input: {
  db: D1Database;
  organizationId: string;
  profileId: string;
  userId: string;
}): Promise<ResearchRequester | null> {
  const row = await input.db
    .prepare(
      `
        SELECT m.id AS member_id, p.profile_id, p.profile_name
        FROM members m
        INNER JOIN openmeld_profiles p
          ON p.owner_user_id = m.user_id
          AND p.profile_kind = 'human'
          AND p.status = 'active'
        WHERE m.organization_id = ?
          AND m.user_id = ?
          AND p.profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.userId, input.profileId)
    .first<{
      member_id: string;
      profile_id: string;
      profile_name: string;
    }>();
  return row
    ? {
        displayName: row.profile_name,
        memberId: row.member_id,
        profileId: row.profile_id,
        userId: input.userId,
      }
    : null;
}

export async function readResearchSubjects(input: {
  db: D1Database;
  organizationId: string;
  subjectUserId?: string;
}): Promise<ResearchSubject[]> {
  const whereSubject = input.subjectUserId ? "AND m.user_id = ?" : "";
  const statement = input.db.prepare(
    `
      SELECT
        m.user_id,
        COALESCE(
          NULLIF(trim(p.profile_name), ''),
          NULLIF(trim(u.name), ''),
          NULLIF(trim(u.email), ''),
          m.user_id
        ) AS display_name
      FROM members m
      INNER JOIN users u ON u.id = m.user_id
      LEFT JOIN openmeld_profiles p
        ON p.owner_user_id = m.user_id
        AND p.profile_kind = 'human'
        AND p.is_default = 1
        AND p.status = 'active'
      WHERE m.organization_id = ?
        ${whereSubject}
      ORDER BY lower(display_name) ASC, m.user_id ASC
    `
  );
  const result = await (input.subjectUserId
    ? statement.bind(input.organizationId, input.subjectUserId)
    : statement.bind(input.organizationId)
  ).all<{ display_name: string; user_id: string }>();
  return result.results.map((row) => ({
    displayName: row.display_name,
    userId: row.user_id,
  }));
}

export async function readActiveResearchBatch(input: {
  db: D1Database;
  organizationId: string;
}): Promise<ResearchBatchRow | null> {
  return await input.db
    .prepare(
      `
        SELECT * FROM center_agent_member_research_batches
        WHERE organization_id = ? AND status IN ('queued', 'running')
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<ResearchBatchRow>();
}

export async function readStoredResearchBatch(input: {
  batchId: string;
  db: D1Database;
}): Promise<ResearchBatchRow | null> {
  return await input.db
    .prepare("SELECT * FROM center_agent_member_research_batches WHERE id = ?")
    .bind(input.batchId)
    .first<ResearchBatchRow>();
}

export async function isCenterAgentMemberResearchDelivery(input: {
  db: D1Database;
  dispatchId: string;
  idempotencyKey: string;
  organizationId: string;
  spaceId: string;
  triggerMessageId: string;
}): Promise<boolean> {
  if (
    input.dispatchId !== input.idempotencyKey ||
    input.dispatchId !== input.triggerMessageId
  ) {
    return false;
  }
  const task = await input.db
    .prepare(
      `
        SELECT 1
        FROM center_agent_member_research_tasks task
        INNER JOIN center_agent_member_research_batches batch
          ON batch.id = task.batch_id
        WHERE task.id = ?
          AND task.status = 'running'
          AND batch.organization_id = ?
          AND batch.direct_message_space_id = ?
        LIMIT 1
      `
    )
    .bind(input.dispatchId, input.organizationId, input.spaceId)
    .first<{ 1: number }>();
  return Boolean(task);
}

export async function readResearchBatchById(input: {
  batchId: string;
  db: D1Database;
}): Promise<CenterAgentMemberResearchBatch | null> {
  const batch = await readStoredResearchBatch(input);
  if (!batch) {
    return null;
  }
  const taskResult = await input.db
    .prepare(
      `
        SELECT * FROM center_agent_member_research_tasks
        WHERE batch_id = ?
        ORDER BY position ASC
      `
    )
    .bind(input.batchId)
    .all<ResearchTaskRow>();
  const tasks = taskResult.results;
  return centerAgentMemberResearchBatchSchema.parse({
    completedCount: tasks.filter((task) => task.status === "completed").length,
    createdAt: new Date(batch.created_at_ms).toISOString(),
    failedCount: tasks.filter((task) => task.status === "failed").length,
    id: batch.id,
    organizationId: batch.organization_id,
    scope: batch.scope,
    status: batch.status,
    tasks: tasks.map((task) => ({
      failureCode: task.failure_code,
      finishedAt:
        task.finished_at_ms === null
          ? null
          : new Date(task.finished_at_ms).toISOString(),
      id: task.id,
      position: task.position,
      startedAt:
        task.started_at_ms === null
          ? null
          : new Date(task.started_at_ms).toISOString(),
      status: task.status,
      subjectDisplayName: task.subject_display_name,
      subjectUserId: task.subject_user_id,
    })),
    totalCount: tasks.length,
    updatedAt: new Date(batch.updated_at_ms).toISOString(),
  });
}

export async function requireCenterAgentMemberResearchDraftTarget(input: {
  db: D1Database;
  documentId?: string;
  kind?: string;
  organizationId: string;
  submissionId: string;
  subjectUserId?: string;
  taskId: string;
}): Promise<void> {
  const task = await input.db
    .prepare(
      `
        SELECT task.subject_user_id
        FROM center_agent_member_research_tasks task
        INNER JOIN center_agent_member_research_batches batch
          ON batch.id = task.batch_id
        INNER JOIN openMeldRemoteAgent_native_delivery_ledger delivery
          ON delivery.idempotency_key = task.id
        WHERE task.id = ?
          AND task.status = 'running'
          AND batch.organization_id = ?
          AND delivery.organization_id = batch.organization_id
          AND delivery.submission_id = ?
          AND delivery.status IN ('accepted', 'retry_observed')
        LIMIT 1
      `
    )
    .bind(input.taskId, input.organizationId, input.submissionId)
    .first<{ subject_user_id: string }>();
  if (!task) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.draft_task_mismatch",
      reason: "This member research task cannot accept a draft.",
      status: 409,
    });
  }
  if (
    !input.documentId &&
    input.kind === "member_profile" &&
    input.subjectUserId === task.subject_user_id
  ) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "center_agent_member_research.draft_target_mismatch",
    reason:
      "Member research must create one new dated Profile Report for the assigned member.",
    status: 409,
  });
}

export async function recordCenterAgentMemberResearchComputerFile(input: {
  db: D1Database;
  documentId: string;
  nowMs: number;
  organizationId: string;
  path: string;
  subjectUserId: string;
  submissionId: string;
  taskId: string;
}): Promise<{ documentId: string; path: string; taskId: string }> {
  const document = await input.db
    .prepare(
      `
        SELECT
          documents.subject_user_id,
          documents.title,
          person.name AS profile_report_folder_name
        FROM organization_documents documents
        INNER JOIN organization_document_folders person
          ON person.id = documents.folder_id
         AND person.organization_id = documents.organization_id
        INNER JOIN center_agent_member_research_tasks task
          ON task.id = documents.last_member_research_task_id
        INNER JOIN center_agent_member_research_batches batch
          ON batch.id = task.batch_id
        INNER JOIN openMeldRemoteAgent_native_delivery_ledger delivery
          ON delivery.idempotency_key = task.id
        WHERE documents.id = ?
          AND documents.organization_id = ?
          AND documents.kind = 'member_profile'
          AND documents.subject_user_id = ?
          AND documents.last_member_research_task_id = ?
          AND person.system_kind = 'profile_reports_person'
          AND person.subject_user_id = documents.subject_user_id
          AND task.status = 'running'
          AND batch.organization_id = documents.organization_id
          AND delivery.organization_id = batch.organization_id
          AND delivery.submission_id = ?
          AND delivery.status IN ('accepted', 'retry_observed')
        LIMIT 1
      `
    )
    .bind(
      input.documentId,
      input.organizationId,
      input.subjectUserId,
      input.taskId,
      input.submissionId
    )
    .first<{
      profile_report_folder_name: string;
      subject_user_id: string;
      title: string;
    }>();
  if (!document) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.computer_file_target_mismatch",
      reason:
        "This file is not the assigned Profile Report for this research task.",
      status: 409,
    });
  }
  const expectedPath = buildCenterAgentProfileReportComputerPath({
    documentTitle: document.title,
    profileReportFolderName: document.profile_report_folder_name,
  });
  if (input.path !== expectedPath) {
    throw createCoreRpcHttpError({
      code: "center_agent_member_research.computer_file_path_invalid",
      reason:
        "This file path does not match the Profile Report folder and title assigned by Core.",
      status: 422,
    });
  }
  const existing = await input.db
    .prepare(
      `
        SELECT document_id, path, subject_user_id
        FROM center_agent_member_research_computer_files
        WHERE task_id = ?
        LIMIT 1
      `
    )
    .bind(input.taskId)
    .first<{
      document_id: string;
      path: string;
      subject_user_id: string;
    }>();
  if (existing) {
    if (
      existing.document_id !== input.documentId ||
      existing.path !== input.path ||
      existing.subject_user_id !== input.subjectUserId
    ) {
      throw createCoreRpcHttpError({
        code: "center_agent_member_research.computer_file_conflict",
        reason:
          "This research task already recorded a different Profile Report file.",
        status: 409,
      });
    }
    return {
      documentId: existing.document_id,
      path: existing.path,
      taskId: input.taskId,
    };
  }
  await input.db
    .prepare(
      `
        INSERT INTO center_agent_member_research_computer_files (
          task_id,
          document_id,
          subject_user_id,
          path,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.taskId,
      input.documentId,
      input.subjectUserId,
      input.path,
      input.nowMs
    )
    .run();
  return {
    documentId: input.documentId,
    path: input.path,
    taskId: input.taskId,
  };
}
