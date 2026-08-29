import type {
  InflightTaskControlRegistry,
  LocalDaemonAdapterContainer,
} from "@openmeld/local-service";
import type { AgentControllerPermissionMode } from "@openmeld/schemas/types";
import type { MutableRouteCatalogState } from "../core/types";

export type ActivePermissionModeSyncOutcome = {
  adapterId: string;
  agentControllerPermissionMode: AgentControllerPermissionMode;
  errorMessage?: string;
  reasonCode?:
    | "adapter.permission_mode_incompatible"
    | "adapter.permission_mode_update_unsupported"
    | "adapter.task_not_active";
  status: "applied" | "failed" | "not_applied";
  targetProfileId: string;
  taskId: string;
};

export async function syncActiveTaskPermissionModes(input: {
  catalogState: MutableRouteCatalogState;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  localAdapterContainer: LocalDaemonAdapterContainer;
}): Promise<ActivePermissionModeSyncOutcome[]> {
  const outcomes: ActivePermissionModeSyncOutcome[] = [];

  for (const task of input.inflightTaskControlRegistry.listTasks()) {
    if (!task.targetProfileId) {
      continue;
    }
    const route = input.catalogState.routeByProfileId.get(task.targetProfileId);
    const nextPermissionMode = route?.agentControllerPermissionMode;
    if (
      !nextPermissionMode ||
      nextPermissionMode === task.agentControllerPermissionMode
    ) {
      continue;
    }

    const adapterEntry = input.localAdapterContainer.getAdapter(task.adapterId);
    const updatePermissionMode = adapterEntry?.adapter.updatePermissionMode;
    if (!updatePermissionMode) {
      outcomes.push({
        adapterId: task.adapterId,
        agentControllerPermissionMode: nextPermissionMode,
        reasonCode: "adapter.permission_mode_update_unsupported",
        status: "not_applied",
        targetProfileId: task.targetProfileId,
        taskId: task.taskId,
      });
      continue;
    }

    try {
      const result = await updatePermissionMode({
        agentControllerPermissionMode: nextPermissionMode,
        taskId: task.taskId,
      });
      if (result.status === "not_applied") {
        outcomes.push({
          adapterId: task.adapterId,
          agentControllerPermissionMode: nextPermissionMode,
          reasonCode: result.reasonCode,
          status: "not_applied",
          targetProfileId: task.targetProfileId,
          taskId: task.taskId,
        });
        continue;
      }

      input.inflightTaskControlRegistry.updateTaskPermissionMode({
        agentControllerPermissionMode: nextPermissionMode,
        taskId: task.taskId,
      });
      outcomes.push({
        adapterId: task.adapterId,
        agentControllerPermissionMode: nextPermissionMode,
        status: "applied",
        targetProfileId: task.targetProfileId,
        taskId: task.taskId,
      });
    } catch (error) {
      outcomes.push({
        adapterId: task.adapterId,
        agentControllerPermissionMode: nextPermissionMode,
        errorMessage: error instanceof Error ? error.message : String(error),
        status: "failed",
        targetProfileId: task.targetProfileId,
        taskId: task.taskId,
      });
    }
  }

  return outcomes;
}
