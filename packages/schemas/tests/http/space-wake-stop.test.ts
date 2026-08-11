import { describe, expect, it } from "vitest";
import {
  postSpaceWakeStopInputSchema,
  postSpaceWakeStopResponseSchema,
} from "../../src";

describe("space Wake Stop HTTP schemas", () => {
  it("accepts source-signal and client-message selectors without trusted dispatch ids", () => {
    expect(
      postSpaceWakeStopInputSchema.safeParse({
        spaceId: "space-1",
        body: {
          reason: "User stopped this Wake.",
          target: {
            by: "source_signal",
            sourceSignalId: "sig-source-1",
            targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          },
        },
      }).success
    ).toBe(true);

    expect(
      postSpaceWakeStopInputSchema.safeParse({
        spaceId: "space-1",
        body: {
          target: {
            by: "client_message",
            clientMessageId: "cm_01J00000000000000000000001",
            targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          },
        },
      }).success
    ).toBe(true);
  });

  it("rejects Web-supplied internal dispatch or task ids", () => {
    expect(
      postSpaceWakeStopInputSchema.safeParse({
        spaceId: "space-1",
        body: {
          target: {
            by: "client_message",
            clientMessageId: "cm_01J00000000000000000000001",
            dispatchId: "dispatch-1",
            targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
            taskId: "task-1",
          },
        },
      }).success
    ).toBe(false);
  });

  it("keeps Stop request delivery distinct from cancelled terminal state", () => {
    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancellation_requested",
        cancellationState: {
          status: "delivery_pending",
          reasonCode: "runtime_coordinator.wake_stop_requested",
          observedAtMs: 1_805_000_000_000,
        },
        runtimeCoordinatorExecutionId: "rce-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(true);

    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancellation_requested",
        cancellationState: {
          status: "delivery_pending",
          reasonCode: "runtime_coordinator.wake_stop_requested",
          observedAtMs: 1_805_000_000_000,
        },
        runtimeCoordinatorExecutionId: null,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(false);

    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancellation_requested",
        cancellationState: {
          status: "cancelled",
          reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
          observedAtMs: 1_805_000_000_000,
        },
        runtimeCoordinatorExecutionId: "rce-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(false);

    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancellation_requested",
        cancellationState: {
          status: "unsupported",
          reasonCode: "agent_controller_interface.stop_unsupported",
          observedAtMs: 1_805_000_000_000,
        },
        runtimeCoordinatorExecutionId: "rce-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(false);

    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancellation_requested",
        cancellationState: {
          status: "local_control_rejected",
          reasonCode: "runtime_coordinator.wake_stop_local_control_rejected",
          observedAtMs: 1_805_000_000_000,
        },
        runtimeCoordinatorExecutionId: "rce-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(false);
  });

  it("accepts OpenMeld-owned pre-agent Stop success without a RuntimeCoordinator execution", () => {
    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancelled",
        stopMode: "openmeld_owned_pre_agent",
        cancellationState: {
          status: "cancelled",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
          observedAtMs: 1_805_000_000_050,
        },
        runtimeCoordinatorExecutionId: null,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(true);

    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancelled",
        cancellationState: {
          status: "cancelled",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
          observedAtMs: 1_805_000_000_050,
        },
        runtimeCoordinatorExecutionId: null,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(false);

    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancellation_requested",
        stopMode: "openmeld_owned_pre_agent",
        cancellationState: {
          status: "delivery_pending",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
          observedAtMs: 1_805_000_000_050,
        },
        runtimeCoordinatorExecutionId: null,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(false);
  });

  it("requires cancelled responses to carry cancelled cancellation state", () => {
    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancelled",
        cancellationState: {
          status: "cancelled",
          reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
          observedAtMs: 1_805_000_000_100,
        },
        runtimeCoordinatorExecutionId: "rce-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(true);

    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: true,
        status: "cancelled",
        cancellationState: {
          status: "local_control_accepted",
          reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
          observedAtMs: 1_805_000_000_100,
        },
        runtimeCoordinatorExecutionId: "rce-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(false);
  });

  it("keeps failed Wake Stop responses aligned with failure cancellation states", () => {
    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: false,
        status: "unsupported",
        reasonCode: "agent_controller_interface.stop_unsupported",
        cancellationState: {
          status: "unsupported",
          reasonCode: "agent_controller_interface.stop_unsupported",
          observedAtMs: 1_805_000_000_000,
        },
        runtimeCoordinatorExecutionId: null,
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(true);

    expect(
      postSpaceWakeStopResponseSchema.safeParse({
        ok: false,
        status: "unsupported",
        reasonCode: "agent_controller_interface.stop_unsupported",
        cancellationState: {
          status: "delivery_pending",
          reasonCode: "runtime_coordinator.wake_stop_requested",
          observedAtMs: 1_805_000_000_000,
        },
        runtimeCoordinatorExecutionId: "rce-1",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(false);
  });
});
