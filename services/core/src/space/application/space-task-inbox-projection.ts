import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  INBOX_CONTEXT_LABEL_MAX_CHARS,
  INBOX_PREVIEW_MAX_CHARS,
  INBOX_TITLE_MAX_CHARS,
  inboxSourceCandidateSchema,
} from "@openmeld/schemas";
import type {
  SpaceTask,
  SpaceTaskActor,
  SpaceTaskEvent,
} from "@openmeld/schemas/types";
import { prepareEnsureInboxItemStatements } from "../../inbox/application/inbox-item-service";
import { truncateInboxText } from "../../inbox/application/inbox-text";
import { resolveSpaceTaskHumanDecisionTarget } from "./space-task-delivery";

// Task owns assignment, review, and completion. Only an exact active Human
// assignee or reviewer receives the corresponding Inbox item.
export function buildSpaceTaskInboxCandidate(input: {
  task: SpaceTask;
  events: readonly SpaceTaskEvent[];
  activeMembers: readonly SpaceTaskActor[];
  ownerUserIds: readonly string[];
  organizationId: string;
  spaceName: string | null;
  threadRootSignalId?: string;
}) {
  const { task } = input;
  const pending = taskInboxRequest(input);
  if (
    !pending ||
    pending.recipient?.profileKind !== "human" ||
    !pending.recipient.ownerUserId
  ) {
    return null;
  }
  const requestEvent = input.events.findLast((event) =>
    pending.eventTypes.includes(event.type)
  );
  if (!requestEvent) {
    throw new Error("Task attention request has no retained source event");
  }
  const signalId = pending.handoff
    ? `space-task-handoff:${requestEvent.eventId}`
    : task.sourceSignalId;
  return inboxSourceCandidateSchema.parse({
    organizationId: input.organizationId,
    recipientUserId: pending.recipient.ownerUserId,
    attention: "action_required",
    importance: "normal",
    kind: "organization_request",
    contextLabel: truncateInboxText(
      input.spaceName || "Space",
      INBOX_CONTEXT_LABEL_MAX_CHARS
    ),
    title: truncateInboxText(pending.title, INBOX_TITLE_MAX_CHARS),
    preview: truncateInboxText(pending.preview, INBOX_PREVIEW_MAX_CHARS),
    sourceKind: "system_attention_event",
    sourceKey: `space-task:${task.taskId}:${requestEvent.eventId}`,
    occurredAtMs: Date.parse(requestEvent.createdAt),
    sourceFacts: {
      version: 1,
      recipientReasons: ["space_member"],
      requestCategory: pending.category,
    },
    sourceTarget: {
      kind: "space",
      spaceId: task.spaceId,
      ...(signalId ? { signalId } : {}),
      ...(input.threadRootSignalId
        ? { threadRootSignalId: input.threadRootSignalId }
        : {}),
    },
  });
}

function taskInboxRequest(
  input: Parameters<typeof buildSpaceTaskInboxCandidate>[0]
): {
  category: "action" | "review";
  recipient: SpaceTaskActor | null | undefined;
  eventTypes: readonly SpaceTaskEvent["type"][];
  handoff: boolean;
  title: string;
  preview: string;
} | null {
  const { task } = input;
  if (task.needsHumanDecision) {
    return {
      category: "action",
      recipient: resolveSpaceTaskHumanDecisionTarget(
        task,
        input.activeMembers,
        input.ownerUserIds
      ),
      eventTypes: ["changes_requested"],
      handoff: true,
      title: `Decide next steps: ${task.title}`,
      preview:
        "This Task needs your decision after repeated review changes. Open the Task to continue or cancel it.",
    };
  }
  if (task.phase === "in_review" && task.result !== null) {
    return {
      category: "review",
      recipient: input.activeMembers.find(
        (member) => member.profileId === task.reviewer?.profileId
      ),
      eventTypes: ["result_submitted"],
      handoff: true,
      title: `Review: ${task.title}`,
      preview: task.result.summary,
    };
  }
  if (task.phase === "to_do" || task.phase === "in_progress") {
    return {
      category: "action",
      recipient: input.activeMembers.find(
        (member) => member.profileId === task.assignee?.profileId
      ),
      eventTypes: [
        "assigned",
        "created",
        "reopened",
        "changes_requested",
        "rework_continued",
      ],
      handoff: false,
      title: `Complete: ${task.title}`,
      preview:
        "This Space Task is assigned to you. Open the Space Tasks board to submit your result.",
    };
  }
  return null;
}

export async function projectSpaceTaskInbox(
  input: Parameters<typeof buildSpaceTaskInboxCandidate>[0] & {
    db: PostgresDatabase;
    nowMs: number;
  }
) {
  const candidate = buildSpaceTaskInboxCandidate(input);
  const prepared = candidate
    ? await prepareEnsureInboxItemStatements({
        candidate,
        db: input.db,
        nowMs: input.nowMs,
      })
    : null;
  return await input.db.transaction(async (client) => {
    for (const statement of prepared?.statements ?? []) {
      await client.query(statement);
    }
    const resolved = await client.query<{ recipient_user_id: string }>({
      text: `UPDATE "openmeld"."inbox_items" SET resolution_status = 'resolved', resolved_at_ms = $1, updated_at_ms = GREATEST(updated_at_ms, $1)
        WHERE organization_id = $2 AND source_kind = 'system_attention_event' AND starts_with(source_key, $3) AND resolution_status = 'open'
        AND NOT (source_key IS NOT DISTINCT FROM $4 AND recipient_user_id IS NOT DISTINCT FROM $5) RETURNING recipient_user_id`,
      values: [
        input.nowMs,
        input.organizationId,
        `space-task:${input.task.taskId}:`,
        candidate?.sourceKey ?? null,
        candidate?.recipientUserId ?? null,
      ],
    });
    return [
      ...new Set([
        ...resolved.rows.map((row) => row.recipient_user_id),
        ...(candidate ? [candidate.recipientUserId] : []),
      ]),
    ];
  });
}
