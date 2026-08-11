import assert from "node:assert/strict";
import test from "node:test";

import {
  createInflightTaskControlRegistry,
  createLocalTaskInterruptSender,
} from "../dist/index.js";

test("local Stop signals the whole isolated runtime process group", async () => {
  const killCalls = [];
  const registry = createInflightTaskControlRegistry();
  registry.registerTask({
    adapterId: "codex",
    dispatchId: "dispatch-process-group",
    taskId: "task-process-group",
  });
  registry.updateTaskProcess({
    processId: 43_210,
    signalTarget: "process_group",
    taskId: "task-process-group",
  });
  const sendInterrupt = createLocalTaskInterruptSender({
    killProcess: (processId, signal) => {
      killCalls.push({ processId, signal });
      return true;
    },
    listDescendantProcessIds: () => [43_211, 43_212],
    registry,
  });

  await sendInterrupt({
    mode: "graceful",
    reason: "user stopped Wake",
    taskId: "task-process-group",
  });

  assert.deepEqual(killCalls, [
    { processId: -43_210, signal: 0 },
    { processId: -43_210, signal: "SIGTERM" },
    { processId: 43_211, signal: "SIGTERM" },
    { processId: 43_212, signal: "SIGTERM" },
  ]);
});

test("local Stop treats an exited Darwin process group as no longer running", async () => {
  const registry = createInflightTaskControlRegistry();
  registry.registerTask({
    adapterId: "claude-code",
    dispatchId: "dispatch-exited-group",
    taskId: "task-exited-group",
  });
  registry.updateTaskProcess({
    processId: 54_321,
    signalTarget: "process_group",
    taskId: "task-exited-group",
  });
  const sendInterrupt = createLocalTaskInterruptSender({
    killProcess: () => {
      throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    },
    registry,
  });

  await assert.rejects(
    async () =>
      sendInterrupt({
        mode: "graceful",
        reason: "user stopped Wake",
        taskId: "task-exited-group",
      }),
    (error) => error.code === "task.not_running"
  );
  assert.equal(registry.getTask("task-exited-group").processId, null);
});

test("local Stop force escalation retains detached descendants after the leader exits", async () => {
  const killCalls = [];
  let processGroupAlive = true;
  const registry = createInflightTaskControlRegistry();
  registry.registerTask({
    adapterId: "codex",
    dispatchId: "dispatch-escalated-tree",
    taskId: "task-escalated-tree",
  });
  registry.updateTaskProcess({
    processId: 65_000,
    signalTarget: "process_group",
    taskId: "task-escalated-tree",
  });
  const sendInterrupt = createLocalTaskInterruptSender({
    killProcess: (processId, signal) => {
      killCalls.push({ processId, signal });
      if (processId === -65_000 && !processGroupAlive) {
        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      }
      return true;
    },
    listDescendantProcessIds: () => [65_100],
    registry,
  });

  await sendInterrupt({
    mode: "graceful",
    reason: "user interrupted Wake",
    taskId: "task-escalated-tree",
  });
  processGroupAlive = false;
  registry.updateTaskProcess({
    processId: null,
    taskId: "task-escalated-tree",
  });
  await sendInterrupt({
    mode: "force",
    reason: "grace period elapsed",
    taskId: "task-escalated-tree",
  });

  assert.deepEqual(killCalls.slice(-3), [
    { processId: -65_000, signal: 0 },
    { processId: -65_000, signal: "SIGKILL" },
    { processId: 65_100, signal: "SIGKILL" },
  ]);
});
