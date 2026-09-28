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
      assertLegacySpaceTaskCanRead(task);
      return omitSpaceTaskProjectIds(task);
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
  assertLegacySpaceTaskCanRead(detail.task, detail.events);
  return { ...detail, task: omitSpaceTaskProjectIds(detail.task) };
}

export function projectSpaceTaskReceiptForClient(
  receipt: SpaceTaskMutationReceipt,
  taskContractVersion: TaskContractVersion
): SpaceTaskMutationReceipt {
  if (taskContractVersion === SPACE_TASK_WORKFLOW_CONTRACT_VERSION) {
    return receipt;
  }
  assertLegacySpaceTaskCanRead(receipt.task, [receipt.event]);
  return { ...receipt, task: omitSpaceTaskProjectIds(receipt.task) };
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
      "Update this OpenMeld client to work with Project-scoped Tasks and Linear references.",
    status: 426,
  });
}
