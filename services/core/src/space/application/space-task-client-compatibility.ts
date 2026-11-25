import {
  SPACE_TASK_CONTRACT_UPDATE_REQUIRED_ERROR_CODE,
  SPACE_TASK_WORKFLOW_CONTRACT_VERSION,
} from "@openmeld/schemas";
import type {
  ListSpaceTasksResponse,
  SpaceTask,
  SpaceTaskDetailOptions,
  SpaceTaskEvent,
  SpaceTaskMutationReceipt,
  SpaceTaskResponse,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../rpc/errors";

type TaskContractVersion = SpaceTaskDetailOptions["taskContractVersion"];

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
      return projectOlderTask(task, taskContractVersion);
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
  if (
    detail.pendingActions?.some(
      (action) => action.kind === "github_pr_projection"
    )
  ) {
    throw spaceTaskContractUpdateRequiredError();
  }
  return {
    ...detail,
    task: projectOlderTask(detail.task, taskContractVersion),
  };
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
  return {
    ...receipt,
    task: projectOlderTask(receipt.task, taskContractVersion),
  };
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
    task.pullRequest ||
    task.review?.pullRequestHeadSha ||
    events.some((event) => event.type === "pull_request_head_changed")
  ) {
    throw spaceTaskContractUpdateRequiredError();
  }
  if (version === 3) {
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

function projectOlderTask(
  task: SpaceTask,
  version: TaskContractVersion
): SpaceTask {
  const { pullRequest: _pullRequest, ...compatible } = task;
  if (compatible.review && "pullRequestHeadSha" in compatible.review) {
    const { pullRequestHeadSha: _sha, ...review } = compatible.review;
    compatible.review = review;
  }
  if (version !== undefined) {
    return compatible;
  }
  const { projectIds: _projectIds, ...legacyTask } = compatible;
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
