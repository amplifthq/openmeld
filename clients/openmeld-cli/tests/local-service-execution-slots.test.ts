import { AGENT_PROFILE_WORK_CONCURRENCY_LIMIT } from "@openmeld/agent-runtime";
import {
  createLocalExecutionSlots,
  type LocalExecutionSlotDropEvent,
} from "@openmeld/local-service";
import { describe, expect, it, vi } from "vitest";

type LocalExecutionSlots = ReturnType<typeof createLocalExecutionSlots>;
type LocalExecutionSlotTaskInput = Omit<
  Parameters<LocalExecutionSlots["request"]>[0],
  "localExecutionLaneKey"
> & {
  localExecutionLaneKey?: string;
};

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}

function requestTask(
  queue: LocalExecutionSlots,
  task: LocalExecutionSlotTaskInput
) {
  return queue.request({
    ...task,
    localExecutionLaneKey:
      task.localExecutionLaneKey ?? `agent-profile:${task.profileId}`,
  });
}

describe("local execution slots", () => {
  it("runs three independent contexts, holds their slots until native completion, and queues conflicting local work", async () => {
    const started: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 8,
        contextConcurrency: AGENT_PROFILE_WORK_CONCURRENCY_LIMIT,
        queueMax: 50,
      },
      onTaskStarted: (event) => {
        started.push(event.taskId);
      },
    });
    const completions = [
      createDeferred(),
      createDeferred(),
      createDeferred(),
      createDeferred(),
      createDeferred(),
    ] as const;
    for (const [index, completion] of completions.entries()) {
      requestTask(queue, {
        adapterId: "codex",
        controllerKey: "builtin:codex",
        dispatchId: `dispatch-${index}`,
        attemptId: `attempt-${index}`,
        profileId: "profile-1",
        spaceId: "space-1",
        taskId: `task-${index}`,
        targetLabel: "@agent",
        transportMode: "codex-app-server",
        localExecutionLaneKey: `context-${index}`,
        resourceScope: index === 4 ? "exclusive" : "isolated",
        run: async () => {
          await completion.promise;
          return undefined;
        },
      });
    }
    expect(started).toEqual(["task-0", "task-1", "task-2"]);
    completions[1].resolve();
    await vi.waitFor(() =>
      expect(started).toEqual(["task-0", "task-1", "task-2", "task-3"])
    );
    completions[0].resolve();
    completions[2].resolve();
    await Promise.resolve();
    expect(started).not.toContain("task-4");
    completions[3].resolve();
    await vi.waitFor(() => expect(started).toContain("task-4"));
    completions[4].resolve();
    await queue.drain();
  });
  it("runs an agent controller operation only while that adapter is idle", async () => {
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 2,
        queueMax: 10,
      },
    });
    const activeTask = createDeferred();
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-active",
      attemptId: "attempt-active",
      profileId: "profile-active",
      spaceId: "space-active",
      taskId: "task-active",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => {
        await activeTask.promise;
        return undefined;
      },
    });

    expect(queue.getAdapterOperationStatus("codex")).toBe("blocked_by_work");
    expect(
      await queue.runAdapterOperationIfIdle("codex", async () => "changed")
    ).toEqual({ accepted: false, status: "blocked_by_work" });
    expect(
      await queue.runAdapterOperationIfIdle(
        "claude-code",
        async () => "changed"
      )
    ).toEqual({ accepted: true, value: "changed" });

    activeTask.resolve();
    await queue.drain();
    expect(queue.getAdapterOperationStatus("codex")).toBe("available");
  });

  it("queues new work behind an in-progress agent controller operation", async () => {
    const startedTaskIds: string[] = [];
    const queuedEvents: Array<{ status: string; waitReason: string }> = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 2,
        queueMax: 10,
      },
      onTaskStarted: (event) => {
        startedTaskIds.push(event.taskId);
      },
    });
    const operation = createDeferred();
    const task = createDeferred();
    const operationPromise = queue.runAdapterOperationIfIdle(
      "codex",
      async () => {
        await operation.promise;
        return "changed";
      }
    );

    expect(queue.getAdapterOperationStatus("codex")).toBe(
      "operation_in_progress"
    );
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-queued",
      attemptId: "attempt-queued",
      onQueued: (event) => {
        queuedEvents.push({
          status: event.localQueue.status,
          waitReason: event.localQueue.waitReason,
        });
        return undefined;
      },
      profileId: "profile-queued",
      spaceId: "space-queued",
      taskId: "task-queued",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => {
        await task.promise;
        return undefined;
      },
    });

    expect(startedTaskIds).toEqual([]);
    expect(queuedEvents).toEqual([
      {
        status: "queued",
        waitReason: "agent_controller_maintenance",
      },
    ]);
    operation.resolve();
    expect(await operationPromise).toEqual({
      accepted: true,
      value: "changed",
    });
    await Promise.resolve();
    expect(startedTaskIds).toEqual(["task-queued"]);

    task.resolve();
    await queue.drain();
  });

  it("waits for an in-progress agent controller operation during drain", async () => {
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
    });
    const operation = createDeferred();
    const operationPromise = queue.runAdapterOperationIfIdle(
      "codex",
      async () => {
        await operation.promise;
        return undefined;
      }
    );
    let drained = false;
    const drainPromise = queue.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    operation.resolve();
    await operationPromise;
    await drainPromise;
    expect(drained).toBe(true);
  });

  it("blocks an agent controller operation when matching work is queued", async () => {
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
    });
    const otherTask = createDeferred();
    const queuedTask = createDeferred();
    requestTask(queue, {
      adapterId: "claude-code",
      controllerKey: "builtin:claude-code",
      dispatchId: "dispatch-active",
      attemptId: "attempt-active",
      profileId: "profile-active",
      spaceId: "space-active",
      taskId: "task-active",
      targetLabel: "@claude",
      transportMode: "local-cli",
      run: async () => {
        await otherTask.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-queued",
      attemptId: "attempt-queued",
      profileId: "profile-queued",
      spaceId: "space-queued",
      taskId: "task-queued",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => {
        await queuedTask.promise;
        return undefined;
      },
    });

    expect(queue.getAdapterOperationStatus("codex")).toBe("blocked_by_work");
    expect(
      await queue.runAdapterOperationIfIdle("codex", async () => "changed")
    ).toEqual({ accepted: false, status: "blocked_by_work" });

    otherTask.resolve();
    await Promise.resolve();
    queuedTask.resolve();
    await queue.drain();
  });

  it("enforces globalConcurrency", async () => {
    const startedTaskIds: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 2,
        queueMax: 10,
      },
      onTaskStarted: (event) => {
        startedTaskIds.push(event.taskId);
      },
    });
    const taskA = createDeferred();
    const taskB = createDeferred();
    const taskC = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-a",
      dispatchId: "dispatch-a",
      attemptId: "attempt-a",
      profileId: "profile-a",
      spaceId: "space-a",
      taskId: "task-a",
      targetLabel: "@codex-a",
      transportMode: "local-cli",
      run: async () => {
        await taskA.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-b",
      dispatchId: "dispatch-b",
      attemptId: "attempt-b",
      profileId: "profile-b",
      spaceId: "space-b",
      taskId: "task-b",
      targetLabel: "@codex-b",
      transportMode: "local-cli",
      run: async () => {
        await taskB.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-c",
      dispatchId: "dispatch-c",
      attemptId: "attempt-c",
      profileId: "profile-c",
      spaceId: "space-c",
      taskId: "task-c",
      targetLabel: "@codex-c",
      transportMode: "local-cli",
      run: async () => {
        await taskC.promise;
        return undefined;
      },
    });

    expect(startedTaskIds).toEqual(["task-a", "task-b"]);

    taskA.resolve();
    taskB.resolve();
    taskC.resolve();
    await queue.drain();
    expect(startedTaskIds).toEqual(["task-a", "task-b", "task-c"]);
  });

  it("enforces one active local execution per default profile lane as FIFO", async () => {
    const startedTaskIds: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 3,
        queueMax: 10,
      },
      onTaskStarted: (event) => {
        startedTaskIds.push(event.taskId);
      },
    });
    const taskA = createDeferred();
    const taskB = createDeferred();
    const taskC = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-a",
      attemptId: "attempt-a",
      profileId: "profile-shared",
      spaceId: "space-shared",
      taskId: "task-a",
      targetLabel: "@shared",
      transportMode: "local-cli",
      run: async () => {
        await taskA.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-b",
      attemptId: "attempt-b",
      profileId: "profile-shared",
      spaceId: "space-shared",
      taskId: "task-b",
      targetLabel: "@shared",
      transportMode: "local-cli",
      run: async () => {
        await taskB.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-c",
      attemptId: "attempt-c",
      profileId: "profile-shared",
      spaceId: "space-shared",
      taskId: "task-c",
      targetLabel: "@shared",
      transportMode: "local-cli",
      run: async () => {
        await taskC.promise;
        return undefined;
      },
    });

    expect(startedTaskIds).toEqual(["task-a"]);

    taskA.resolve();
    taskB.resolve();
    taskC.resolve();
    await queue.drain();
    expect(startedTaskIds).toEqual(["task-a", "task-b", "task-c"]);
  });

  it("allows different profiles to run concurrently across controllers", async () => {
    const startedTaskIds: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 3,
        queueMax: 10,
      },
      onTaskStarted: (event) => {
        startedTaskIds.push(event.taskId);
      },
    });
    const taskA = createDeferred();
    const taskB = createDeferred();
    const taskC = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-a",
      attemptId: "attempt-a",
      profileId: "profile-a",
      spaceId: "space-a",
      taskId: "task-a",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => {
        await taskA.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "claude",
      controllerKey: "builtin:claude-code",
      dispatchId: "dispatch-b",
      attemptId: "attempt-b",
      profileId: "profile-b",
      spaceId: "space-b",
      taskId: "task-b",
      targetLabel: "@claude",
      transportMode: "local-cli",
      run: async () => {
        await taskB.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "openclaw",
      controllerKey: "builtin:openclaw",
      dispatchId: "dispatch-c",
      attemptId: "attempt-c",
      profileId: "profile-c",
      spaceId: "space-c",
      taskId: "task-c",
      targetLabel: "@openclaw",
      transportMode: "local-cli",
      run: async () => {
        await taskC.promise;
        return undefined;
      },
    });

    expect(startedTaskIds).toEqual(["task-a", "task-b", "task-c"]);

    taskA.resolve();
    taskB.resolve();
    taskC.resolve();
    await queue.drain();
  });

  it("allows different profiles to run concurrently on the same controller", async () => {
    const startedTaskIds: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 3,
        queueMax: 10,
      },
      onTaskStarted: (event) => {
        startedTaskIds.push(event.taskId);
      },
    });
    const taskA = createDeferred();
    const taskB = createDeferred();
    const taskC = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-a",
      attemptId: "attempt-a",
      profileId: "profile-a",
      spaceId: "space-a",
      taskId: "task-a",
      targetLabel: "@codex-a",
      transportMode: "local-cli",
      run: async () => {
        await taskA.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-b",
      attemptId: "attempt-b",
      profileId: "profile-b",
      spaceId: "space-b",
      taskId: "task-b",
      targetLabel: "@codex-b",
      transportMode: "local-cli",
      run: async () => {
        await taskB.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "claude",
      controllerKey: "builtin:claude-code",
      dispatchId: "dispatch-c",
      attemptId: "attempt-c",
      profileId: "profile-c",
      spaceId: "space-c",
      taskId: "task-c",
      targetLabel: "@claude",
      transportMode: "local-cli",
      run: async () => {
        await taskC.promise;
        return undefined;
      },
    });

    expect(startedTaskIds).toEqual(["task-a", "task-b", "task-c"]);

    taskA.resolve();
    taskB.resolve();
    taskC.resolve();
    await queue.drain();
  });

  it("enforces one active local execution per shared agent controller conversation lane", async () => {
    const startedTaskIds: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 3,
        queueMax: 10,
      },
      onTaskStarted: (event) => {
        startedTaskIds.push(event.taskId);
      },
    });
    const taskA = createDeferred();
    const taskB = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-a",
      attemptId: "attempt-a",
      localExecutionLaneKey:
        "agent-controller-conversation:builtin:codex:thread-shared",
      profileId: "profile-a",
      spaceId: "space-a",
      taskId: "task-a",
      targetLabel: "@codex-a",
      transportMode: "local-cli",
      run: async () => {
        await taskA.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-b",
      attemptId: "attempt-b",
      localExecutionLaneKey:
        "agent-controller-conversation:builtin:codex:thread-shared",
      profileId: "profile-b",
      spaceId: "space-b",
      taskId: "task-b",
      targetLabel: "@codex-b",
      transportMode: "local-cli",
      run: async () => {
        await taskB.promise;
        return undefined;
      },
    });

    expect(startedTaskIds).toEqual(["task-a"]);

    taskA.resolve();
    taskB.resolve();
    await queue.drain();
    expect(startedTaskIds).toEqual(["task-a", "task-b"]);
  });

  it("reports local execution lane concurrency as the accepted_local local queue reason", async () => {
    const queuedEvents: Array<{
      queuePosition: number | null;
      status: string;
      waitReason: string;
    }> = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 3,
        queueMax: 10,
      },
    });
    const taskA = createDeferred();
    const taskB = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-a",
      attemptId: "attempt-a",
      profileId: "profile-shared",
      spaceId: "space-a",
      taskId: "task-a",
      targetLabel: "@shared",
      transportMode: "local-cli",
      run: async () => {
        await taskA.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-b",
      attemptId: "attempt-b",
      onQueued: (event) => {
        queuedEvents.push({
          queuePosition: event.localQueue.queuePosition,
          status: event.localQueue.status,
          waitReason: event.localQueue.waitReason,
        });
        return undefined;
      },
      profileId: "profile-shared",
      spaceId: "space-b",
      taskId: "task-b",
      targetLabel: "@shared",
      transportMode: "local-cli",
      run: async () => {
        await taskB.promise;
        return undefined;
      },
    });

    expect(queuedEvents).toEqual([
      {
        queuePosition: 1,
        status: "queued",
        waitReason: "local_execution_lane_concurrency",
      },
    ]);

    taskA.resolve();
    taskB.resolve();
    await queue.drain();
  });

  it("rejects new tasks when pending queue reaches queueMax", async () => {
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 1,
      },
    });
    const taskA = createDeferred();
    const taskB = createDeferred();

    const acceptedFirst = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-a",
      dispatchId: "dispatch-a",
      attemptId: "attempt-a",
      profileId: "profile-a",
      spaceId: "space-a",
      taskId: "task-a",
      targetLabel: "@codex-a",
      transportMode: "local-cli",
      run: async () => {
        await taskA.promise;
        return undefined;
      },
    });
    const acceptedSecond = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-b",
      dispatchId: "dispatch-b",
      attemptId: "attempt-b",
      profileId: "profile-b",
      spaceId: "space-b",
      taskId: "task-b",
      targetLabel: "@codex-b",
      transportMode: "local-cli",
      run: async () => {
        await taskB.promise;
        return undefined;
      },
    });
    const rejectedThird = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-c",
      dispatchId: "dispatch-c",
      attemptId: "attempt-c",
      profileId: "profile-c",
      spaceId: "space-c",
      taskId: "task-c",
      targetLabel: "@codex-c",
      transportMode: "local-cli",
      run: () => Promise.resolve(undefined),
    });

    expect(acceptedFirst.accepted).toBe(true);
    expect(acceptedSecond.accepted).toBe(true);
    expect(rejectedThird.accepted).toBe(false);
    if (!rejectedThird.accepted) {
      expect(rejectedThird.reason).toBe("queue.full");
      expect(rejectedThird.snapshot.queueDepth).toBe(1);
    }

    taskA.resolve();
    await Promise.resolve();
    taskB.resolve();
    await queue.drain();
  });

  it("drain waits until all running and pending tasks finish", async () => {
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
    });
    const taskA = createDeferred();
    const taskB = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-a",
      dispatchId: "dispatch-a",
      attemptId: "attempt-a",
      profileId: "profile-a",
      spaceId: "space-a",
      taskId: "task-a",
      targetLabel: "@codex-a",
      transportMode: "local-cli",
      run: async () => {
        await taskA.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-b",
      dispatchId: "dispatch-b",
      attemptId: "attempt-b",
      profileId: "profile-b",
      spaceId: "space-b",
      taskId: "task-b",
      targetLabel: "@codex-b",
      transportMode: "local-cli",
      run: async () => {
        await taskB.promise;
        return undefined;
      },
    });

    let drainResolved = false;
    const draining = queue.drain().then(() => {
      drainResolved = true;
    });

    await Promise.resolve();
    expect(drainResolved).toBe(false);

    taskA.resolve();
    await Promise.resolve();
    expect(drainResolved).toBe(false);

    taskB.resolve();
    await draining;
    expect(drainResolved).toBe(true);
  });

  it("rejects new work after controlled drain begins while finishing accepted work", async () => {
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
    });
    const activeTask = createDeferred();
    const accepted = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-accepted",
      attemptId: "attempt-accepted",
      profileId: "profile-accepted",
      spaceId: "space-accepted",
      taskId: "task-accepted",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => {
        await activeTask.promise;
        return undefined;
      },
    });
    expect(accepted.accepted).toBe(true);

    expect(queue.beginDrain()).toEqual({
      ownedAttemptKeys: ["dispatch-accepted::attempt-accepted"],
    });
    const rejected = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-rejected",
      attemptId: "attempt-rejected",
      profileId: "profile-rejected",
      spaceId: "space-rejected",
      taskId: "task-rejected",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => undefined,
    });
    expect(rejected).toMatchObject({
      accepted: false,
      reason: "service.draining",
    });

    let drained = false;
    const drainPromise = queue.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    activeTask.resolve();
    await drainPromise;
    expect(drained).toBe(true);
  });

  it("emits normalized completion metadata for queue observability", async () => {
    const completedEvents: Array<{
      adapterId: string | null;
      durationMs: number;
      errorCode: string | null;
      profileId: string;
      result: "failed" | "partial_success" | "success";
      spaceId: string | null;
      taskId: string;
      targetLabel: string;
      transportMode: string | null;
    }> = [];
    const startedEvents: Array<{
      profileId: string;
      spaceId: string | null;
      targetLabel: string;
      taskId: string;
    }> = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
      onTaskCompleted: (event) => {
        completedEvents.push({
          adapterId: event.adapterId,
          durationMs: event.durationMs,
          errorCode: event.errorCode,
          profileId: event.profileId,
          result: event.result,
          spaceId: event.spaceId,
          taskId: event.taskId,
          targetLabel: event.targetLabel,
          transportMode: event.transportMode,
        });
      },
      onTaskStarted: (event) => {
        startedEvents.push({
          profileId: event.profileId,
          spaceId: event.spaceId,
          targetLabel: event.targetLabel,
          taskId: event.taskId,
        });
      },
    });

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-observe",
      attemptId: "attempt-observe",
      profileId: "profile-observe",
      spaceId: "space-observe",
      taskId: "task-observe",
      targetLabel: "@observe",
      transportMode: "local-cli",
      run: async () => ({
        errorCode: "permission.denied.runtime",
        result: "partial_success",
      }),
    });

    await queue.drain();

    expect(startedEvents).toEqual([
      {
        profileId: "profile-observe",
        spaceId: "space-observe",
        targetLabel: "@observe",
        taskId: "task-observe",
      },
    ]);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toEqual({
      adapterId: "codex",
      durationMs: expect.any(Number),
      errorCode: "permission.denied.runtime",
      profileId: "profile-observe",
      result: "partial_success",
      spaceId: "space-observe",
      taskId: "task-observe",
      targetLabel: "@observe",
      transportMode: "local-cli",
    });
    expect(completedEvents[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a token-scoped conflict owner snapshot without stopping the active task", async () => {
    const completedTaskIds: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
      onTaskCompleted: (event) => {
        completedTaskIds.push(event.taskId);
      },
    });
    const activeTask = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-active",
      attemptId: "attempt-active",
      executionTokenRunId: "run-active",
      profileId: "profile-a",
      runtimeCoordinatorExecutionId: "rce-active",
      spaceId: "space-a",
      taskId: "task-shared",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => {
        await activeTask.promise;
        return undefined;
      },
    });

    const conflict = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-conflict",
      attemptId: "attempt-conflict",
      executionTokenRunId: "run-rejected",
      profileId: "profile-b",
      runtimeCoordinatorExecutionId: "rce-rejected",
      spaceId: "space-b",
      taskId: "task-shared",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => undefined,
    });

    expect(conflict).toMatchObject({
      accepted: false,
      reason: "task.owner_conflict",
    });
    if (conflict.accepted || conflict.reason !== "task.owner_conflict") {
      throw new Error("expected owner conflict");
    }
    expect(conflict.activeOwner).toEqual({
      attemptId: "attempt-active",
      dispatchId: "dispatch-active",
      executionTokenRunId: "run-active",
      runtimeCoordinatorExecutionId: "rce-active",
      taskId: "task-shared",
    });
    conflict.activeOwner.dispatchId = "mutated-dispatch-id";

    activeTask.resolve();
    await queue.drain();
    expect(completedTaskIds).toEqual(["task-shared"]);

    const retry = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-retry",
      attemptId: "attempt-retry",
      profileId: "profile-c",
      spaceId: "space-c",
      taskId: "task-shared",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => undefined,
    });

    expect(retry).toEqual({
      accepted: true,
      deduped: false,
      snapshot: expect.objectContaining({
        activeForLane: 0,
        activeGlobal: 0,
        queueDepth: 1,
      }),
    });
    await queue.drain();
  });

  it("dedupes the same active attempt without starting a second local run", async () => {
    let runCount = 0;
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
    });
    const activeTask = createDeferred();
    const first = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-active",
      attemptId: "attempt-active",
      executionTokenRunId: "run-active",
      profileId: "profile-a",
      runtimeCoordinatorExecutionId: "rce-active",
      spaceId: "space-a",
      taskId: "task-shared",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: async () => {
        runCount += 1;
        await activeTask.promise;
        return { result: "success" };
      },
    });
    const duplicate = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-active",
      attemptId: "attempt-active",
      executionTokenRunId: "run-active",
      profileId: "profile-a",
      runtimeCoordinatorExecutionId: "rce-active",
      spaceId: "space-a",
      taskId: "task-shared",
      targetLabel: "@codex",
      transportMode: "local-cli",
      run: () => {
        runCount += 1;
        return Promise.resolve({ result: "failed" });
      },
    });

    expect(first).toMatchObject({
      accepted: true,
      deduped: false,
    });
    expect(duplicate).toMatchObject({
      accepted: true,
      deduped: true,
    });

    activeTask.resolve();
    await queue.drain();
    expect(runCount).toBe(1);
  });

  it("stops queued task lifecycle cleanup when a pending task is dropped", async () => {
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
    });
    const activeTask = createDeferred();
    let queuedLifecycleStopped = 0;

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-a",
      dispatchId: "dispatch-active",
      attemptId: "attempt-active",
      onQueued: () => undefined,
      profileId: "profile-a",
      spaceId: "space-a",
      taskId: "task-active",
      targetLabel: "@codex-a",
      transportMode: "local-cli",
      run: async () => {
        await activeTask.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-b",
      dispatchId: "dispatch-pending",
      attemptId: "attempt-pending",
      onQueued: () => {
        return () => {
          queuedLifecycleStopped += 1;
        };
      },
      profileId: "profile-b",
      spaceId: "space-b",
      taskId: "task-pending",
      targetLabel: "@codex-b",
      transportMode: "local-cli",
      run: async () => undefined,
    });

    expect(
      queue.dropPendingTasks({
        reason: "daemon.session.unexpected_close",
      })
    ).toEqual({
      droppedCount: 1,
    });
    expect(queuedLifecycleStopped).toBe(1);

    const retry = requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex-b",
      dispatchId: "dispatch-retry",
      attemptId: "attempt-retry",
      onQueued: () => undefined,
      profileId: "profile-c",
      spaceId: "space-c",
      taskId: "task-pending",
      targetLabel: "@codex-b",
      transportMode: "local-cli",
      run: async () => undefined,
    });

    expect(retry.accepted).toBe(true);

    activeTask.resolve();
    await queue.drain();
  });

  it("reports dropped pending task diagnostics from the local execution lane", async () => {
    const droppedEvents: LocalExecutionSlotDropEvent[] = [];
    const sharedLaneKey =
      "agent-controller-conversation:builtin:codex:thread-shared";
    const queue = createLocalExecutionSlots({
      limits: {
        globalConcurrency: 2,
        queueMax: 10,
      },
      onTaskDropped: (event) => {
        droppedEvents.push(event);
      },
    });
    const activeTask = createDeferred();

    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-active",
      attemptId: "attempt-active",
      localExecutionLaneKey: sharedLaneKey,
      onQueued: () => undefined,
      profileId: "profile-active",
      spaceId: "space-active",
      taskId: "task-active",
      targetLabel: "@codex-active",
      transportMode: "local-cli",
      run: async () => {
        await activeTask.promise;
        return undefined;
      },
    });
    requestTask(queue, {
      adapterId: "codex",
      controllerKey: "builtin:codex",
      dispatchId: "dispatch-pending",
      attemptId: "attempt-pending",
      localExecutionLaneKey: sharedLaneKey,
      onQueued: () => undefined,
      profileId: "profile-pending",
      spaceId: "space-pending",
      taskId: "task-pending",
      targetLabel: "@codex-pending",
      transportMode: "local-cli",
      run: async () => undefined,
    });

    expect(
      queue.dropPendingTasks({
        reason: "daemon.session.unexpected_close",
      })
    ).toEqual({
      droppedCount: 1,
    });

    expect(droppedEvents).toHaveLength(1);
    expect(droppedEvents[0]).toMatchObject({
      activeForLane: 1,
      activeGlobal: 1,
      localExecutionLaneKey: sharedLaneKey,
      localQueue: expect.objectContaining({
        activeForLane: 1,
        activeGlobal: 1,
        queueDepth: 0,
        waitReason: "local_execution_lane_concurrency",
      }),
      profileId: "profile-pending",
      queueDepth: 0,
      reason: "daemon.session.unexpected_close",
      taskId: "task-pending",
    });

    activeTask.resolve();
    await queue.drain();
  });
});
