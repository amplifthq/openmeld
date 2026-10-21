import { AGENT_PROFILE_WORK_CONCURRENCY_LIMIT } from "@openmeld/agent-runtime";
import {
  createLocalExecutionSlots,
  describeLocalExecutionSlotWait,
  type LocalExecutionResourceClaim,
  type LocalExecutionSlotDiagnostics,
  type LocalExecutionSlotDropEvent,
  type LocalExecutionSlotLifecycleEvent,
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

const SHARED_REPO_WRITE: LocalExecutionResourceClaim = {
  kind: "shared",
  access: "write",
  roots: ["/work/repo"],
};

const UNKNOWN_FOLDER_WRITE: LocalExecutionResourceClaim = {
  kind: "shared",
  access: "write",
  roots: null,
};

describe("local execution slots", () => {
  it.each<{
    name: string;
    first: LocalExecutionResourceClaim | undefined;
    second: LocalExecutionResourceClaim | undefined;
    together: boolean;
  }>([
    {
      name: "a current-folder writer and Space-only work",
      first: SHARED_REPO_WRITE,
      second: { kind: "private" },
      together: true,
    },
    {
      name: "writers in unrelated folders",
      first: SHARED_REPO_WRITE,
      second: { kind: "shared", access: "write", roots: ["/work/other"] },
      together: true,
    },
    {
      name: "two Context writers in the same folder",
      first: SHARED_REPO_WRITE,
      second: SHARED_REPO_WRITE,
      together: true,
    },
    {
      name: "a writer and a writer in a nested folder",
      first: SHARED_REPO_WRITE,
      second: { kind: "shared", access: "write", roots: ["/work/repo/app"] },
      together: false,
    },
    {
      name: "a main checkout writer and a linked worktree writer",
      first: SHARED_REPO_WRITE,
      second: {
        kind: "shared",
        access: "write",
        roots: ["/work/repo-feature", "/work/repo/.git"],
      },
      together: false,
    },
    {
      name: "writers in two linked worktrees of one repository",
      first: {
        kind: "shared",
        access: "write",
        roots: ["/work/repo-a", "/work/repo/.git"],
      },
      second: {
        kind: "shared",
        access: "write",
        roots: ["/work/repo-b", "/work/repo/.git"],
      },
      together: false,
    },
    {
      name: "a writer and a reader of the same folder",
      first: SHARED_REPO_WRITE,
      second: { kind: "shared", access: "read", roots: ["/work/repo"] },
      together: false,
    },
    {
      name: "two readers of the same folder",
      first: { kind: "shared", access: "read", roots: ["/work/repo"] },
      second: { kind: "shared", access: "read", roots: ["/work/repo"] },
      together: true,
    },
    {
      name: "a writer whose folder is unknown and a reader elsewhere",
      first: { kind: "shared", access: "write", roots: null },
      second: { kind: "shared", access: "read", roots: ["/work/other"] },
      together: false,
    },
    {
      name: "two pre-Context Profiles in one folder",
      first: { ...SHARED_REPO_WRITE, legacy: true },
      second: { ...SHARED_REPO_WRITE, legacy: true },
      together: true,
    },
    {
      name: "pre-Context work and a Context writer in one folder",
      first: { ...SHARED_REPO_WRITE, legacy: true },
      second: SHARED_REPO_WRITE,
      together: false,
    },
    {
      name: "pre-Context work with no known folder and Space-only work",
      first: undefined,
      second: { kind: "private" },
      together: true,
    },
  ])("starts $name together: $together", async ({
    first,
    second,
    together,
  }) => {
    const started: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: { contextConcurrency: 5, globalConcurrency: 4, queueMax: 10 },
      onTaskStarted: (event) => started.push(event.taskId),
    });
    const completions = [createDeferred(), createDeferred()] as const;
    for (const [index, resourceClaim] of [first, second].entries()) {
      requestTask(queue, {
        adapterId: "codex",
        attemptId: `attempt-${index}`,
        controllerKey: "builtin:codex",
        dispatchId: `dispatch-${index}`,
        localExecutionLaneKey: `lane-${index}`,
        profileId: `profile-${index}`,
        ...(resourceClaim ? { resourceClaim } : {}),
        spaceId: "space-1",
        targetLabel: `@agent-${index}`,
        taskId: `task-${index}`,
        transportMode: "codex-app-server",
        run: async () => {
          await completions[index]?.promise;
          return undefined;
        },
      });
    }
    expect(started).toEqual(together ? ["task-0", "task-1"] : ["task-0"]);
    for (const completion of completions) {
      completion.resolve();
    }
    await queue.drain();
  });

  it("keeps a waiting writer ahead of later readers of the same folder", async () => {
    const started: string[] = [];
    const waits = new Map<string, string>();
    const queue = createLocalExecutionSlots({
      limits: { contextConcurrency: 5, globalConcurrency: 4, queueMax: 10 },
      onTaskStarted: (event) => started.push(event.taskId),
    });
    const completions = new Map<string, () => void>();
    const reader = {
      kind: "shared",
      access: "read",
      roots: ["/work/repo"],
    } as const;
    for (const [taskId, resourceClaim] of [
      ["reader-1", reader],
      ["writer", SHARED_REPO_WRITE],
      ["reader-2", reader],
    ] as const) {
      const completion = createDeferred();
      completions.set(taskId, completion.resolve);
      requestTask(queue, {
        adapterId: "codex",
        attemptId: `attempt-${taskId}`,
        controllerKey: "builtin:codex",
        dispatchId: `dispatch-${taskId}`,
        localExecutionLaneKey: `lane-${taskId}`,
        onQueued: (event) => {
          waits.set(taskId, event.localQueue.waitReason);
          return undefined;
        },
        profileId: `profile-${taskId}`,
        resourceClaim,
        spaceId: "space-1",
        targetLabel: `@${taskId}`,
        taskId,
        transportMode: "codex-app-server",
        run: async () => {
          await completion.promise;
          return undefined;
        },
      });
    }
    expect(started).toEqual(["reader-1"]);
    expect(waits.get("reader-2")).toBe("workspace_conflict");
    completions.get("reader-1")?.();
    await vi.waitFor(() => expect(started).toEqual(["reader-1", "writer"]));
    completions.get("writer")?.();
    await vi.waitFor(() =>
      expect(started).toEqual(["reader-1", "writer", "reader-2"])
    );
    completions.get("reader-2")?.();
    await queue.drain();
  });

  it("serializes current-folder writers across distinct Profile and Project work labels", async () => {
    const started: string[] = [];
    const waiting: string[] = [];
    const queue = createLocalExecutionSlots({
      limits: { contextConcurrency: 5, globalConcurrency: 2, queueMax: 10 },
      onTaskStarted: (event) => started.push(event.taskId),
    });
    const first = createDeferred();
    const second = createDeferred();
    for (const [index, completion] of [first, second].entries()) {
      requestTask(queue, {
        adapterId: "codex",
        attemptId: `attempt-${index}`,
        controllerKey: "builtin:codex",
        dispatchId: `dispatch-${index}`,
        localExecutionLaneKey: `project-context-${index}`,
        onQueued: (event) => {
          waiting.push(event.localQueue.waitReason);
          return undefined;
        },
        profileId: `profile-${index}`,
        resourceClaim: UNKNOWN_FOLDER_WRITE,
        spaceId: `space-${index}`,
        targetLabel: `@project-${index}`,
        taskId: `task-${index}`,
        transportMode: "codex-app-server",
        run: async () => {
          await completion.promise;
          return undefined;
        },
      });
    }
    await vi.waitFor(() => expect(started).toEqual(["task-0"]));
    await vi.waitFor(() => expect(waiting).toContain("workspace_conflict"));
    first.resolve();
    await vi.waitFor(() => expect(started).toEqual(["task-0", "task-1"]));
    second.resolve();
    await queue.drain();
  });

  it("runs five independent contexts, holds their slots until native completion, and queues conflicting local work", async () => {
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
        resourceClaim: index >= 5 ? UNKNOWN_FOLDER_WRITE : { kind: "private" },
        run: async () => {
          await completion.promise;
          return undefined;
        },
      });
    }
    expect(started).toEqual(["task-0", "task-1", "task-2", "task-3", "task-4"]);
    completions[1].resolve();
    await vi.waitFor(() =>
      expect(started).toEqual([
        "task-0",
        "task-1",
        "task-2",
        "task-3",
        "task-4",
        "task-5",
      ])
    );
    completions[0].resolve();
    completions[2].resolve();
    completions[3].resolve();
    completions[4].resolve();
    await Promise.resolve();
    expect(started).not.toContain("task-6");
    completions[5].resolve();
    await vi.waitFor(() => expect(started).toContain("task-6"));
    completions[6].resolve();
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

describe("folder-scoped local execution slots", () => {
  type Claim = Pick<LocalExecutionSlotTaskInput, "folderLabel"> & {
    resourceClaim?: LocalExecutionResourceClaim;
  };
  const write = (root: string) =>
    ({
      kind: "shared",
      access: "write",
      roots: [root],
    }) as const;
  const read = (root: string): LocalExecutionResourceClaim => ({
    kind: "shared",
    access: "read",
    roots: [root],
  });

  function startFolderTasks(claims: Claim[]) {
    const started: LocalExecutionSlotLifecycleEvent[] = [];
    const queued: LocalExecutionSlotDiagnostics[] = [];
    const queue = createLocalExecutionSlots({
      limits: { contextConcurrency: 5, globalConcurrency: 10, queueMax: 10 },
      onTaskQueued: (event) => {
        if (event.localQueue.status === "queued") {
          queued.push(event.localQueue);
        }
      },
      onTaskStarted: (event) => started.push(event),
    });
    const completions = claims.map(() => createDeferred());
    for (const [index, claim] of claims.entries()) {
      requestTask(queue, {
        ...claim,
        adapterId: "codex",
        attemptId: `attempt-${index}`,
        controllerKey: "builtin:codex",
        dispatchId: `dispatch-${index}`,
        executionContextId: `context-${index}`,
        localExecutionLaneKey: `context-${index}`,
        profileId: "profile-1",
        spaceId: `space-${index}`,
        targetLabel: `@agent-${index}`,
        taskId: `task-${index}`,
        transportMode: "codex-app-server",
        run: async () => {
          await completions[index]?.promise;
          return undefined;
        },
      });
    }
    const startedIds = () => started.map((event) => event.taskId);
    const finish = async () => {
      for (const completion of completions) {
        completion.resolve();
      }
      await queue.drain();
    };
    return { completions, finish, queue, queued, started, startedIds };
  }

  it("runs direct-edit tasks in different folders concurrently", async () => {
    const run = startFolderTasks([
      { resourceClaim: write("/work/a") },
      { resourceClaim: write("/work/b") },
      { resourceClaim: read("/work/c") },
      { resourceClaim: { kind: "private" } },
    ]);
    expect(run.startedIds()).toEqual(["task-0", "task-1", "task-2", "task-3"]);
    expect(run.started.every((e) => e.sharedFolderSessions.length === 0)).toBe(
      true
    );
    await run.finish();
  });

  it("runs two direct-edit tasks in one folder and tells the later one about the earlier", async () => {
    const run = startFolderTasks([
      { resourceClaim: write("/work/a") },
      { resourceClaim: write("/work/a") },
    ]);
    expect(run.startedIds()).toEqual(["task-0", "task-1"]);
    expect(run.started[0]?.sharedFolderSessions).toEqual([]);
    expect(run.started[1]?.sharedFolderSessions).toEqual([
      {
        executionContextId: "context-0",
        profileId: "profile-1",
        spaceId: "space-0",
        targetLabel: "@agent-0",
        taskId: "task-0",
      },
    ]);
    expect(run.queue.getSharedFolderSessions("task-1")).toEqual(
      run.started[1]?.sharedFolderSessions
    );
    expect(run.queue.getSharedFolderSessions("task-0")).toEqual([]);
    await run.finish();
    expect(run.queue.getSharedFolderSessions("task-1")).toEqual([]);
  });

  it("keeps reader versus writer and pre-Context conflicts inside one folder", async () => {
    const run = startFolderTasks([
      { resourceClaim: read("/work/a") },
      { resourceClaim: write("/work/a") },
      { resourceClaim: { ...write("/work/b"), legacy: true } },
      { resourceClaim: write("/work/b") },
    ]);
    expect(run.startedIds()).toEqual(["task-0", "task-2"]);
    expect(run.queued.map((q) => q.waitReason)).toEqual([
      "workspace_conflict",
      "workspace_conflict",
    ]);
    expect(run.started[1]?.sharedFolderSessions).toEqual([]);
    run.completions[0]?.resolve();
    run.completions[2]?.resolve();
    await vi.waitFor(() =>
      expect(run.startedIds()).toEqual(["task-0", "task-2", "task-1", "task-3"])
    );
    await run.finish();
  });

  it("keeps the machine-wide writer rule when a task's folder is unknown", async () => {
    const run = startFolderTasks([
      { resourceClaim: write("/work/a") },
      { resourceClaim: UNKNOWN_FOLDER_WRITE },
      { resourceClaim: { kind: "private" } },
    ]);
    expect(run.startedIds()).toEqual(["task-0", "task-2"]);
    expect(run.started[0]?.sharedFolderSessions).toEqual([]);
    run.completions[0]?.resolve();
    await vi.waitFor(() =>
      expect(run.startedIds()).toEqual(["task-0", "task-2", "task-1"])
    );
    expect(run.started[2]?.sharedFolderSessions).toEqual([]);
    await run.finish();
  });

  it("says what a queued task waits for, naming the folder by label only", async () => {
    const run = startFolderTasks([
      { folderLabel: "folder f_1", resourceClaim: write("/work/a") },
      { folderLabel: "folder f_1", resourceClaim: read("/work/a") },
    ]);
    const waiting = run.queued[0];
    expect(waiting).toMatchObject({
      folderLabel: "folder f_1",
      status: "queued",
      waitReason: "workspace_conflict",
    });
    expect(waiting && describeLocalExecutionSlotWait(waiting)).toBe(
      "waiting for another task that uses the folder in folder f_1"
    );
    await run.finish();
  });
});
