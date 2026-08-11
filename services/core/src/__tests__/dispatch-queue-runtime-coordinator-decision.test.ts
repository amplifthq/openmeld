import type { RuntimeTransportRuntimeCoordinatorDecisionResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { classifyRuntimeCoordinatorQueueDecisionResponse } from "../dispatch/application/dispatch-queue-service";

const buildDecisionResponse = (
  overrides: Partial<RuntimeTransportRuntimeCoordinatorDecisionResponse>
): RuntimeTransportRuntimeCoordinatorDecisionResponse =>
  ({
    ok: true,
    action: "diagnostic_only",
    reasonCode: "runtime_coordinator.test",
    runtimeCoordinatorExecutionId: "rce-test",
    status: "recorded",
    ...overrides,
  }) as RuntimeTransportRuntimeCoordinatorDecisionResponse;

describe("classifyRuntimeCoordinatorQueueDecisionResponse", () => {
  it("keeps Queue from publishing failure when RuntimeCoordinator keeps or redelivers the active run", () => {
    expect(
      classifyRuntimeCoordinatorQueueDecisionResponse(
        buildDecisionResponse({
          action: "keep_waiting",
          reasonCode: "runtime_coordinator.local_progress_active",
        })
      )
    ).toMatchObject({
      handled: true,
      reasonCode: "runtime_coordinator.local_progress_active",
      status: "coordinator_handled",
    });
    expect(
      classifyRuntimeCoordinatorQueueDecisionResponse(
        buildDecisionResponse({
          action: "redeliver_current_run",
          reasonCode: "runtime_coordinator.current_run_redelivered",
        })
      )
    ).toMatchObject({
      handled: true,
      reasonCode: "runtime_coordinator.current_run_redelivered",
      status: "coordinator_handled",
    });
  });

  it("lets Queue retry the trigger when RuntimeCoordinator defers redelivery", () => {
    expect(
      classifyRuntimeCoordinatorQueueDecisionResponse(
        buildDecisionResponse({
          action: "redelivery_deferred",
          reasonCode: "runtime_coordinator.redelivery_route_unavailable",
        })
      )
    ).toMatchObject({
      handled: true,
      reasonCode: "runtime_coordinator.redelivery_route_unavailable",
      status: "retry_later",
    });
  });

  it("keeps terminal and diagnostic decisions owned by RuntimeCoordinator", () => {
    expect(
      classifyRuntimeCoordinatorQueueDecisionResponse(
        buildDecisionResponse({
          action: "diagnostic_only",
          reasonCode: "execution_token_terminal_late",
        })
      )
    ).toMatchObject({
      handled: true,
      reasonCode: "execution_token_terminal_late",
      status: "diagnostic_only",
    });
    expect(
      classifyRuntimeCoordinatorQueueDecisionResponse(
        buildDecisionResponse({
          action: "timeout_terminal",
          reasonCode: "runtime_coordinator.delivery_expired",
        })
      )
    ).toMatchObject({
      handled: true,
      reasonCode: "runtime_coordinator.delivery_expired",
      status: "coordinator_handled",
    });
  });

  it("treats unavailable RuntimeCoordinator decisions as retryable transport triggers", () => {
    expect(
      classifyRuntimeCoordinatorQueueDecisionResponse({
        ok: false,
        reasonCode: "runtime_coordinator.unavailable",
        runtimeCoordinatorExecutionId: "rce-test",
        status: "retry_later",
      })
    ).toMatchObject({
      handled: true,
      reasonCode: "runtime_coordinator.unavailable",
      status: "retry_later",
    });
  });
});
