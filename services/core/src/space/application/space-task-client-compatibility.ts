import {
  SPACE_TASK_CONTRACT_UPDATE_REQUIRED_ERROR_CODE,
  SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
} from "@openmeld/schemas";
import type {
  ListSpaceTasksResponse,
  SpaceTask,
  SpaceTaskEvent,
  SpaceTaskMutationReceipt,
  SpaceTaskResponse,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../rpc/errors";

type TaskContractVersion =
  | typeof SPACE_TASK_WORKFLOW_CONTRACT_VERSION
  | 2
  | undefined;

export function projectSpaceTasksForClient(
  listed: ListSpaceTasksResponse,
  taskContractVersion: TaskContractVersion
): ListSpaceTasksResponse {
  if (taskContractVersion === SPACE_TASK_WORKFLOW_CONTRACT_VERSION) {
    return listed;
  }
  return {
    ...listed,
    tasks: listed.tasks.map((task) => {
      assertSpaceTaskClientCanRead(task, [], taskContractVersion);
      return taskContractVersion === 2 ? task : omitSpaceTaskProjectIds(task);
    }),
  };
}

export function projectSpaceTaskDetailForClient(
  detail: SpaceTaskResponse,
  taskContractVersion: TaskContractVersion
): SpaceTaskResponse {
  if (taskContractVersion === SPACE_TASK_WORKFLOW_CONTRACT_VERSION) {
    return detail;
  }
  assertSpaceTaskClientCanRead(detail.task, detail.events, taskContractVersion);
  return taskContractVersion === 2
    ? detail
    : { ...detail, task: omitSpaceTaskProjectIds(detail.task) };
}

export function projectSpaceTaskReceiptForClient(
  receipt: SpaceTaskMutationReceipt,
  taskContractVersion: TaskContractVersion
): SpaceTaskMutationReceipt {
  if (taskContractVersion === SPACE_TASK_WORKFLOW_CONTRACT_VERSION) {
    return receipt;
  }
  assertSpaceTaskClientCanRead(
    receipt.task,
    [receipt.event],
    taskContractVersion
  );
  return taskContractVersion === 2
    ? receipt
    : { ...receipt, task: omitSpaceTaskProjectIds(receipt.task) };
}

export function assertSpaceTaskClientCanRead(
  task: SpaceTask,
  events: readonly SpaceTaskEvent[] = [],
  version?: TaskContractVersion
): void {
  if (version === SPACE_TASK_WORKFLOW_CONTRACT_VERSION) {
    return;
  }
  if (
    (task.result && "provider" in task.result.submittedBy) ||
    events.some((event) => "provider" in event.actor)
  ) {
    throw spaceTaskContractUpdateRequiredError();
  }
  if (version === undefined) {
    assertLegacySpaceTaskCanRead(task, events);
  }
}

export function assertLegacySpaceTaskCanRead(
  task: SpaceTask,
  events: readonly SpaceTaskEvent[] = []
): void {
  if (
    task.projectIds.length > 0 ||
    task.externalWorkItems.some((item) => item.provider === "linear") ||
    events.some((event) => event.type === "projects_set")
  ) {
    throw spaceTaskContractUpdateRequiredError();
  }
}

function omitSpaceTaskProjectIds(task: SpaceTask): SpaceTask {
  const { projectIds: _projectIds, ...legacyTask } = task;
  // Only the legacy wire projection omits this new field. Core keeps the
  // complete Task internally and rejects unsupported current facts above.
  return legacyTask as SpaceTask;
}

export function spaceTaskContractUpdateRequiredError(): Error {
  return createCoreRpcHttpError({
    code: SPACE_TASK_CONTRACT_UPDATE_REQUIRED_ERROR_CODE,
    reason:
      "Update this OpenMeld client to read the current Task workflow and its recorded sources.",
    status: 426,
  });
}
