import type { AdapterRuntimeEvent } from "@openmeld/adapter-core";
import type { InflightTaskControlRegistry } from "./inflight-task-control-registry.js";

export function syncRuntimeEventToInflightTaskControlRegistry(input: {
  event: AdapterRuntimeEvent;
  registry: InflightTaskControlRegistry;
  taskId: string;
}): {
  processId: number | null;
  taskId: string;
  updated: boolean;
} {
  if (input.event.phase === "process_exit") {
    const record = input.registry.updateTaskProcess({
      processId: null,
      signalTarget: null,
      taskId: input.taskId,
    });
    return {
      processId: null,
      taskId: input.taskId,
      updated: record !== null,
    };
  }

  if (!("processId" in input.event)) {
    return {
      processId: null,
      taskId: input.taskId,
      updated: false,
    };
  }

  const processId = input.event.processId;
  if (
    typeof processId === "number" &&
    Number.isInteger(processId) &&
    processId > 0
  ) {
    const record = input.registry.updateTaskProcess({
      processId,
      ...(input.event.phase === "process_spawned"
        ? { signalTarget: input.event.signalTarget }
        : {}),
      taskId: input.taskId,
    });
    return {
      processId,
      taskId: input.taskId,
      updated: record !== null,
    };
  }

  return {
    processId: null,
    taskId: input.taskId,
    updated: false,
  };
}
