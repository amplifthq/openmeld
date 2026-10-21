import { sep } from "node:path";

const LOCAL_EXECUTION_LANE_CONCURRENCY_LIMIT = 1;

/**
 * The local files one task may touch, for coordinating OpenMeld-launched work.
 *
 * `private` work uses only a Service-owned root of its own Execution Context
 * (a Space-only scratch folder or an isolated copy), so it never overlaps other
 * work. `shared` work uses user folders: readers overlap freely, and a writer
 * excludes every reader and writer with an overlapping root. `roots` are every
 * canonical root the task shares with other work, such as the Git checkout of
 * its folder and that checkout's Git metadata. `null` roots are unknown and
 * overlap every shared root. `legacy` marks pre-Context work, which local
 * lanes already serialize per Profile, so two legacy tasks never conflict here.
 * These claims coordinate OpenMeld's own work; they are not a sandbox.
 */
export type LocalExecutionResourceClaim =
  | { kind: "private" }
  | {
      kind: "shared";
      access: "read" | "write";
      legacy?: true;
      roots: readonly string[] | null;
    };

const UNRESOLVED_LEGACY_CLAIM: LocalExecutionResourceClaim = {
  kind: "shared",
  access: "write",
  legacy: true,
  roots: null,
};

function rootsOverlap(left: string, right: string): boolean {
  const normalize = (root: string) =>
    process.platform === "win32" ? root.toLowerCase() : root;
  const isWithin = (child: string, parent: string) =>
    child === parent ||
    child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
  const a = normalize(left);
  const b = normalize(right);
  return isWithin(a, b) || isWithin(b, a);
}

function sharedRootsOverlap(
  left: readonly string[] | null,
  right: readonly string[] | null
): boolean {
  if (left === null || right === null) {
    return true;
  }
  return left.some((leftRoot) =>
    right.some((rightRoot) => rootsOverlap(leftRoot, rightRoot))
  );
}

function isExecutionContextClaim(
  claim: LocalExecutionResourceClaim | undefined
): boolean {
  return claim !== undefined && !(claim.kind === "shared" && claim.legacy);
}

function resourcesConflict(
  leftClaim: LocalExecutionResourceClaim | undefined,
  rightClaim: LocalExecutionResourceClaim | undefined
): boolean {
  const left = leftClaim ?? UNRESOLVED_LEGACY_CLAIM;
  const right = rightClaim ?? UNRESOLVED_LEGACY_CLAIM;
  if (left.kind === "private" || right.kind === "private") {
    return false;
  }
  if (
    (left.legacy && right.legacy) ||
    (left.access === "read" && right.access === "read") ||
    isSharedFolder(left, right)
  ) {
    return false;
  }
  return sharedRootsOverlap(left.roots, right.roots);
}

/**
 * Two direct-edit Execution Context tasks with the same known roots share the
 * folder and both run (design-plans/member-agent-program.md §4.9); the later
 * one is told about the other (`shared_folder`). Legacy work, unknown roots and
 * nested or partly overlapping roots keep the exclusive writer rule.
 */
function isSharedFolder(
  leftClaim: LocalExecutionResourceClaim | undefined,
  rightClaim: LocalExecutionResourceClaim | undefined
): boolean {
  if (
    leftClaim?.kind !== "shared" ||
    rightClaim?.kind !== "shared" ||
    leftClaim.legacy ||
    rightClaim.legacy ||
    leftClaim.access !== "write" ||
    rightClaim.access !== "write" ||
    leftClaim.roots === null ||
    rightClaim.roots === null
  ) {
    return false;
  }
  const left = [...leftClaim.roots].sort();
  const right = [...rightClaim.roots].sort();
  return (
    left.length === right.length &&
    left.every((root, index) => root === right[index])
  );
}

export type LocalServiceDispatchLimits = {
  contextConcurrency?: number;
  globalConcurrency: number;
  queueMax: number;
};

export type LocalExecutionSlotTask = {
  /** Absent for pre-Context work whose folder is not known yet. */
  resourceClaim?: LocalExecutionResourceClaim;
  /** The Execution Context (Session) this task runs, when it has one. */
  executionContextId?: string | null;
  /** Owner-safe folder name for diagnostics text; never a path. */
  folderLabel?: string;
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
  | "workspace_conflict"
  | "agent_profile_concurrency"
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
  folderLabel: string | null;
  queuePosition: number | null;
  status: "queued" | "starting_runtime";
  waitReason: LocalExecutionSlotWaitReason;
};

/** Another direct-edit Session that was already running in the same folder. */
export type LocalExecutionSlotSharedFolderSession = {
  executionContextId: string | null;
  profileId: string;
  spaceId: string | null;
  targetLabel: string;
  taskId: string;
};

export type LocalExecutionSlotLifecycleEvent = LocalExecutionSlotSnapshot & {
  adapterId: string | null;
  attemptId: string;
  controllerKey: string;
  dispatchId: string;
  localExecutionLaneKey: string;
  localQueue: LocalExecutionSlotDiagnostics;
  profileId: string;
  /** Set when the task started: earlier direct-edit Sessions in its folder. */
  sharedFolderSessions: LocalExecutionSlotSharedFolderSession[];
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
  // Observe ownership after mutation, including release. Completion events are
  // emitted while the task still owns its slot and cannot prove quiescence.
  onChanged?: () => void;
  onTaskCompleted?: (event: LocalExecutionSlotCompletionEvent) => void;
  onTaskDropped?: (event: LocalExecutionSlotDropEvent) => void;
  onTaskQueued?: (event: LocalExecutionSlotLifecycleEvent) => void;
  onTaskStarted?: (event: LocalExecutionSlotLifecycleEvent) => void;
}) {
  const pendingTasks: Array<{
    stopQueuedLifecycle: (() => void) | null;
    task: LocalExecutionSlotTask;
  }> = [];
  const activeCountByAdapterId = new Map<string, number>();
  const activeCountByLaneKey = new Map<string, number>();
  const activeCountByProfileId = new Map<string, number>();
  const activeTasks = new Map<
    string,
    {
      sharedFolderSessions: LocalExecutionSlotSharedFolderSession[];
      task: LocalExecutionSlotTask;
    }
  >();
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

  // An older pending task keeps its place ahead of younger work that touches
  // the same files, so a writer cannot be bypassed indefinitely by readers or
  // other writers arriving after it.
  const conflictsWithOlderPendingWork = (
    task: LocalExecutionSlotTask
  ): boolean => {
    for (const pending of pendingTasks) {
      if (pending.task === task) {
        return false;
      }
      if (resourcesConflict(pending.task.resourceClaim, task.resourceClaim)) {
        return true;
      }
    }
    return false;
  };

  const resolveWaitReason = (
    task: LocalExecutionSlotTask
  ): LocalExecutionSlotWaitReason => {
    if (task.adapterId && adapterOperationIds.has(task.adapterId)) {
      return "agent_controller_maintenance";
    }
    if (activeGlobal >= input.limits.globalConcurrency) {
      return "global_concurrency";
    }
    if (
      isExecutionContextClaim(task.resourceClaim) &&
      (activeCountByProfileId.get(task.profileId) ?? 0) >=
        (input.limits.contextConcurrency ?? 0)
    ) {
      return "agent_profile_concurrency";
    }
    if (
      [...activeTasks.values()].some((active) =>
        resourcesConflict(active.task.resourceClaim, task.resourceClaim)
      ) ||
      conflictsWithOlderPendingWork(task)
    ) {
      return "workspace_conflict";
    }
    if (
      resolveActiveForLane(task.localExecutionLaneKey) >=
      LOCAL_EXECUTION_LANE_CONCURRENCY_LIMIT
    ) {
      return "local_execution_lane_concurrency";
    }
    return "none";
  };

  const buildLocalQueueDiagnostics = (
    task: LocalExecutionSlotTask,
    inputDiagnostics: {
      queuePosition: number | null;
      status?: "queued" | "starting_runtime";
      waitReason?: LocalExecutionSlotWaitReason;
    }
  ): LocalExecutionSlotDiagnostics => {
    const waitReason = inputDiagnostics.waitReason ?? resolveWaitReason(task);
    const status =
      inputDiagnostics.status ??
      (waitReason === "none" ? "starting_runtime" : "queued");
    return {
      ...buildSnapshot(task.localExecutionLaneKey),
      folderLabel: task.folderLabel ?? null,
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
      localQueue: buildLocalQueueDiagnostics(task, {
        queuePosition: inputEvent.queuePosition,
        status: inputEvent.status,
        waitReason: inputEvent.waitReason,
      }),
      profileId: task.profileId,
      sharedFolderSessions:
        activeTasks.get(task.taskId)?.task === task
          ? (activeTasks.get(task.taskId)?.sharedFolderSessions ?? [])
          : [],
      spaceId: task.spaceId,
      taskId: task.taskId,
      targetLabel: task.targetLabel,
      transportMode: task.transportMode,
      ...buildSnapshot(task.localExecutionLaneKey),
    };
  };

  const resolveSharedFolderSessions = (
    task: LocalExecutionSlotTask
  ): LocalExecutionSlotSharedFolderSession[] =>
    [...activeTasks.values()]
      .filter((active) =>
        isSharedFolder(active.task.resourceClaim, task.resourceClaim)
      )
      .map(({ task: active }) => ({
        executionContextId: active.executionContextId ?? null,
        profileId: active.profileId,
        spaceId: active.spaceId,
        targetLabel: active.targetLabel,
        taskId: active.taskId,
      }));

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

  const isQuiescent = (): boolean =>
    pendingTasks.length === 0 &&
    activeGlobal === 0 &&
    adapterOperationIds.size === 0;

  const notifyDrainWaitersIfIdle = (): void => {
    if (!isQuiescent()) {
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
      const nextTaskIndex = pendingTasks.findIndex(
        (candidate) => resolveWaitReason(candidate.task) === "none"
      );
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
      activeTasks.set(selectedTask.taskId, {
        sharedFolderSessions: resolveSharedFolderSessions(selectedTask),
        task: selectedTask,
      });
      activeCountByProfileId.set(
        selectedTask.profileId,
        (activeCountByProfileId.get(selectedTask.profileId) ?? 0) + 1
      );
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
          if (activeTasks.get(selectedTask.taskId)?.task === selectedTask) {
            activeTasks.delete(selectedTask.taskId);
          }
          activeCountByProfileId.set(
            selectedTask.profileId,
            Math.max(
              0,
              (activeCountByProfileId.get(selectedTask.profileId) ?? 0) - 1
            )
          );
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
          input.onChanged?.();
          notifyDrainWaitersIfIdle();
          pump();
        });
    }
  };

  return {
    /**
     * Direct-edit Sessions that were already running in this task's folder
     * when it started. Empty for a task that is not running.
     */
    getSharedFolderSessions(
      taskId: string
    ): LocalExecutionSlotSharedFolderSession[] {
      return activeTasks.get(taskId)?.sharedFolderSessions ?? [];
    },
    isQuiescent,
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
        input.onChanged?.();
        return {
          accepted: true,
          value: await operation(),
        };
      } finally {
        adapterOperationIds.delete(adapterId);
        input.onChanged?.();
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
      input.onChanged?.();
      const snapshot = buildSnapshot(task.localExecutionLaneKey);
      input.onTaskQueued?.(
        buildTaskLifecycleEvent(task, {
          queuePosition: pendingTasks.indexOf(pendingTask) + 1,
        })
      );
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
          input.onChanged?.();
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
      input.onChanged?.();
      notifyDrainWaitersIfIdle();
      return {
        droppedCount,
      };
    },
    drain(): Promise<void> {
      if (isQuiescent()) {
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

/**
 * Plain text for what a queued task waits for, for local diagnostics. It names
 * the folder by its owner-safe label, never by path.
 */
export function describeLocalExecutionSlotWait(
  diagnostics: LocalExecutionSlotDiagnostics
): string {
  const folder = diagnostics.folderLabel
    ? ` in ${diagnostics.folderLabel}`
    : "";
  switch (diagnostics.waitReason) {
    case "workspace_conflict":
      return `waiting for another task that uses the folder${folder}`;
    case "agent_profile_concurrency":
      return `waiting for one of this Agent's ${diagnostics.limits.contextConcurrency ?? 0} running tasks to finish${folder}`;
    case "global_concurrency":
      return `waiting for one of this computer's ${diagnostics.limits.globalConcurrency} running tasks to finish${folder}`;
    case "local_execution_lane_concurrency":
      return `waiting for the previous turn of this conversation to finish${folder}`;
    case "agent_controller_maintenance":
      return `waiting for Agent controller maintenance to finish${folder}`;
    default:
      return `starting${folder}`;
  }
}
