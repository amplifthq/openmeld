import type { AgentControllerProcessSignalTarget } from "@openmeld/adapter-core";
import type {
  AgentControllerPermissionMode,
  OpenMeldDaemonControlTargetSelector,
} from "@openmeld/schemas/types";
import type {
  InflightTaskControlRecord,
  LocalControlResolution,
} from "./control-plane-types.js";

type RegisterInflightTaskInput = {
  adapterId: string;
  agentControllerPermissionMode?: AgentControllerPermissionMode | null;
  dispatchId: string;
  runtimeCoordinatorExecutionId?: string | null;
  targetProfileId?: string | null;
  taskId: string;
};

type UpdateInflightTaskPermissionModeInput = {
  agentControllerPermissionMode: AgentControllerPermissionMode;
  taskId: string;
};

type UpdateInflightTaskProcessInput = {
  processId: number | null;
  signalTarget?: AgentControllerProcessSignalTarget | null;
  taskId: string;
};

export function createInflightTaskControlRegistry() {
  const recordByTaskId = new Map<string, InflightTaskControlRecord>();
  const taskIdByDispatchId = new Map<string, string>();

  const readRecord = (taskId: string): InflightTaskControlRecord | null =>
    recordByTaskId.get(taskId) ?? null;

  return {
    registerTask(input: RegisterInflightTaskInput): InflightTaskControlRecord {
      const existing = readRecord(input.taskId);
      if (
        existing &&
        existing.dispatchId !== input.dispatchId &&
        taskIdByDispatchId.get(existing.dispatchId) === existing.taskId
      ) {
        taskIdByDispatchId.delete(existing.dispatchId);
      }

      const record: InflightTaskControlRecord = {
        adapterId: input.adapterId,
        agentControllerPermissionMode:
          input.agentControllerPermissionMode ??
          existing?.agentControllerPermissionMode ??
          null,
        dispatchId: input.dispatchId,
        processId: existing?.processId ?? null,
        runtimeCoordinatorExecutionId:
          input.runtimeCoordinatorExecutionId ?? null,
        signalTarget: existing?.signalTarget ?? null,
        targetProfileId:
          input.targetProfileId ?? existing?.targetProfileId ?? null,
        taskId: input.taskId,
        updatedAt: new Date().toISOString(),
      };
      recordByTaskId.set(input.taskId, record);
      taskIdByDispatchId.set(input.dispatchId, input.taskId);
      return record;
    },

    updateTaskPermissionMode(
      input: UpdateInflightTaskPermissionModeInput
    ): InflightTaskControlRecord | null {
      const existing = readRecord(input.taskId);
      if (!existing) {
        return null;
      }
      const updated: InflightTaskControlRecord = {
        ...existing,
        agentControllerPermissionMode: input.agentControllerPermissionMode,
        updatedAt: new Date().toISOString(),
      };
      recordByTaskId.set(input.taskId, updated);
      return updated;
    },

    updateTaskProcess(
      input: UpdateInflightTaskProcessInput
    ): InflightTaskControlRecord | null {
      const existing = readRecord(input.taskId);
      if (!existing) {
        return null;
      }
      const updated: InflightTaskControlRecord = {
        ...existing,
        processId: input.processId,
        signalTarget:
          input.processId === null
            ? null
            : (input.signalTarget ?? existing.signalTarget),
        updatedAt: new Date().toISOString(),
      };
      recordByTaskId.set(input.taskId, updated);
      return updated;
    },

    removeTask(taskId: string): InflightTaskControlRecord | null {
      const existing = readRecord(taskId);
      if (!existing) {
        return null;
      }
      recordByTaskId.delete(taskId);
      if (taskIdByDispatchId.get(existing.dispatchId) === existing.taskId) {
        taskIdByDispatchId.delete(existing.dispatchId);
      }
      return existing;
    },

    getTask(taskId: string): InflightTaskControlRecord | null {
      return readRecord(taskId);
    },

    resolveTarget(
      target: OpenMeldDaemonControlTargetSelector
    ): LocalControlResolution | null {
      if (target.by === "task") {
        const record = readRecord(target.taskId);
        if (!record) {
          return null;
        }
        return {
          record,
          target,
        };
      }

      const taskId = taskIdByDispatchId.get(target.dispatchId);
      if (!taskId) {
        return null;
      }
      const record = readRecord(taskId);
      if (!record) {
        taskIdByDispatchId.delete(target.dispatchId);
        return null;
      }
      return {
        record,
        target,
      };
    },

    listTasks(): InflightTaskControlRecord[] {
      return [...recordByTaskId.values()].sort((left, right) =>
        left.taskId.localeCompare(right.taskId)
      );
    },
  } as const;
}

export type InflightTaskControlRegistry = ReturnType<
  typeof createInflightTaskControlRegistry
>;
