import { describe, expect, it } from "vitest";
import { runSchedulerRuntimeSimulation } from "../src/scheduler-runtime-simulator";

const START_TIME_MS = Date.UTC(2026, 1, 25, 13, 0, 0);

const TASKS = [
  {
    agentId: "agent-codex",
    bindingKey: "space-1|agent-codex",
    priority: "P2" as const,
    sequence: 1,
    sourceEventId: "evt-1",
    spaceId: "space-1",
    taskId: "task-1",
  },
];

describe("scheduler runtime compatibility", () => {
  it("uses semantic runId prefix for canonical API", () => {
    const result = runSchedulerRuntimeSimulation({
      startTimeMs: START_TIME_MS,
      tasks: TASKS,
    });
    expect(result.logs[0]?.runId).toBe(`scheduler-${START_TIME_MS}`);
  });
});
