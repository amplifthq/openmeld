import { AGENT_PROFILE_WORK_CONCURRENCY_LIMIT } from "@openmeld/agent-runtime";
import {
  createLocalExecutionSlots,
  type LocalExecutionSlots,
} from "@openmeld/local-service";
import type { Presenter } from "../../runtime/presenter/types";
import { emitRunLine } from "../core/logger";
import type { DaemonDispatchLimits } from "../core/types";

export function createDaemonLocalExecutionSlots(input: {
  limits: DaemonDispatchLimits;
  presenter: Presenter;
}): LocalExecutionSlots {
  return createLocalExecutionSlots({
    limits: {
      ...input.limits,
      contextConcurrency: AGENT_PROFILE_WORK_CONCURRENCY_LIMIT,
    },
    onTaskDropped: (event) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_execution_slot_dropped",
        text: `local execution slot dropped pending task ${event.taskId} for ${event.targetLabel}: ${event.reason}`,
        payload: {
          adapterId: event.adapterId,
          activeForLane: event.activeForLane,
          activeGlobal: event.activeGlobal,
          controllerKey: event.controllerKey,
          dispatchId: event.dispatchId,
          globalConcurrency: event.limits.globalConcurrency,
          localExecutionLaneKey: event.localExecutionLaneKey,
          profileId: event.profileId,
          queueDepth: event.queueDepth,
          localQueueStatus: event.localQueue.status,
          localQueueWaitReason: event.localQueue.waitReason,
          queuePosition: event.localQueue.queuePosition,
          queueMax: event.limits.queueMax,
          reason: event.reason,
          spaceId: event.spaceId,
          step: "dropped",
          taskId: event.taskId,
          targetLabel: event.targetLabel,
          transportMode: event.transportMode,
        },
      });
    },
    onTaskStarted: (event) => {
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_execution_slot_reserved",
        text: `local execution slot reserved task ${event.taskId} for ${event.targetLabel}`,
        payload: {
          adapterId: event.adapterId,
          activeForLane: event.activeForLane,
          activeGlobal: event.activeGlobal,
          controllerKey: event.controllerKey,
          dispatchId: event.dispatchId,
          durationMs: null,
          errorCode: null,
          globalConcurrency: event.limits.globalConcurrency,
          localExecutionLaneKey: event.localExecutionLaneKey,
          profileId: event.profileId,
          queueDepth: event.queueDepth,
          localQueueStatus: event.localQueue.status,
          localQueueWaitReason: event.localQueue.waitReason,
          queuePosition: event.localQueue.queuePosition,
          queueMax: event.limits.queueMax,
          result: null,
          spaceId: event.spaceId,
          step: "started",
          taskId: event.taskId,
          targetLabel: event.targetLabel,
          transportMode: event.transportMode,
        },
      });
    },
    onTaskCompleted: (event) => {
      let completionText = `local execution slot failed task ${event.taskId} for ${event.targetLabel}`;
      if (event.result === "success") {
        completionText = `local execution slot completed task ${event.taskId} for ${event.targetLabel}`;
      } else if (event.result === "partial_success") {
        completionText = `local execution slot partially completed task ${event.taskId} for ${event.targetLabel}`;
      }
      emitRunLine({
        presenter: input.presenter,
        code: "daemon.run.local_execution_slot_completed",
        text: completionText,
        payload: {
          adapterId: event.adapterId,
          activeForLane: event.activeForLane,
          activeGlobal: event.activeGlobal,
          controllerKey: event.controllerKey,
          dispatchId: event.dispatchId,
          durationMs: event.durationMs,
          errorCode: event.errorCode,
          ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
          globalConcurrency: event.limits.globalConcurrency,
          localExecutionLaneKey: event.localExecutionLaneKey,
          profileId: event.profileId,
          queueDepth: event.queueDepth,
          localQueueStatus: event.localQueue.status,
          localQueueWaitReason: event.localQueue.waitReason,
          queuePosition: event.localQueue.queuePosition,
          queueMax: event.limits.queueMax,
          result: event.result,
          spaceId: event.spaceId,
          step: "completed",
          taskId: event.taskId,
          targetLabel: event.targetLabel,
          transportMode: event.transportMode,
        },
      });
    },
  });
}
