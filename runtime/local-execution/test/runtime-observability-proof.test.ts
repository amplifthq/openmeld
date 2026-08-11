import { describe, expect, it } from "vitest";
import { hasRequiredObservabilityFields } from "../src/data-plane-contract";
import { isHealthReasonCodeConsistent } from "../src/heartbeat-policy";
import { runSchedulerRuntimeSimulation } from "../src/scheduler-runtime-simulator";

const START_TIME_MS = Date.UTC(2026, 1, 25, 15, 0, 0);

describe("runtime observability proof", () => {
  it("emits machine-readable log fields and consistent health reason code", () => {
    const simulation = runSchedulerRuntimeSimulation({
      startTimeMs: START_TIME_MS,
      tasks: [
        {
          taskId: "task-obs-1",
          bindingKey: "space-obs|agent-1",
          sequence: 1,
          priority: "P1",
          enqueuedAtMs: START_TIME_MS,
          spaceId: "space-obs",
          sourceEventId: "evt-obs-1",
          agentId: "agent-1",
        },
      ],
    });

    expect(
      simulation.logs.every((entry) => hasRequiredObservabilityFields(entry))
    ).toBe(true);

    expect(
      isHealthReasonCodeConsistent({
        runtimeState: simulation.healthPayload.runtimeState ?? "healthy",
        externalState: simulation.healthPayload.state,
        reasonCode: simulation.healthPayload.reasonCode,
      })
    ).toBe(true);
  });

  it("surfaces suspect runtime health when duplicate replies escape dedupe", () => {
    const simulation = runSchedulerRuntimeSimulation({
      dedupeWindowMs: 1,
      startTimeMs: START_TIME_MS,
      tasks: [
        {
          taskId: "task-dup-1",
          bindingKey: "space-obs|agent-dup",
          sequence: 1,
          priority: "P1",
          enqueuedAtMs: START_TIME_MS,
          spaceId: "space-obs",
          sourceEventId: "evt-dup-1",
          agentId: "agent-dup",
        },
        {
          taskId: "task-dup-2",
          bindingKey: "space-obs|agent-dup",
          sequence: 2,
          priority: "P1",
          enqueuedAtMs: START_TIME_MS + 1000,
          spaceId: "space-obs",
          sourceEventId: "evt-dup-1",
          agentId: "agent-dup",
        },
      ],
    });

    expect(simulation.duplicateReplyCount).toBeGreaterThan(0);
    expect(simulation.healthPayload.runtimeState).toBe("suspect");
    expect(simulation.healthPayload.state).toBe("degraded");
    expect(simulation.healthPayload.reasonCode).toBe("health.suspect");
  });
});
