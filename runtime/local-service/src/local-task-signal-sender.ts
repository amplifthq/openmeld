import {
  type ListAgentControllerDescendantProcessIds,
  listAgentControllerDescendantProcessIds,
  resolveAgentControllerProcessSignalId,
  signalAgentControllerProcessTree,
} from "@openmeld/adapter-core";
import type {
  ControlSignalResult,
  InflightTaskControlRecord,
  LocalTaskInterruptErrorCode,
  LocalTaskInterruptSender,
} from "./control-plane-types.js";
import { resolveUnixSignalForInterruptMode } from "./control-plane-types.js";
import type { InflightTaskControlRegistry } from "./inflight-task-control-registry.js";

type KillProcess = typeof process.kill;

type TrackedProcessTree = {
  descendantProcessIds: Set<number>;
  dispatchId: string;
  processId: number;
  signalTarget: "process" | "process_group";
};

type ResolvedProcessTree = {
  dispatchId: string;
  processId: number;
  processIsAlive: boolean;
  record: InflightTaskControlRecord | null;
  signalTarget: "process" | "process_group";
  trackedProcessTree: TrackedProcessTree;
};

export function createLocalTaskInterruptSender(input: {
  killProcess?: KillProcess;
  listDescendantProcessIds?: ListAgentControllerDescendantProcessIds;
  registry: InflightTaskControlRegistry;
}): LocalTaskInterruptSender {
  const killProcess = input.killProcess ?? process.kill;
  const listDescendantProcessIds =
    input.listDescendantProcessIds ?? listAgentControllerDescendantProcessIds;
  const trackedProcessTreeByTaskId = new Map<string, TrackedProcessTree>();

  return (signal): Promise<ControlSignalResult> => {
    const resolved = resolveProcessTree({
      killProcess,
      mode: signal.mode,
      registry: input.registry,
      taskId: signal.taskId,
      trackedProcessTreeByTaskId,
    });
    const unixSignal = resolveUnixSignalForInterruptMode(signal.mode);
    sendProcessTreeSignal({
      killProcess,
      listDescendantProcessIds,
      mode: signal.mode,
      registry: input.registry,
      resolved,
      taskId: signal.taskId,
      trackedProcessTreeByTaskId,
      unixSignal,
    });

    return Promise.resolve({
      dispatchId: resolved.dispatchId,
      processId: resolved.processId,
      signalTarget: resolved.signalTarget,
      taskId: signal.taskId,
      unixSignal,
    });
  };
}

function resolveProcessTree(input: {
  killProcess: KillProcess;
  mode: "force" | "graceful";
  registry: InflightTaskControlRegistry;
  taskId: string;
  trackedProcessTreeByTaskId: Map<string, TrackedProcessTree>;
}): ResolvedProcessTree {
  const record = input.registry.getTask(input.taskId);
  const trackedProcessTree = input.trackedProcessTreeByTaskId.get(input.taskId);
  if (!(record || (input.mode === "force" && trackedProcessTree))) {
    throw createLocalTaskInterruptError(
      "task.not_found",
      `task '${input.taskId}' is not inflight`
    );
  }

  const processId = record?.processId ?? trackedProcessTree?.processId;
  if (
    !(
      typeof processId === "number" &&
      Number.isInteger(processId) &&
      processId > 0
    )
  ) {
    throw createLocalTaskInterruptError(
      "task.not_running",
      `task '${input.taskId}' does not have an active runtime process`
    );
  }
  const signalTarget =
    record?.signalTarget ?? trackedProcessTree?.signalTarget ?? "process";
  const signalProcessId = resolveAgentControllerProcessSignalId({
    processId,
    signalTarget,
  });
  const processIsAlive = isProcessAlive(input.killProcess, signalProcessId);
  if (
    !processIsAlive &&
    (trackedProcessTree?.descendantProcessIds.size ?? 0) === 0
  ) {
    clearDeadRegistryProcess(input.registry, record, input.taskId);
    throw createLocalTaskInterruptError(
      "task.not_running",
      `task '${input.taskId}' runtime process is no longer running`
    );
  }

  const dispatchId = record?.dispatchId ?? trackedProcessTree?.dispatchId;
  const nextTrackedProcessTree = trackedProcessTree ?? {
    descendantProcessIds: new Set<number>(),
    dispatchId: dispatchId ?? "",
    processId,
    signalTarget,
  };
  input.trackedProcessTreeByTaskId.set(input.taskId, nextTrackedProcessTree);
  return {
    dispatchId: dispatchId ?? "",
    processId,
    processIsAlive,
    record,
    signalTarget,
    trackedProcessTree: nextTrackedProcessTree,
  };
}

function sendProcessTreeSignal(input: {
  killProcess: KillProcess;
  listDescendantProcessIds: ListAgentControllerDescendantProcessIds;
  mode: "force" | "graceful";
  registry: InflightTaskControlRegistry;
  resolved: ResolvedProcessTree;
  taskId: string;
  trackedProcessTreeByTaskId: Map<string, TrackedProcessTree>;
  unixSignal: NodeJS.Signals;
}): void {
  try {
    signalAgentControllerProcessTree({
      killProcess: input.killProcess,
      listDescendantProcessIds: input.resolved.processIsAlive
        ? input.listDescendantProcessIds
        : () => [],
      processId: input.resolved.processId,
      signal: input.unixSignal,
      signalTarget: input.resolved.signalTarget,
      trackedDescendantProcessIds:
        input.resolved.trackedProcessTree.descendantProcessIds,
    });
    if (input.mode === "force") {
      input.trackedProcessTreeByTaskId.delete(input.taskId);
    }
  } catch (error) {
    if (isNoSuchProcessError(error)) {
      clearDeadRegistryProcess(
        input.registry,
        input.resolved.record,
        input.taskId
      );
      throw createLocalTaskInterruptError(
        "task.not_running",
        `task '${input.taskId}' runtime process is no longer running`
      );
    }
    throw createLocalTaskInterruptError(
      "signal.send_failed",
      error instanceof Error ? error.message : "failed to send local signal"
    );
  }
}

function clearDeadRegistryProcess(
  registry: InflightTaskControlRegistry,
  record: InflightTaskControlRecord | null,
  taskId: string
): void {
  if (!record) {
    return;
  }
  registry.updateTaskProcess({
    processId: null,
    taskId,
  });
}

function createLocalTaskInterruptError(
  code: LocalTaskInterruptErrorCode,
  message: string
): Error {
  return Object.assign(new Error(message), {
    code,
  });
}

function isProcessAlive(killProcess: KillProcess, processId: number): boolean {
  try {
    killProcess(processId, 0);
    return true;
  } catch (error) {
    return !(
      isNoSuchProcessError(error) ||
      isUnsignalableExitedProcessGroup(error, processId)
    );
  }
}

function isUnsignalableExitedProcessGroup(
  error: unknown,
  processId: number
): boolean {
  // Darwin returns EPERM for a same-user isolated group whose only remaining
  // member is an already-exited leader waiting to be reaped.
  return (
    processId < 0 &&
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "EPERM"
  );
}

function isNoSuchProcessError(error: unknown): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}
