import assert from "node:assert/strict";
import test from "node:test";

import { createLocalExecutionSlots } from "../dist/index.js";

function createDeferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      resolvePromise();
    },
  };
}

function buildTask(overrides) {
  return {
    adapterId: "codex",
    attemptId: overrides.attemptId,
    controllerKey: "builtin:codex",
    dispatchId: overrides.dispatchId,
    localExecutionLaneKey: overrides.localExecutionLaneKey,
    profileId: overrides.profileId,
    run: overrides.run,
    spaceId: "space-a",
    targetLabel: "@codex",
    taskId: overrides.taskId,
    transportMode: "local-cli",
  };
}

test("local execution slots enforce global concurrency", async () => {
  const startedTaskIds = [];
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

  queue.request(
    buildTask({
      attemptId: "attempt-a",
      dispatchId: "dispatch-a",
      localExecutionLaneKey: "profile:agent-a",
      profileId: "agent-a",
      run: async () => {
        await taskA.promise;
      },
      taskId: "task-a",
    })
  );
  queue.request(
    buildTask({
      attemptId: "attempt-b",
      dispatchId: "dispatch-b",
      localExecutionLaneKey: "profile:agent-b",
      profileId: "agent-b",
      run: async () => {
        await taskB.promise;
      },
      taskId: "task-b",
    })
  );
  queue.request(
    buildTask({
      attemptId: "attempt-c",
      dispatchId: "dispatch-c",
      localExecutionLaneKey: "profile:agent-c",
      profileId: "agent-c",
      run: async () => {
        await taskC.promise;
      },
      taskId: "task-c",
    })
  );

  assert.deepEqual(startedTaskIds, ["task-a", "task-b"]);

  taskA.resolve();
  taskB.resolve();
  taskC.resolve();
  await queue.drain();

  assert.deepEqual(startedTaskIds, ["task-a", "task-b", "task-c"]);
});

test("local execution slots run one task per execution lane", async () => {
  const startedTaskIds = [];
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

  queue.request(
    buildTask({
      attemptId: "attempt-a",
      dispatchId: "dispatch-a",
      localExecutionLaneKey: "profile:shared-agent",
      profileId: "shared-agent",
      run: async () => {
        await taskA.promise;
      },
      taskId: "task-a",
    })
  );
  queue.request(
    buildTask({
      attemptId: "attempt-b",
      dispatchId: "dispatch-b",
      localExecutionLaneKey: "profile:shared-agent",
      profileId: "shared-agent",
      run: async () => {
        await taskB.promise;
      },
      taskId: "task-b",
    })
  );

  assert.deepEqual(startedTaskIds, ["task-a"]);

  taskA.resolve();
  taskB.resolve();
  await queue.drain();

  assert.deepEqual(startedTaskIds, ["task-a", "task-b"]);
});

test("local execution slots report started work and fail a task whose pre-run hook throws", async () => {
  const runningAtHook = [];
  const runTaskIds = [];
  const completed = [];
  const queue = createLocalExecutionSlots({
    onChanged: () => {
      if (completed.length > 0) {
        throw new Error("receipt unavailable after release");
      }
    },
    limits: { globalConcurrency: 1, queueMax: 10 },
    beforeTaskRun: (task) => {
      runningAtHook.push([task.taskId, queue.getRunningWork().taskIds]);
      if (task.taskId === "task-b") {
        throw new Error("receipt unavailable");
      }
    },
    onTaskCompleted: (event) => {
      completed.push([event.taskId, event.result]);
    },
  });
  const taskA = createDeferred();
  const refused = [];
  for (const taskId of ["task-a", "task-b"]) {
    queue.request({
      ...buildTask({
        attemptId: `attempt-${taskId}`,
        dispatchId: `dispatch-${taskId}`,
        localExecutionLaneKey: `profile:${taskId}`,
        profileId: taskId,
        run: async () => {
          runTaskIds.push(taskId);
          if (taskId === "task-a") {
            await taskA.promise;
          }
        },
        taskId,
      }),
      // The task owner reports the refusal through its own result channel.
      onRunRefused: (error) => {
        refused.push([taskId, error.message]);
      },
    });
  }

  // A queued task has not begun work yet.
  assert.deepEqual(queue.getRunningWork(), {
    adapterOperationIds: [],
    taskIds: ["task-a"],
  });
  taskA.resolve();
  await queue.drain();

  assert.deepEqual(runningAtHook, [
    ["task-a", ["task-a"]],
    ["task-b", ["task-b"]],
  ]);
  assert.deepEqual(runTaskIds, ["task-a"]);
  assert.deepEqual(refused, [["task-b", "receipt unavailable"]]);
  assert.deepEqual(completed.at(-1), ["task-b", "failed"]);
  assert.deepEqual(queue.getRunningWork(), {
    adapterOperationIds: [],
    taskIds: [],
  });
});

test("local execution slots include adapter maintenance in quiescence and draining", async () => {
  const queue = createLocalExecutionSlots({
    limits: { globalConcurrency: 1, queueMax: 10 },
  });
  const operation = createDeferred();
  const selected = queue.runAdapterOperationIfIdle("codex", async () => {
    await operation.promise;
    return "selected";
  });
  assert.deepEqual(queue.getDrainState(), { activeGlobal: 0, pendingCount: 0 });
  assert.equal(queue.isQuiescent(), false);
  assert.deepEqual(queue.getRunningWork(), {
    adapterOperationIds: ["codex"],
    taskIds: [],
  });
  queue.beginDrain();
  let drained = false;
  const drain = queue.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  operation.resolve();
  assert.deepEqual(await selected, { accepted: true, value: "selected" });
  await drain;
  assert.equal(queue.isQuiescent(), true);
});

test("local execution slots stop accepting new work while controlled shutdown drains accepted work", async () => {
  const startedTaskIds = [];
  const queue = createLocalExecutionSlots({
    limits: {
      globalConcurrency: 1,
      queueMax: 10,
    },
    onTaskStarted: (event) => {
      startedTaskIds.push(event.taskId);
    },
  });
  const activeTask = createDeferred();

  const accepted = queue.request(
    buildTask({
      attemptId: "attempt-active",
      dispatchId: "dispatch-active",
      localExecutionLaneKey: "profile:active-agent",
      profileId: "active-agent",
      run: async () => {
        await activeTask.promise;
      },
      taskId: "task-active",
    })
  );
  assert.equal(accepted.accepted, true);

  queue.beginDrain();

  const rejected = queue.request(
    buildTask({
      attemptId: "attempt-new",
      dispatchId: "dispatch-new",
      localExecutionLaneKey: "profile:new-agent",
      profileId: "new-agent",
      run: async () => undefined,
      taskId: "task-new",
    })
  );
  assert.deepEqual(rejected, {
    accepted: false,
    reason: "service.draining",
    snapshot: {
      activeForLane: 0,
      activeGlobal: 1,
      limits: {
        globalConcurrency: 1,
        queueMax: 10,
      },
      queueDepth: 0,
    },
  });

  let drained = false;
  const drainPromise = queue.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);

  activeTask.resolve();
  await drainPromise;

  assert.deepEqual(startedTaskIds, ["task-active"]);
});
