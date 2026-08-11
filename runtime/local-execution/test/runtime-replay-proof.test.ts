import { describe, expect, it } from "vitest";
import { runSchedulerRuntimeSimulation } from "../src/scheduler-runtime-simulator";

const START_TIME_MS = Date.UTC(2026, 1, 25, 14, 0, 0);

describe("runtime replay proof", () => {
  it("keeps duplicate reply count at zero in a deterministic replay scenario", () => {
    const simulation = runSchedulerRuntimeSimulation({
      startTimeMs: START_TIME_MS,
      tasks: [
        {
          taskId: "task-1",
          bindingKey: "space-z|agent-z",
          sequence: 1,
          priority: "P1",
          enqueuedAtMs: START_TIME_MS,
          spaceId: "space-z",
          sourceEventId: "evt-z-1",
          agentId: "agent-z",
        },
        {
          taskId: "task-dup",
          bindingKey: "space-z|agent-z",
          sequence: 2,
          priority: "P1",
          enqueuedAtMs: START_TIME_MS + 200,
          spaceId: "space-z",
          sourceEventId: "evt-z-1",
          agentId: "agent-z",
        },
      ],
    });

    expect(simulation.duplicateSuppressedCount).toBe(1);
    expect(simulation.duplicateReplyCount).toBe(0);
  });
});
