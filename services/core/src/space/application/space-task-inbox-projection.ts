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

// Task owns the request and response. Inbox only projects the current Human's
// review or rework decision; an Agent reviewer does not delegate to its owner.
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
  const review =
    task.phase === "in_review" &&
    task.result !== null &&
    !task.needsHumanDecision;
  let recipient: SpaceTaskActor | null | undefined = null;
  if (review) {
    recipient = input.activeMembers.find(
      (member) => member.profileId === task.reviewer?.profileId
    );
  } else if (task.needsHumanDecision) {
    recipient = resolveSpaceTaskHumanDecisionTarget(
      task,
      input.activeMembers,
      input.ownerUserIds
    );
  }
  if (
    recipient?.profileKind !== "human" ||
    !recipient.ownerUserId ||
    !(review || task.needsHumanDecision)
  ) {
    return null;
  }
  const requestEvent = [...input.events]
    .reverse()
    .find((event) =>
      review
        ? event.type === "result_submitted"
        : event.type === "changes_requested"
    );
  if (!requestEvent) {
    throw new Error("Task attention request has no retained source event");
  }
  const submitted = [...input.events]
    .reverse()
    .find((event) => event.type === "result_submitted");
  const navigationEvent = review ? submitted : requestEvent;
  const signalId = navigationEvent
    ? `space-task-handoff:${navigationEvent.eventId}`
    : task.sourceSignalId;
  return inboxSourceCandidateSchema.parse({
    organizationId: input.organizationId,
    recipientUserId: recipient.ownerUserId,
    attention: "action_required",
    importance: "normal",
    kind: "organization_request",
    contextLabel: truncateInboxText(
      input.spaceName || "Space",
      INBOX_CONTEXT_LABEL_MAX_CHARS
    ),
    title: truncateInboxText(
      review ? `Review: ${task.title}` : `Decide next steps: ${task.title}`,
      INBOX_TITLE_MAX_CHARS
    ),
    preview: truncateInboxText(
      review
        ? (task.result?.summary ?? "A result was submitted.")
        : "This Task needs your decision after repeated review changes. Open the Task to continue or cancel it.",
      INBOX_PREVIEW_MAX_CHARS
    ),
    sourceKind: "system_attention_event",
    sourceKey: `space-task:${task.taskId}:${requestEvent.eventId}`,
    occurredAtMs: Date.parse(requestEvent.createdAt),
    sourceFacts: {
      version: 1,
      recipientReasons: ["space_member"],
      requestCategory: review ? "review" : "action",
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
