import type { AdapterCancelResult } from "@openmeld/adapter-core";
import { createInflightTaskControlRegistry } from "@openmeld/local-service";
import { describe, expect, it, vi } from "vitest";
import { handleLocalControlPlaneCancel } from "../src/local-service/carrier/local-control-handlers";
import type { Presenter } from "../src/runtime/presenter/types";

const DISPATCH_ID = "dispatch-withdrawal-receipt";
const EXECUTION_ID = "rce-withdrawal-receipt";
const TASK_ID = "task-withdrawal-receipt";

const createPresenter = (): Presenter =>
  ({
    line: vi.fn(),
  }) as unknown as Presenter;

const createAdapterContainer = (cancel: () => Promise<AdapterCancelResult>) =>
  ({
    getAdapter: () => ({
      adapter: { adapterId: "builtin:codex", cancel },
    }),
  }) as unknown as Parameters<
    typeof handleLocalControlPlaneCancel
  >[0]["localAdapterContainer"];

const registerAttempt = (
  registry: ReturnType<typeof createInflightTaskControlRegistry>
) => {
  registry.registerTask({
    adapterId: "builtin:codex",
    dispatchId: DISPATCH_ID,
    runtimeCoordinatorExecutionId: EXECUTION_ID,
    taskId: TASK_ID,
  });
};

const cancelRequest = {
  reason: "superseded_by_continuation",
  runtimeCoordinatorExecutionId: EXECUTION_ID,
  target: { by: "task", taskId: TASK_ID },
} as const;

describe("local withdrawal receipts", () => {
  it("answers a repeat request from what the withdrawal established", async () => {
    const registry = createInflightTaskControlRegistry();
    registerAttempt(registry);
    const presenter = createPresenter();
    const localAdapterContainer = createAdapterContainer(() =>
      Promise.resolve({
        accepted: true,
        deliveryPath: "cancel",
        localAttemptOutcome: "withdrawn_before_start",
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: TASK_ID,
      })
    );

    const first = await handleLocalControlPlaneCancel({
      localAdapterContainer,
      payload: cancelRequest,
      presenter,
      registry,
    });
    expect(first).toMatchObject({
      accepted: true,
      reasonCode: "adapter.cancel.withdrawn_before_start",
      resolvedRuntimeCoordinatorExecutionId: EXECUTION_ID,
      resolvedTaskId: TASK_ID,
    });

    // Accepting the withdrawal removed the inflight record. Losing this first
    // answer in transit must not turn the established fact into "no such task".
    const replay = await handleLocalControlPlaneCancel({
      localAdapterContainer,
      payload: cancelRequest,
      presenter,
      registry,
    });
    expect(replay).toMatchObject({
      accepted: true,
      reasonCode: "adapter.cancel.withdrawn_before_start",
      resolvedDispatchId: DISPATCH_ID,
      resolvedRuntimeCoordinatorExecutionId: EXECUTION_ID,
      resolvedTaskId: TASK_ID,
    });
  });

  it("refuses a replay that names a different execution", async () => {
    const registry = createInflightTaskControlRegistry();
    registerAttempt(registry);
    const presenter = createPresenter();
    const localAdapterContainer = createAdapterContainer(() =>
      Promise.resolve({
        accepted: true,
        deliveryPath: "cancel",
        localAttemptOutcome: "withdrawn_before_start",
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: TASK_ID,
      })
    );
    await handleLocalControlPlaneCancel({
      localAdapterContainer,
      payload: cancelRequest,
      presenter,
      registry,
    });

    const replay = await handleLocalControlPlaneCancel({
      localAdapterContainer,
      payload: {
        ...cancelRequest,
        runtimeCoordinatorExecutionId: "rce-some-other-attempt",
      },
      presenter,
      registry,
    });
    expect(replay).toMatchObject({
      accepted: false,
      reasonCode: "task.not_found",
    });
  });

  it("keeps no receipt for a stop the adapter only requested", async () => {
    const registry = createInflightTaskControlRegistry();
    registerAttempt(registry);
    const presenter = createPresenter();
    const localAdapterContainer = createAdapterContainer(() =>
      Promise.resolve({
        accepted: true,
        deliveryPath: "cancel",
        localAttemptOutcome: "stop_requested_after_start",
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: TASK_ID,
      })
    );
    await handleLocalControlPlaneCancel({
      localAdapterContainer,
      payload: cancelRequest,
      presenter,
      registry,
    });

    // A started turn keeps its own result, so replaying the request must not
    // hand back a stronger answer than the adapter gave.
    const replay = await handleLocalControlPlaneCancel({
      localAdapterContainer,
      payload: cancelRequest,
      presenter,
      registry,
    });
    expect(replay).toMatchObject({
      accepted: true,
      reasonCode: "adapter.cancel.stop_requested_after_start",
    });
  });
});
