import {
  listSpaceTasksResponseSchema,
  readLinearIssueReference,
  SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
  spaceTaskExternalWorkItemIdentityKey,
  spaceTaskMutationReceiptSchema,
} from "@openmeld/schemas";
import type { SpaceTask } from "@openmeld/schemas/types";
import type { RemoteAgentCoreWorkerBinding } from "./callback-context";
import type { buildRemoteAgentToolContext } from "./tool-context";

export async function attachCreatedLinearIssueToSourceTask(input: {
  actionInput: Record<string, unknown>;
  coreWorker: RemoteAgentCoreWorkerBinding;
  data: unknown;
  projectId: string | null;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<{
  linked: boolean;
  reason?: string;
  task: SpaceTask | null;
}> {
  if (input.toolContext.turnEnvelope?.space.kind !== "space") {
    return { linked: false, task: null };
  }
  const item = readLinearIssueReference(input);
  if (!item) {
    return {
      linked: false,
      reason:
        "Linear created the issue, but its exact identifier and URL were not returned. The Task link needs recovery; do not create the issue again.",
      task: null,
    };
  }
  const { listSpaceTasks, mutateSpaceTask } = input.coreWorker;
  if (!(listSpaceTasks && mutateSpaceTask)) {
    return {
      linked: false,
      reason:
        "Linear created the issue, but Task linking is unavailable. Do not create the issue again.",
      task: null,
    };
  }
  const spaceId = input.toolContext.turnEnvelope.space.id;
  const context = input.toolContext.context;
  const listed = listSpaceTasksResponseSchema.parse(
    await listSpaceTasks({
      context,
      spaceId,
      taskContractVersion: SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
    })
  );
  const candidates = listed.tasks.filter(
    (task) =>
      task.sourceSignalId === input.toolContext.triggerMessageId &&
      task.phase !== "done" &&
      task.phase !== "canceled" &&
      (input.projectId === null ||
        task.projectIds.length === 0 ||
        task.projectIds.includes(input.projectId))
  );
  if (candidates.length === 0) {
    return listed.truncated
      ? {
          linked: false,
          reason:
            "Linear created the issue, but OpenMeld could not inspect every Task. Link the exact issue without creating it again.",
          task: null,
        }
      : { linked: false, task: null };
  }
  if (candidates.length > 1) {
    return {
      linked: false,
      reason:
        "Linear created the issue, but several Tasks match the request. Choose the Task for the exact issue link; do not create another issue.",
      task: null,
    };
  }
  const task = candidates[0];
  if (!task) {
    return { linked: false, task: null };
  }
  const key = spaceTaskExternalWorkItemIdentityKey(item);
  if (
    task.externalWorkItems.some(
      (candidate) => spaceTaskExternalWorkItemIdentityKey(candidate) === key
    )
  ) {
    return { linked: true, task };
  }
  try {
    const receipt = spaceTaskMutationReceiptSchema.parse(
      await mutateSpaceTask({
        body: {
          action: "attach_external_work_item",
          expectedRevision: task.revision,
          item,
          operationId: `linear-issue-attach:${item.id}:${task.taskId}`,
        },
        context,
        spaceId,
        taskId: task.taskId,
        taskContractVersion: SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
      })
    );
    return {
      linked: true,
      task: receipt.task,
    };
  } catch (error) {
    return {
      linked: false,
      reason: `Linear created ${item.identifier}, but the Task link failed: ${error instanceof Error ? error.message : String(error)}. Retry only the Task association.`,
      task: null,
    };
  }
}
