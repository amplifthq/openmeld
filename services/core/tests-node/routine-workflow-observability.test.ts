import { OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { emitRoutineWorkflowRuntimeEvidence } from "../src/routines/routine-workflow-observability";

describe("Routine Workflow observability", () => {
  it("correlates Workflow lifecycle evidence by the Routine Run id", () => {
    const writeDataPoint = vi.fn();
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const env = {
      OPENMELD_OBSERVABILITY: { writeDataPoint },
      OPENMELD_WORKER_ENVIRONMENT: "test",
    } as unknown as CoreBindings;

    try {
      emitRoutineWorkflowRuntimeEvidence(env, {
        event: "instance_created",
        reasonCode: "workflow.created",
        runId: "routine_run_observed",
        status: "succeeded",
      });

      expect(consoleInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "routine_run_observed",
          event: "core.openmeld.routine_workflow.instance_created",
          runtimeKind: "workflow",
          status: "succeeded",
        })
      );
      const point = writeDataPoint.mock.calls[0]?.[0] as
        | { blobs: string[]; indexes: string[] }
        | undefined;
      expect(point?.indexes).toEqual(["routine_run_observed"]);
      expect(point?.blobs[readAnalyticsBlobIndex("reasonCode")]).toBe(
        "workflow.created"
      );
    } finally {
      consoleInfo.mockRestore();
    }
  });
});

function readAnalyticsBlobIndex(
  key: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): number {
  const index = OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(key);
  if (index < 0) {
    throw new Error(`Unknown Analytics Engine blob key: ${key}`);
  }
  return index;
}
