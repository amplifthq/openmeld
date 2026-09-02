const LOCAL_EXECUTION_LANE_CONCURRENCY_LIMIT = 1;

export type LocalServiceDispatchLimits = {
  globalConcurrency: number;
  queueMax: number;
};

export type LocalExecutionSlotTask = {
  adapterId: string | null;
  attemptId: string;
  controllerKey: string;
  dispatchId: string;
  executionTokenRunId?: string | null;
  localExecutionLaneKey: string;
  onQueued?: (
    event: LocalExecutionSlotLifecycleEvent
  ) => undefined | (() => void);
  profileId: string;
  runtimeCoordinatorExecutionId?: string | null;
  spaceId: string | null;
  targetLabel: string;
  run: () => Promise<LocalExecutionSlotTaskResult | undefined>;
  taskId: string;
  transportMode: string | null;
};

export type LocalExecutionSlotTaskResult = {
  errorCode?: string | null;
  errorMessage?: string | null;
  result?: "failed" | "partial_success" | "success";
};

export type LocalExecutionSlotSnapshot = {
  activeForLane: number;
  activeGlobal: number;
  limits: LocalServiceDispatchLimits;
  queueDepth: number;
};

export type LocalExecutionSlotWaitReason =
  | "agent_controller_maintenance"
  | "global_concurrency"
  | "local_execution_lane_concurrency"
  | "none";

export type LocalExecutionSlotAdapterOperationStatus =
  | "available"
  | "blocked_by_work"
  | "operation_in_progress";

export type LocalExecutionSlotAdapterOperationResult<T> =
  | {
      accepted: true;
      value: T;
    }
  | {
      accepted: false;
      status: Exclude<LocalExecutionSlotAdapterOperationStatus, "available">;
    };

export type LocalExecutionSlotDiagnostics = LocalExecutionSlotSnapshot & {
  queuePosition: number | null;
  status: "queued" | "starting_runtime";
  waitReason: LocalExecutionSlotWaitReason;
};

export type LocalExecutionSlotLifecycleEvent = LocalExecutionSlotSnapshot & {
  adapterId: string | null;
  attemptId: string;
  controllerKey: string;
  dispatchId: string;
  localExecutionLaneKey: string;
  localQueue: LocalExecutionSlotDiagnostics;
  profileId: string;
  spaceId: string | null;
  taskId: string;
  targetLabel: string;
  transportMode: string | null;
};

export type LocalExecutionSlotCompletionEvent =
  LocalExecutionSlotLifecycleEvent & {
    durationMs: number;
    errorCode: string | null;
    errorMessage: string | null;
    result: "failed" | "partial_success" | "success";
  };

export type LocalExecutionSlotDropEvent = LocalExecutionSlotLifecycleEvent & {
  reason: string;
};

export type LocalExecutionSlotRequestResult =
  | {
      accepted: true;
      deduped: boolean;
      snapshot: LocalExecutionSlotSnapshot;
    }
  | {
      accepted: false;
      reason: "queue.full" | "service.draining";
      snapshot: LocalExecutionSlotSnapshot;
    }
  | {
      accepted: false;
      activeOwner: {
        attemptId: string;
        dispatchId: string;
        executionTokenRunId: string | null;
        runtimeCoordinatorExecutionId: string | null;
        taskId: string;
      };
      reason: "task.owner_conflict";
      snapshot: LocalExecutionSlotSnapshot;
    };

export type LocalExecutionSlots = ReturnType<typeof createLocalExecutionSlots>;

export function createLocalExecutionSlots(input: {
  limits: LocalServiceDispatchLimits;
  onTaskCompleted?: (event: LocalExecutionSlotCompletionEvent) => void;
  onTaskDropped?: (event: LocalExecutionSlotDropEvent) => void;
  onTaskStarted?: (event: LocalExecutionSlotLifecycleEvent) => void;
}) {
  const pendingTasks: Array<{
    stopQueuedLifecycle: (() => void) | null;
    task: LocalExecutionSlotTask;
  }> = [];
  const activeCountByAdapterId = new Map<string, number>();
  const activeCountByLaneKey = new Map<string, number>();
  const adapterOperationIds = new Set<string>();
  const ownedAttemptKeys = new Set<string>();
  const ownedTaskIds = new Map<
    string,
    {
      attemptId: string;
      dispatchId: string;
      executionTokenRunId: string | null;
      runtimeCoordinatorExecutionId: string | null;
      taskId: string;
    }
  >();
  const drainWaiters: Array<() => void> = [];
  let activeGlobal = 0;
  let acceptingNewTasks = true;

  const resolveActiveForLane = (localExecutionLaneKey: string): number => {
    return activeCountByLaneKey.get(localExecutionLaneKey) ?? 0;
  };

  const resolveAdapterOperationStatus = (
    adapterId: string
  ): LocalExecutionSlotAdapterOperationStatus => {
    if (adapterOperationIds.has(adapterId)) {
      return "operation_in_progress";
    }
    if (
      (activeCountByAdapterId.get(adapterId) ?? 0) > 0 ||
      pendingTasks.some((candidate) => candidate.task.adapterId === adapterId)
    ) {
      return "blocked_by_work";
    }
    return "available";
  };

  const buildSnapshot = (
    localExecutionLaneKey: string
  ): LocalExecutionSlotSnapshot => {
    return {
      activeForLane: resolveActiveForLane(localExecutionLaneKey),
      activeGlobal,
      limits: input.limits,
      queueDepth: pendingTasks.length,
    };
  };

  const resolveWaitReason = (inputWait: {
    adapterId: string | null;
    localExecutionLaneKey: string;
  }): LocalExecutionSlotWaitReason => {
    if (inputWait.adapterId && adapterOperationIds.has(inputWait.adapterId)) {
      return "agent_controller_maintenance";
    }
    if (activeGlobal >= input.limits.globalConcurrency) {
      return "global_concurrency";
    }
    if (
      resolveActiveForLane(inputWait.localExecutionLaneKey) >=
      LOCAL_EXECUTION_LANE_CONCURRENCY_LIMIT
    ) {
      return "local_execution_lane_concurrency";
    }
    return "none";
  };

  const buildLocalQueueDiagnostics = (inputDiagnostics: {
    adapterId: string | null;
    localExecutionLaneKey: string;
    queuePosition: number | null;
    status?: "queued" | "starting_runtime";
    waitReason?: LocalExecutionSlotWaitReason;
  }): LocalExecutionSlotDiagnostics => {
    const waitReason =
      inputDiagnostics.waitReason ??
      resolveWaitReason({
        adapterId: inputDiagnostics.adapterId,
        localExecutionLaneKey: inputDiagnostics.localExecutionLaneKey,
      });
    const status =
      inputDiagnostics.status ??
      (waitReason === "none" ? "starting_runtime" : "queued");
    return {
      ...buildSnapshot(inputDiagnostics.localExecutionLaneKey),
      queuePosition:
        status === "queued" ? inputDiagnostics.queuePosition : null,
      status,
      waitReason,
    };
  };

  const buildTaskLifecycleEvent = (
    task: LocalExecutionSlotTask,
    inputEvent: {
      queuePosition: number | null;
      status?: "queued" | "starting_runtime";
      waitReason?: LocalExecutionSlotWaitReason;
    }
  ): LocalExecutionSlotLifecycleEvent => {
    return {
      adapterId: task.adapterId,
      attemptId: task.attemptId,
      controllerKey: task.controllerKey,
      dispatchId: task.dispatchId,
      localExecutionLaneKey: task.localExecutionLaneKey,
      localQueue: buildLocalQueueDiagnostics({
        adapterId: task.adapterId,
        localExecutionLaneKey: task.localExecutionLaneKey,
        queuePosition: inputEvent.queuePosition,
        status: inputEvent.status,
        waitReason: inputEvent.waitReason,
      }),
      profileId: task.profileId,
      spaceId: task.spaceId,
      taskId: task.taskId,
      targetLabel: task.targetLabel,
      transportMode: task.transportMode,
      ...buildSnapshot(task.localExecutionLaneKey),
    };
  };

  const buildTaskOwnerSnapshot = (owner: {
    attemptId: string;
    dispatchId: string;
    executionTokenRunId: string | null;
    runtimeCoordinatorExecutionId: string | null;
    taskId: string;
  }): {
    attemptId: string;
    dispatchId: string;
    executionTokenRunId: string | null;
    runtimeCoordinatorExecutionId: string | null;
    taskId: string;
  } => {
    return {
      attemptId: owner.attemptId,
      dispatchId: owner.dispatchId,
      executionTokenRunId: owner.executionTokenRunId,
      runtimeCoordinatorExecutionId: owner.runtimeCoordinatorExecutionId,
      taskId: owner.taskId,
    };
  };

  const clearQueuedLifecycle = (pendingTask: {
    stopQueuedLifecycle: (() => void) | null;
  }): void => {
    pendingTask.stopQueuedLifecycle?.();
    pendingTask.stopQueuedLifecycle = null;
  };

  const releaseTaskOwnership = (task: {
    attemptId: string;
    dispatchId: string;
    profileId: string;
    taskId: string;
  }): void => {
    ownedAttemptKeys.delete(buildAttemptKey(task.dispatchId, task.attemptId));
    const activeOwner = ownedTaskIds.get(task.taskId);
    if (
      activeOwner &&
      activeOwner.attemptId === task.attemptId &&
      activeOwner.dispatchId === task.dispatchId
    ) {
      ownedTaskIds.delete(task.taskId);
    }
  };

  const notifyDrainWaitersIfIdle = (): void => {
    if (
      pendingTasks.length > 0 ||
      activeGlobal > 0 ||
      adapterOperationIds.size > 0
    ) {
      return;
    }
    while (drainWaiters.length > 0) {
      const waiter = drainWaiters.shift();
      waiter?.();
    }
  };

  const pump = (): void => {
    while (activeGlobal < input.limits.globalConcurrency) {
      // OPENMELD_LOCAL_EXECUTION_SLOT: HIGHEST_FACT lane-serial-local-execution
      // One local execution lane owns at most one active execution on this
      // service. A lane is the bound Agent Controller conversation when present;
      // otherwise it falls back to the Agent Profile identity.
      const nextTaskIndex = pendingTasks.findIndex((candidate) => {
        return (
          !(
            candidate.task.adapterId &&
            adapterOperationIds.has(candidate.task.adapterId)
          ) &&
          resolveActiveForLane(candidate.task.localExecutionLaneKey) <
            LOCAL_EXECUTION_LANE_CONCURRENCY_LIMIT
        );
      });
      if (nextTaskIndex < 0) {
        break;
      }
      const selectedPendingTask = pendingTasks.splice(nextTaskIndex, 1)[0];
      if (!selectedPendingTask) {
        continue;
      }
      clearQueuedLifecycle(selectedPendingTask);
      const selectedTask = selectedPendingTask.task;

      activeGlobal += 1;
      if (selectedTask.adapterId) {
        activeCountByAdapterId.set(
          selectedTask.adapterId,
          (activeCountByAdapterId.get(selectedTask.adapterId) ?? 0) + 1
        );
      }
      activeCountByLaneKey.set(
        selectedTask.localExecutionLaneKey,
        resolveActiveForLane(selectedTask.localExecutionLaneKey) + 1
      );

      const startedEvent = buildTaskLifecycleEvent(selectedTask, {
        queuePosition: null,
        status: "starting_runtime",
        waitReason: "none",
      });
      input.onTaskStarted?.(startedEvent);
      const startedAtMs = Date.now();

      Promise.resolve()
        .then(async () => {
          const runResult = await selectedTask.run();
          const completionResult = resolveTaskCompletionResult(runResult);
          input.onTaskCompleted?.({
            ...buildTaskLifecycleEvent(selectedTask, {
              queuePosition: null,
              status: "starting_runtime",
              waitReason: "none",
            }),
            durationMs: Math.max(0, Date.now() - startedAtMs),
            errorCode: completionResult.errorCode,
            errorMessage: completionResult.errorMessage,
            result: completionResult.result,
          });
        })
        .catch((error) => {
          input.onTaskCompleted?.({
            ...buildTaskLifecycleEvent(selectedTask, {
              queuePosition: null,
              status: "starting_runtime",
              waitReason: "none",
            }),
            durationMs: Math.max(0, Date.now() - startedAtMs),
            errorCode: null,
            errorMessage: toErrorMessage(error),
            result: "failed",
          });
        })
        .finally(() => {
          releaseTaskOwnership(selectedTask);
          activeGlobal = Math.max(0, activeGlobal - 1);
          if (selectedTask.adapterId) {
            const remainingActiveForAdapter = Math.max(
              0,
              (activeCountByAdapterId.get(selectedTask.adapterId) ?? 0) - 1
            );
            if (remainingActiveForAdapter === 0) {
              activeCountByAdapterId.delete(selectedTask.adapterId);
            } else {
              activeCountByAdapterId.set(
                selectedTask.adapterId,
                remainingActiveForAdapter
              );
            }
          }
          const remainingActiveForLane = Math.max(
            0,
            resolveActiveForLane(selectedTask.localExecutionLaneKey) - 1
          );
          if (remainingActiveForLane === 0) {
            activeCountByLaneKey.delete(selectedTask.localExecutionLaneKey);
          } else {
            activeCountByLaneKey.set(
              selectedTask.localExecutionLaneKey,
              remainingActiveForLane
            );
          }
          notifyDrainWaitersIfIdle();
          pump();
        });
    }
  };

  return {
    getAdapterOperationStatus(
      adapterId: string
    ): LocalExecutionSlotAdapterOperationStatus {
      return resolveAdapterOperationStatus(adapterId);
    },
    async runAdapterOperationIfIdle<T>(
      adapterId: string,
      operation: () => Promise<T>
    ): Promise<LocalExecutionSlotAdapterOperationResult<T>> {
      const status = resolveAdapterOperationStatus(adapterId);
      if (status !== "available") {
        return {
          accepted: false,
          status,
        };
      }
      adapterOperationIds.add(adapterId);
      try {
        return {
          accepted: true,
          value: await operation(),
        };
      } finally {
        adapterOperationIds.delete(adapterId);
        notifyDrainWaitersIfIdle();
        pump();
      }
    },
    request(task: LocalExecutionSlotTask): LocalExecutionSlotRequestResult {
      const attemptKey = buildAttemptKey(task.dispatchId, task.attemptId);
      if (ownedAttemptKeys.has(attemptKey)) {
        return {
          accepted: true,
          deduped: true,
          snapshot: buildSnapshot(task.localExecutionLaneKey),
        };
      }

      if (!acceptingNewTasks) {
        return {
          accepted: false,
          reason: "service.draining",
          snapshot: buildSnapshot(task.localExecutionLaneKey),
        };
      }

      const activeOwner = ownedTaskIds.get(task.taskId);
      if (activeOwner) {
        return {
          accepted: false,
          activeOwner: buildTaskOwnerSnapshot(activeOwner),
          reason: "task.owner_conflict",
          snapshot: buildSnapshot(task.localExecutionLaneKey),
        };
      }

      if (pendingTasks.length >= input.limits.queueMax) {
        return {
          accepted: false,
          reason: "queue.full",
          snapshot: buildSnapshot(task.localExecutionLaneKey),
        };
      }

      ownedAttemptKeys.add(attemptKey);
      ownedTaskIds.set(task.taskId, {
        attemptId: task.attemptId,
        dispatchId: task.dispatchId,
        executionTokenRunId: task.executionTokenRunId ?? null,
        runtimeCoordinatorExecutionId:
          task.runtimeCoordinatorExecutionId ?? null,
        taskId: task.taskId,
      });
      const pendingTask: (typeof pendingTasks)[number] = {
        stopQueuedLifecycle: null,
        task,
      };
      pendingTasks.push(pendingTask);
      const snapshot = buildSnapshot(task.localExecutionLaneKey);
      if (task.onQueued) {
        try {
          const queuePosition = pendingTasks.indexOf(pendingTask) + 1;
          const stopQueuedLifecycle = task.onQueued(
            buildTaskLifecycleEvent(task, {
              queuePosition,
            })
          );
          pendingTask.stopQueuedLifecycle =
            typeof stopQueuedLifecycle === "function"
              ? stopQueuedLifecycle
              : null;
        } catch (error) {
          pendingTasks.pop();
          releaseTaskOwnership(task);
          throw error;
        }
      }
      pump();
      return {
        accepted: true,
        deduped: false,
        snapshot,
      };
    },
    beginDrain(): { ownedAttemptKeys: string[] } {
      acceptingNewTasks = false;
      return {
        ownedAttemptKeys: [...ownedAttemptKeys],
      };
    },
    dropPendingTasks(inputDrop?: {
      reason?: string;
      shouldDrop?: (task: LocalExecutionSlotTask) => boolean;
    }): {
      droppedCount: number;
    } {
      const reason = toPendingDropReason(inputDrop?.reason);
      const shouldDrop = inputDrop?.shouldDrop ?? (() => true);
      let droppedCount = 0;
      for (let index = pendingTasks.length - 1; index >= 0; index -= 1) {
        const pendingTask = pendingTasks[index];
        if (!(pendingTask && shouldDrop(pendingTask.task))) {
          continue;
        }
        pendingTasks.splice(index, 1);
        clearQueuedLifecycle(pendingTask);
        releaseTaskOwnership(pendingTask.task);
        droppedCount += 1;
        input.onTaskDropped?.({
          ...buildTaskLifecycleEvent(pendingTask.task, {
            queuePosition: null,
            status: "queued",
          }),
          reason,
        });
      }
      notifyDrainWaitersIfIdle();
      return {
        droppedCount,
      };
    },
    drain(): Promise<void> {
      if (
        pendingTasks.length === 0 &&
        activeGlobal === 0 &&
        adapterOperationIds.size === 0
      ) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        drainWaiters.push(resolve);
      });
    },
    getDrainState(): {
      activeGlobal: number;
      pendingCount: number;
    } {
      return {
        activeGlobal,
        pendingCount: pendingTasks.length,
      };
    },
    getSnapshot(localExecutionLaneKey: string): LocalExecutionSlotSnapshot {
      return buildSnapshot(localExecutionLaneKey);
    },
  };
}

function buildAttemptKey(dispatchId: string, attemptId: string): string {
  return `${dispatchId}::${attemptId}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "unknown error";
}

function resolveTaskCompletionResult(
  result: LocalExecutionSlotTaskResult | undefined
): {
  errorCode: string | null;
  errorMessage: string | null;
  result: "failed" | "partial_success" | "success";
} {
  if (!result || typeof result !== "object") {
    return {
      errorCode: null,
      errorMessage: null,
      result: "success",
    };
  }

  const normalizedResult =
    result.result === "failed" ||
    result.result === "partial_success" ||
    result.result === "success"
      ? result.result
      : "success";
  const errorCode = toOptionalText(result.errorCode);
  const errorMessage = toOptionalText(result.errorMessage);

  return {
    errorCode,
    errorMessage,
    result: normalizedResult,
  };
}

function toOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toPendingDropReason(value: unknown): string {
  if (typeof value !== "string") {
    return "queue.drop";
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "queue.drop";
}
