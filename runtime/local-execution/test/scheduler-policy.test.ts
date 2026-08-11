import { describe, expect, it } from "vitest";
import {
  INITIAL_SCHEDULER_STATE,
  type SchedulerTask,
  selectNextTask,
  simulateSchedulerDispatch,
} from "../src/scheduler-policy";

const BASE_TIME_MS = Date.UTC(2026, 1, 25, 12, 0, 0);

const buildTask = (overrides: Partial<SchedulerTask>): SchedulerTask => ({
  taskId: overrides.taskId ?? "task-default",
  bindingKey: overrides.bindingKey ?? "binding-default",
  sequence: overrides.sequence ?? 1,
  priority: overrides.priority ?? "P1",
  enqueuedAtMs: overrides.enqueuedAtMs ?? BASE_TIME_MS,
});

describe("scheduler policy", () => {
  it("prioritizes P0 before non-system priorities", () => {
    const selected = selectNextTask({
      pendingTasks: [
        buildTask({
          taskId: "task-p2",
          bindingKey: "binding-a",
          priority: "P2",
          sequence: 1,
        }),
        buildTask({
          taskId: "task-p0",
          bindingKey: "binding-system",
          priority: "P0",
          sequence: 1,
        }),
      ],
      nowMs: BASE_TIME_MS,
      state: INITIAL_SCHEDULER_STATE,
    });

    expect(selected?.task.taskId).toBe("task-p0");
    expect(selected?.effectivePriority).toBe("P0");
  });

  it("keeps same-binding dispatch in FIFO order", () => {
    const simulation = simulateSchedulerDispatch({
      pendingTasks: [
        buildTask({
          taskId: "task-a-2",
          bindingKey: "binding-a",
          sequence: 2,
          priority: "P1",
        }),
        buildTask({
          taskId: "task-a-1",
          bindingKey: "binding-a",
          sequence: 1,
          priority: "P1",
        }),
        buildTask({
          taskId: "task-b-1",
          bindingKey: "binding-b",
          sequence: 1,
          priority: "P1",
        }),
      ],
      nowMs: BASE_TIME_MS,
    });

    const order = simulation.dispatches.map((dispatch) => dispatch.task.taskId);
    expect(order.indexOf("task-a-1")).toBeLessThan(order.indexOf("task-a-2"));
  });

  it("follows weighted fairness cycle P1:P2:P3 = 2:1:1", () => {
    const tasks: SchedulerTask[] = [];
    for (let index = 1; index <= 8; index += 1) {
      tasks.push(
        buildTask({
          taskId: `task-p1-${index}`,
          bindingKey: "binding-p1",
          sequence: index,
          priority: "P1",
        })
      );
    }
    for (let index = 1; index <= 4; index += 1) {
      tasks.push(
        buildTask({
          taskId: `task-p2-${index}`,
          bindingKey: "binding-p2",
          sequence: index,
          priority: "P2",
        })
      );
      tasks.push(
        buildTask({
          taskId: `task-p3-${index}`,
          bindingKey: "binding-p3",
          sequence: index,
          priority: "P3",
        })
      );
    }

    const simulation = simulateSchedulerDispatch({
      pendingTasks: tasks,
      nowMs: BASE_TIME_MS,
    });

    const firstEight = simulation.dispatches
      .slice(0, 8)
      .map((dispatch) => dispatch.effectivePriority);

    expect(firstEight).toEqual([
      "P1",
      "P1",
      "P2",
      "P3",
      "P1",
      "P1",
      "P2",
      "P3",
    ]);
  });

  it("promotes long-wait P2/P3 tasks to P1", () => {
    const selected = selectNextTask({
      pendingTasks: [
        buildTask({
          taskId: "task-waiting-p3",
          bindingKey: "binding-waiting",
          sequence: 1,
          priority: "P3",
          enqueuedAtMs: BASE_TIME_MS - 31_000,
        }),
        buildTask({
          taskId: "task-fresh-p2",
          bindingKey: "binding-fresh",
          sequence: 1,
          priority: "P2",
          enqueuedAtMs: BASE_TIME_MS - 1000,
        }),
      ],
      nowMs: BASE_TIME_MS,
      state: INITIAL_SCHEDULER_STATE,
    });

    expect(selected?.task.taskId).toBe("task-waiting-p3");
    expect(selected?.effectivePriority).toBe("P1");
  });

  it("applies anti-monopoly when P1 has run 3 times and lower priorities are waiting", () => {
    const selected = selectNextTask({
      pendingTasks: [
        buildTask({
          taskId: "task-p1",
          bindingKey: "binding-p1",
          sequence: 1,
          priority: "P1",
        }),
        buildTask({
          taskId: "task-p2",
          bindingKey: "binding-p2",
          sequence: 1,
          priority: "P2",
        }),
      ],
      nowMs: BASE_TIME_MS,
      state: {
        fairnessCursor: 0,
        consecutiveP1Dispatches: 3,
      },
    });

    expect(selected?.task.taskId).toBe("task-p2");
    expect(selected?.effectivePriority).toBe("P2");
  });

  it("still dispatches P1 when no lower-priority traffic exists", () => {
    const selected = selectNextTask({
      pendingTasks: [
        buildTask({
          taskId: "task-p1-only",
          bindingKey: "binding-p1",
          sequence: 1,
          priority: "P1",
        }),
      ],
      nowMs: BASE_TIME_MS,
      state: {
        fairnessCursor: 0,
        consecutiveP1Dispatches: 3,
      },
    });

    expect(selected?.task.taskId).toBe("task-p1-only");
    expect(selected?.effectivePriority).toBe("P1");
  });
});
