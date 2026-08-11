import {
  INBOX_PREVIEW_MAX_CHARS,
  INBOX_TITLE_MAX_CHARS,
} from "@openmeld/schemas";
import type {
  CenterAgentTask,
  CenterAgentTaskEvent,
} from "@openmeld/schemas/types";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../../inbox/application/inbox-item-service";
import { truncateInboxText } from "../../inbox/application/inbox-text";

type CenterAgentTaskInboxTask = Pick<
  CenterAgentTask,
  "id" | "organizationId" | "requesterUserId" | "status" | "title"
>;

type CenterAgentTaskInboxEvent = Pick<
  CenterAgentTaskEvent,
  "id" | "occurredAt" | "text"
>;

export async function projectCenterAgentTaskInboxItem(input: {
  db: D1Database;
  event: CenterAgentTaskInboxEvent;
  importance?: "normal" | "urgent";
  nowMs: number;
  task: CenterAgentTaskInboxTask;
}): Promise<void> {
  const recipientUserId = input.task.requesterUserId?.trim() ?? "";
  const attention = resolveInboxAttention(input.task.status);
  await replaceCenterAgentTaskAuthorizedReaderProjection({
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.task.organizationId,
    requesterUserId: recipientUserId || null,
    taskId: input.task.id,
  });
  if (!recipientUserId || attention === null) {
    return;
  }

  await ensureInboxItem({
    candidate: {
      attention,
      contextLabel: "Center Agent Task",
      importance: input.importance ?? "normal",
      kind: "center_agent_task",
      occurredAtMs: Date.parse(input.event.occurredAt),
      organizationId: input.task.organizationId,
      preview: truncateInboxText(input.event.text, INBOX_PREVIEW_MAX_CHARS),
      recipientUserId,
      sourceKey: buildCenterAgentTaskInboxSourceKey({
        eventId: input.event.id,
        taskId: input.task.id,
      }),
      sourceKind: "center_agent_task_event",
      sourceTarget: {
        kind: "center_agent_task",
        taskId: input.task.id,
      },
      title: truncateInboxText(input.task.title, INBOX_TITLE_MAX_CHARS),
    },
    db: input.db,
    nowMs: input.nowMs,
  });
}

export async function replaceCenterAgentTaskAuthorizedReaderProjection(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  requesterUserId: string | null;
  taskId: string;
}): Promise<void> {
  const deleteStaleReaders = input.db
    .prepare(
      `
        DELETE FROM center_agent_task_authorized_readers
        WHERE task_id = ?
          AND organization_id = ?
          AND (? IS NULL OR user_id <> ?)
      `
    )
    .bind(
      input.taskId,
      input.organizationId,
      input.requesterUserId,
      input.requesterUserId
    );
  if (!input.requesterUserId) {
    await deleteStaleReaders.run();
    return;
  }
  await input.db.batch([
    deleteStaleReaders,
    input.db
      .prepare(
        `
          INSERT INTO center_agent_task_authorized_readers (
            task_id,
            organization_id,
            user_id,
            access_scope,
            updated_at_ms
          ) VALUES (?, ?, ?, 'requester_private', ?)
          ON CONFLICT(task_id, user_id) DO UPDATE SET
            organization_id = excluded.organization_id,
            access_scope = excluded.access_scope,
            updated_at_ms = MAX(
              center_agent_task_authorized_readers.updated_at_ms,
              excluded.updated_at_ms
            )
        `
      )
      .bind(
        input.taskId,
        input.organizationId,
        input.requesterUserId,
        input.nowMs
      ),
  ]);
}

export async function resolveCenterAgentTaskNeedsAttentionInboxItem(input: {
  db: D1Database;
  eventId: string;
  organizationId: string;
  resolvedAtMs: number;
  taskId: string;
}): Promise<number> {
  return await resolveInboxItemsBySource({
    db: input.db,
    organizationId: input.organizationId,
    resolvedAtMs: input.resolvedAtMs,
    sourceKey: buildCenterAgentTaskInboxSourceKey(input),
    sourceKind: "center_agent_task_event",
  });
}

export function buildCenterAgentTaskInboxSourceKey(input: {
  eventId: string;
  taskId: string;
}): string {
  return `${input.taskId}:${input.eventId}`;
}

function resolveInboxAttention(
  status: CenterAgentTaskInboxTask["status"]
): "action_required" | "update" | null {
  if (status === "needs_attention") {
    return "action_required";
  }
  if (status === "failed" || status === "stopped" || status === "succeeded") {
    return "update";
  }
  return null;
}
