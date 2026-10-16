import type { SignalEnvelope, SpaceTask } from "@openmeld/schemas/types";
import type { OpenMeldDaemonDispatchOutboxRecord } from "../infrastructure/outbox/dispatch-outbox-repo";
import { SpaceTaskDeliveryRepository } from "../infrastructure/sql/space-task-delivery-repo";
import { SpaceTaskRepository } from "../infrastructure/sql/space-task-repo";
import { SpaceTaskService } from "./space-task-service";
import type { SpaceTaskMutationContext } from "./space-task-workflow";

/** The same Task identity and explicit workflow follow every handoff. */
export function formatSpaceTaskHandoffContext(task: SpaceTask): string {
  const action =
    task.phase === "in_review"
      ? "Review the submitted result, then use review_task (or openmeld_manage_space_tasks action=review) for this Task. Read the current Task and pass both expectedRevision and the resultRevision you actually reviewed as expectedResultRevision. A normal reply is not an approval."
      : "Read this Task with list_tasks (or openmeld_manage_space_tasks action=list). If it is To do and you are still the assignee, call start_task (action=mark_in_progress) before beginning work. Submit the concrete result and verification with submit_task_result (action=submit_result). A normal reply does not submit a Task result.";
  return [
    `Space Task: ${task.taskId}; revision: ${task.revision}; phase: ${task.phase}.`,
    `Title: ${task.title}`,
    `Assignee: ${task.assignee?.profileId ?? "unassigned"}; reviewer: ${task.reviewer?.profileId ?? "none"}.`,
    task.description,
    task.completionConditions.length
      ? `Done when:\n${task.completionConditions.map((condition) => `- ${condition}`).join("\n")}`
      : null,
    task.result
      ? `Submitted result (revision ${task.result.resultRevision}):\n${task.phase === "in_review" ? "Read the submitted result in the handoff message above." : task.result.summary}`
      : null,
    task.review?.feedback ? `Review feedback:\n${task.review.feedback}` : null,
    action,
    "Use this existing Task; do not create a replacement. Task operations do not finish your execution: publish the permitted final Space reply separately. Space delivers review and rework handoffs; do not send another Wake for them. Task phase records collaboration, not execution state.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The caller owns the transaction that also persists the message and dispatch. */
export function createSpaceTaskForMessage(input: {
  sql: SqlStorage;
  signal: Extract<SignalEnvelope, { type: "signal.text" }>;
  context: SpaceTaskMutationContext;
  threadId: string | null;
}) {
  const { signal, context, sql } = input;
  if (!signal.data.taskDraft) {
    return null;
  }
  const service = new SpaceTaskService({
    repository: new SpaceTaskRepository(sql),
    runTransaction: (callback) => callback(),
    spaceId: signal.spaceId,
  });
  const receipt = service.create(
    {
      ...signal.data.taskDraft,
      operationId: `message:${signal.id}`,
      description:
        signal.data.text.trim() === signal.data.taskDraft.title
          ? null
          : signal.data.text.slice(0, 8000),
      sourceSignalId: signal.id,
      threadId: input.threadId,
    },
    { ...context, requestedBy: context.actor }
  );
  const deliveries = new SpaceTaskDeliveryRepository(sql);
  for (const target of signal.data.messageEnvelope?.activationTargets ?? []) {
    deliveries.recordWake(receipt.task.taskId, signal.id, target);
  }
  return receipt;
}

/** Preserve the prepared records so a rolled-back insertion can be retried. */
export function withSpaceTaskDispatchContext(
  task: SpaceTask,
  dispatches: readonly OpenMeldDaemonDispatchOutboxRecord[]
) {
  return dispatches.map((dispatch) => {
    const snapshot = dispatch.sourceSignalSnapshot;
    if (!snapshot) {
      return dispatch;
    }
    const sourceSignalSnapshot = {
      ...snapshot,
      text: `${snapshot.text}\n\n${formatSpaceTaskHandoffContext(task)}`,
    };
    return {
      ...dispatch,
      sourceSignalSnapshot,
      payloadJson: JSON.stringify({
        ...JSON.parse(dispatch.payloadJson),
        sourceSignalSnapshot,
      }),
    };
  });
}
