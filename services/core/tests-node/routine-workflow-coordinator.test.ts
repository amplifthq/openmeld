import { OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { ensureRoutineRunWorkflowStarted } from "../src/routines/routine-workflow-coordinator";

describe("Routine Workflow coordinator", () => {
  it("creates instances with bounded terminal-state retention", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "routine_run_new",
    });
    const workflow = {
      create,
      createBatch: vi.fn(),
      get: vi.fn().mockRejectedValue(new Error("Workflow instance not found")),
    } as unknown as Workflow<{ runId: string }>;

    await ensureRoutineRunWorkflowStarted({
      env: envWithWorkflow(workflow),
      runId: "routine_run_new",
    });

    expect(create).toHaveBeenCalledExactlyOnceWith({
      id: "routine_run_new",
      params: { runId: "routine_run_new" },
      retention: {
        errorRetention: "30 days",
        successRetention: "1 day",
      },
    });
  });

  it("restarts callback finalization without discarding the received event", async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    const workflow = workflowWithExistingInstance({
      restart,
      status: {
        error: {
          message: "callback finalization exhausted its retries",
          name: "RoutineWorkflowCallbackFinalizationError",
        },
        status: "errored",
      },
    });

    await ensureRoutineRunWorkflowStarted({
      env: envWithWorkflow(workflow),
      runId: "routine_run_finalization",
    });

    expect(restart).toHaveBeenCalledExactlyOnceWith({
      from: {
        name: "finalize Remote Agent callback",
        type: "do",
      },
    });
  });

  it("restarts continuation finalization without waiting for another callback", async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    const workflow = workflowWithExistingInstance({
      restart,
      status: {
        error: {
          message: "continuation callback finalization exhausted its retries",
          name: "RoutineWorkflowContinuationCallbackFinalizationError",
        },
        status: "errored",
      },
    });

    await ensureRoutineRunWorkflowStarted({
      env: envWithWorkflow(workflow),
      runId: "routine_run_continuation_finalization",
    });

    expect(restart).toHaveBeenCalledExactlyOnceWith({
      from: {
        name: "finalize Center Agent continuation callback",
        type: "do",
      },
    });
  });

  it("restarts continuation failure finalization without waiting for another event", async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    const workflow = workflowWithExistingInstance({
      restart,
      status: {
        error: {
          message: "continuation failure finalization exhausted its retries",
          name: "RoutineWorkflowContinuationFailureFinalizationError",
        },
        status: "errored",
      },
    });

    await ensureRoutineRunWorkflowStarted({
      env: envWithWorkflow(workflow),
      runId: "routine_run_continuation_failure_finalization",
    });

    expect(restart).toHaveBeenCalledExactlyOnceWith({
      from: {
        name: "finalize Center Agent continuation failure",
        type: "do",
      },
    });
  });

  it("does not silently resurrect an explicitly terminated Workflow", async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    const writeDataPoint = vi.fn();
    const workflow = workflowWithExistingInstance({
      restart,
      status: { status: "terminated" },
    });

    await expect(
      ensureRoutineRunWorkflowStarted({
        env: envWithWorkflow(workflow, writeDataPoint),
        runId: "routine_run_terminated",
      })
    ).rejects.toThrow(
      "Routine Run Workflow routine_run_terminated was explicitly terminated"
    );
    expect(restart).not.toHaveBeenCalled();
    const point = writeDataPoint.mock.calls[0]?.[0] as
      | { blobs: string[] }
      | undefined;
    expect(point?.blobs[readAnalyticsBlobIndex("event")]).toBe(
      "core.openmeld.routine_workflow.instance_recovery_blocked"
    );
    expect(point?.blobs[readAnalyticsBlobIndex("reasonCode")]).toBe(
      "workflow.terminated"
    );
  });

  it("does not erase Workflow state for an unrecognized error phase", async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    const workflow = workflowWithExistingInstance({
      restart,
      status: {
        error: {
          message: "the platform could not identify the failed step",
          name: "WorkflowInternalError",
        },
        status: "errored",
      },
    });

    await expect(
      ensureRoutineRunWorkflowStarted({
        env: envWithWorkflow(workflow),
        runId: "routine_run_unknown_error",
      })
    ).rejects.toThrow(
      "Routine Run Workflow routine_run_unknown_error cannot be safely restarted"
    );
    expect(restart).not.toHaveBeenCalled();
  });
});

function workflowWithExistingInstance(input: {
  restart: ReturnType<typeof vi.fn>;
  status: InstanceStatus;
}): Workflow<{ runId: string }> {
  const instance = {
    id: "routine_run_finalization",
    pause: vi.fn(),
    restart: input.restart,
    resume: vi.fn(),
    sendEvent: vi.fn(),
    status: vi.fn().mockResolvedValue(input.status),
    terminate: vi.fn(),
  } as WorkflowInstance;
  return {
    create: vi.fn(),
    createBatch: vi.fn(),
    get: vi.fn().mockResolvedValue(instance),
  } as Workflow<{ runId: string }>;
}

function envWithWorkflow(
  workflow: Workflow<{ runId: string }>,
  writeDataPoint?: ReturnType<typeof vi.fn>
): CoreBindings {
  return {
    OPENMELD_OBSERVABILITY: writeDataPoint ? { writeDataPoint } : undefined,
    OPENMELD_ROUTINE_RUN_WORKFLOW: workflow,
    OPENMELD_WORKER_ENVIRONMENT: "test",
  } as CoreBindings;
}

function readAnalyticsBlobIndex(
  key: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): number {
  const index = OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(key);
  if (index < 0) {
    throw new Error(`Unknown Analytics Engine blob key: ${key}`);
  }
  return index;
}
