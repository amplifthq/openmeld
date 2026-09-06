import type { FlueObservation } from "@flue/runtime";
import { describe, expect, it, vi } from "vitest";
import {
  getRemoteAgentExecutionSubmissionId,
  runWithRemoteAgentSubmissionExecution,
} from "../flue-adapter/execution-context";
import { createCenterAgentObservationDispatcher } from "../flue-adapter/observation-dispatcher";

describe("Center Agent observation dispatcher", () => {
  it("serializes a burst for one agent instance and keeps it inside the invocation lifetime", async () => {
    let activeHandlers = 0;
    let maxActiveHandlers = 0;
    let releaseFirstHandler: (() => void) | undefined;
    const firstHandlerGate = new Promise<void>((resolve) => {
      releaseFirstHandler = resolve;
    });
    const handledEventIndexes: number[] = [];
    const observedSubmissionIds: Array<string | null> = [];
    const scheduledTasks: Promise<void>[] = [];
    const scheduleBackground = vi.fn((task: Promise<void>) => {
      scheduledTasks.push(task);
    });
    const dispatch = createCenterAgentObservationDispatcher({
      handle: async (event) => {
        activeHandlers += 1;
        maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
        observedSubmissionIds.push(getRemoteAgentExecutionSubmissionId());
        if (event.eventIndex === 0) {
          await firstHandlerGate;
        }
        handledEventIndexes.push(event.eventIndex);
        activeHandlers -= 1;
      },
      scheduleBackground,
    });
    const events = Array.from({ length: 64 }, (_, eventIndex) =>
      createObservation({ eventIndex, instanceId: "space_1" })
    );

    const tasks = events.map((event) =>
      runWithRemoteAgentSubmissionExecution("submission_1", () =>
        dispatch(event)
      )
    );
    await vi.waitFor(() => expect(activeHandlers).toBe(1));

    expect(scheduleBackground).toHaveBeenCalledTimes(events.length);

    releaseFirstHandler?.();
    await Promise.all(tasks);
    await Promise.all(scheduledTasks);

    expect(maxActiveHandlers).toBe(1);
    expect(handledEventIndexes).toEqual(
      events.map((event) => event.eventIndex)
    );
    expect(observedSubmissionIds).toEqual(
      Array.from({ length: events.length }, () => "submission_1")
    );
  });

  it("lets another instance continue after a failed observation", async () => {
    const handled: string[] = [];
    const dispatch = createCenterAgentObservationDispatcher({
      handle: (event) => {
        handled.push(`${event.instanceId}:${event.eventIndex}`);
        if (event.instanceId === "space_1" && event.eventIndex === 0) {
          return Promise.reject(new Error("observation failed"));
        }
        return Promise.resolve();
      },
      scheduleBackground: () => undefined,
    });

    const failed = dispatch(
      createObservation({ eventIndex: 0, instanceId: "space_1" })
    );
    const recovered = dispatch(
      createObservation({ eventIndex: 1, instanceId: "space_1" })
    );
    const independent = dispatch(
      createObservation({ eventIndex: 0, instanceId: "space_2" })
    );

    await expect(failed).rejects.toThrow("observation failed");
    await Promise.all([recovered, independent]);

    expect(handled).toEqual(["space_1:0", "space_2:0", "space_1:1"]);
  });
});

function createObservation(input: {
  eventIndex: number;
  instanceId: string;
}): FlueObservation {
  return {
    agentName: "center-agent-v2",
    eventIndex: input.eventIndex,
    instanceId: input.instanceId,
    text: `delta-${input.eventIndex}`,
    timestamp: new Date(input.eventIndex).toISOString(),
    type: "text_delta",
    v: 3,
  } as FlueObservation;
}
