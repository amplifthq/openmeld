import type { SignalEnvelope, SpaceTask } from "@openmeld/schemas/types";
import type { OpenMeldDaemonDispatchOutboxRecord } from "../infrastructure/outbox/dispatch-outbox-repo";
import { SpaceTaskDeliveryRepository } from "../infrastructure/sql/space-task-delivery-repo";
import { SpaceTaskRepository } from "../infrastructure/sql/space-task-repo";
import { SpaceTaskService } from "./space-task-service";
import type { SpaceTaskMutationContext } from "./space-task-workflow";

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
      text: `${snapshot.text}\n\nSpace task: ${task.taskId}\nTitle: ${task.title}\nAssignee: ${task.assignee?.profileId ?? "unassigned"}\nReviewer: ${task.reviewer?.profileId ?? "none"}\nThis message created the task. Use the existing task to track progress and submit results; do not create a duplicate.`,
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
