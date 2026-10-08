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

type ActivePermissionModeSyncInput = {
  catalogState: Pick<MutableRouteCatalogState, "routeByProfileId">;
  taskId?: string;
  inflightTaskControlRegistry: InflightTaskControlRegistry;
  localAdapterContainer: LocalDaemonAdapterContainer;
};

// Catalog sync and approval release can converge at the same time. Serialize
// their native writes and read the current catalog after the prior write ends.
const pendingSyncs = new WeakMap<
  InflightTaskControlRegistry,
  Promise<ActivePermissionModeSyncOutcome[]>
>();

export function syncActiveTaskPermissionModes(
  input: ActivePermissionModeSyncInput
): Promise<ActivePermissionModeSyncOutcome[]> {
  const previous = pendingSyncs.get(input.inflightTaskControlRegistry);
  const run = () => applyActiveTaskPermissionModes(input);
  const current = previous ? previous.then(run, run) : run();
  pendingSyncs.set(input.inflightTaskControlRegistry, current);
  const cleanup = () => {
    if (pendingSyncs.get(input.inflightTaskControlRegistry) === current) {
      pendingSyncs.delete(input.inflightTaskControlRegistry);
    }
  };
  current.then(cleanup, cleanup);
  return current;
}

async function applyActiveTaskPermissionModes(
  input: ActivePermissionModeSyncInput
): Promise<ActivePermissionModeSyncOutcome[]> {
  const outcomes: ActivePermissionModeSyncOutcome[] = [];

  const tasks = input.inflightTaskControlRegistry
    .listTasks()
    .filter((task) => !input.taskId || input.taskId === task.taskId);
  for (const task of tasks) {
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

      const currentTask = input.inflightTaskControlRegistry.getTask(
        task.taskId
      );
      if (
        !currentTask ||
        currentTask.dispatchId !== task.dispatchId ||
        currentTask.attemptId !== task.attemptId
      ) {
        outcomes.push({
          adapterId: task.adapterId,
          agentControllerPermissionMode: nextPermissionMode,
          reasonCode: "adapter.task_not_active",
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
