import type { AdapterDispatchRequest } from "@openmeld/adapter-core";
import type { LocalDaemonAdapterEntry } from "@openmeld/local-service";
import { describe, expect, it } from "vitest";
import { withProviderInvocationObserver } from "../src/local-service/execution-host/runtime";

describe("provider invocation observer", () => {
  const request = { taskId: "task-1" } as AdapterDispatchRequest;
  const entry = (dispatch: () => Promise<unknown>, steps: string[]) =>
    ({
      adapterId: "codex",
      transportModes: ["local-cli"],
      adapter: {
        adapterId: "codex",
        dispatch: async () => {
          steps.push("dispatch");
          return await dispatch();
        },
        interrupt: async () => ({}),
      },
    }) as unknown as LocalDaemonAdapterEntry;

  it.each([
    ["completes", () => Promise.resolve({ status: "success" })],
    ["fails", () => Promise.reject(new Error("provider failed"))],
  ] as const)("records each invocation around the adapter when it %s", async (_outcome, dispatch) => {
    const steps: string[] = [];
    const observed = withProviderInvocationObserver(
      entry(dispatch, steps),
      (event) => steps.push(`${event.phase}:${event.taskId}`)
    );
    await Promise.allSettled([
      observed.adapter.dispatch(request),
      observed.adapter.dispatch(request),
    ]);
    expect(steps).toEqual([
      "started:task-1",
      "dispatch",
      "started:task-1",
      "dispatch",
      "ended:task-1",
      "ended:task-1",
    ]);
  });

  it("refuses an invocation whose start cannot be recorded", async () => {
    const steps: string[] = [];
    const observed = withProviderInvocationObserver(
      entry(() => Promise.resolve({ status: "success" }), steps),
      (event) => {
        if (event.phase === "started") {
          throw new Error("receipt write failed");
        }
        steps.push(event.phase);
      }
    );
    await expect(observed.adapter.dispatch(request)).rejects.toThrow(
      "receipt write failed"
    );
    expect(steps).toEqual([]);
  });
});
