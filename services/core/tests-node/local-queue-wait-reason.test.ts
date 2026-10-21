import type { SpaceDispatchTraceSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveWakeProgressLocalQueueWaitReasonCode } from "../src/runtime-transport/application/local-queue-wait-reason";
import { resolveRuntimeCoordinatorWakeProgressWaitReasonCode } from "../src/space/application/wake-trace-waterfall";

function traceWith(input: {
  localQueue: unknown;
  status: string;
}): SpaceDispatchTraceSnapshot {
  return {
    runtimeCoordinatorExecution: { status: input.status },
    runtimeCoordinatorEvents: [
      {
        eventType: "lifecycle_accepted_local",
        payloadJson: JSON.stringify({
          localQueue: input.localQueue,
          phase: "accepted_local",
        }),
      },
    ],
  } as unknown as SpaceDispatchTraceSnapshot;
}

describe("local queue wait reason", () => {
  it("names a task queued behind another task in its folder", () => {
    expect(
      resolveWakeProgressLocalQueueWaitReasonCode({
        status: "queued",
        waitReason: "workspace_conflict",
      })
    ).toBe("runtime.local_queue.workspace_conflict");
    expect(
      resolveWakeProgressLocalQueueWaitReasonCode({
        status: "starting_runtime",
        waitReason: "none",
      })
    ).toBeNull();
    expect(
      resolveWakeProgressLocalQueueWaitReasonCode({
        status: "queued",
        waitReason: "global_concurrency",
      })
    ).toBeNull();
    expect(resolveWakeProgressLocalQueueWaitReasonCode(null)).toBeNull();
  });

  it("reports the folder wait only while the execution is still accepted_local", () => {
    const localQueue = { status: "queued", waitReason: "workspace_conflict" };
    expect(
      resolveRuntimeCoordinatorWakeProgressWaitReasonCode(
        traceWith({ localQueue, status: "accepted_local" })
      )
    ).toBe("runtime.local_queue.workspace_conflict");
    expect(
      resolveRuntimeCoordinatorWakeProgressWaitReasonCode(
        traceWith({ localQueue, status: "running" })
      )
    ).toBeNull();
  });
});
