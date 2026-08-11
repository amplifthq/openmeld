import { describe, expect, it } from "vitest";
import {
  assertSameBindingFifo,
  hasRequiredObservabilityFields,
} from "../src/data-plane-contract";
import { isHealthReasonCodeConsistent } from "../src/heartbeat-policy";
import { runSchedulerRuntimeSimulation } from "../src/scheduler-runtime-simulator";

const START_TIME_MS = Date.UTC(2026, 1, 25, 13, 0, 0);

describe("runtime multi-binding integration", () => {
  it("proves single-process multi-binding scheduling + dedupe + health output", () => {
    const simulation = runSchedulerRuntimeSimulation({
      startTimeMs: START_TIME_MS,
      tasks: [
        {
          taskId: "task-a-1",
          bindingKey: "space-a|agent-1",
          sequence: 1,
          priority: "P1",
          enqueuedAtMs: START_TIME_MS,
          spaceId: "space-a",
          sourceEventId: "evt-a-1",
          agentId: "agent-1",
        },
        {
          taskId: "task-a-2",
          bindingKey: "space-a|agent-1",
          sequence: 2,
          priority: "P1",
          enqueuedAtMs: START_TIME_MS + 100,
          spaceId: "space-a",
          sourceEventId: "evt-a-2",
          agentId: "agent-1",
        },
        {
          taskId: "task-b-1",
          bindingKey: "space-b|agent-2",
          sequence: 1,
          priority: "P2",
          enqueuedAtMs: START_TIME_MS + 200,
          spaceId: "space-b",
          sourceEventId: "evt-b-1",
          agentId: "agent-2",
        },
        {
          taskId: "task-b-dup",
          bindingKey: "space-b|agent-2",
          sequence: 2,
          priority: "P2",
          enqueuedAtMs: START_TIME_MS + 300,
          spaceId: "space-b",
          sourceEventId: "evt-b-1",
          agentId: "agent-2",
        },
      ],
    });

    expect(simulation.processedTaskIds).toHaveLength(4);
    expect(simulation.dispatches).toHaveLength(3);
    expect(simulation.duplicateSuppressedCount).toBe(1);
    expect(simulation.duplicateReplyCount).toBe(0);

    expect(assertSameBindingFifo(simulation.dispatches)).toBe(true);

    const bindingKeys = new Set(
      simulation.dispatches.map((dispatch) => dispatch.bindingKey)
    );
    expect(bindingKeys.has("space-a|agent-1")).toBe(true);
    expect(bindingKeys.has("space-b|agent-2")).toBe(true);

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
    expect(simulation.healthPayload.state).toBe("ok");
  });
});
