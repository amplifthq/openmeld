import { describe, expect, it } from "vitest";
import {
  RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
  runtimeCoordinatorCancellationStateSchema,
  runtimeCoordinatorExecutionEventSchema,
  runtimeCoordinatorExecutionRecordSchema,
} from "../../src";

describe("runtime coordinator execution schemas", () => {
  it("accepts cancellation_requested as an active execution state", () => {
    expect(
      runtimeCoordinatorExecutionRecordSchema.safeParse(
        buildExecutionRecord({
          status: "cancellation_requested",
          terminalOutcome: null,
        })
      ).success
    ).toBe(true);
  });

  it("accepts cancelled as its own terminal outcome instead of failed_terminal", () => {
    const record = buildExecutionRecord({
      status: "cancelled",
      terminalOutcome: {
        kind: "cancelled",
        observedAtMs: 1_805_000_000_100,
        reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
      },
    });

    expect(
      runtimeCoordinatorExecutionRecordSchema.safeParse(record).success
    ).toBe(true);
    expect(record.status).not.toBe("failed_terminal");
    expect(record.terminalOutcome?.kind).toBe("cancelled");
  });

  it("rejects cancelled execution records without a cancelled terminal outcome", () => {
    expect(
      runtimeCoordinatorExecutionRecordSchema.safeParse(
        buildExecutionRecord({
          status: "cancelled",
          terminalOutcome: null,
        })
      ).success
    ).toBe(false);

    expect(
      runtimeCoordinatorExecutionRecordSchema.safeParse(
        buildExecutionRecord({
          status: "cancelled",
          terminalOutcome: {
            kind: "reply_published",
            observedAtMs: 1_805_000_000_100,
            reasonCode: null,
          },
        })
      ).success
    ).toBe(false);
  });

  it("rejects cancellation_requested execution records with a terminal outcome", () => {
    expect(
      runtimeCoordinatorExecutionRecordSchema.safeParse(
        buildExecutionRecord({
          status: "cancellation_requested",
          terminalOutcome: {
            kind: "cancelled",
            observedAtMs: 1_805_000_000_100,
            reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
          },
        })
      ).success
    ).toBe(false);
  });

  it("accepts Wake Stop cancellation events and cancellation state", () => {
    expect(
      runtimeCoordinatorExecutionEventSchema.safeParse({
        eventId: "event-1",
        runtimeCoordinatorExecutionId: "rce-1",
        eventType: "cancellation_control_accepted",
        statusAfter: "cancelled",
        reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
        observedAtMs: 1_805_000_000_100,
        idempotencyKey: "stop:rce-1",
        payloadJson: "{}",
      }).success
    ).toBe(true);

    expect(
      runtimeCoordinatorCancellationStateSchema.safeParse({
        status: "local_control_accepted",
        reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
        observedAtMs: 1_805_000_000_100,
      }).success
    ).toBe(true);
  });
});

function buildExecutionRecord(input: {
  status: "cancellation_requested" | "cancelled";
  terminalOutcome: null | {
    kind: "cancelled" | "reply_published";
    observedAtMs: number;
    reasonCode: string | null;
  };
}) {
  return {
    agentControllerRef: "builtin:claude-code",
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: "runtime-1",
    },
    bindingId: "binding-1",
    createdAtMs: 1_805_000_000_000,
    dispatchId: "dispatch-1",
    legacyPointers: {
      attemptId: "attempt-1",
      claimLeaseId: null,
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      leaseEpoch: 2,
    },
    modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
    runtimeCoordinatorExecutionId: "rce-1",
    sourceClientMessageId: "client-message-1",
    spaceId: "space-1",
    status: input.status,
    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
    terminalOutcome: input.terminalOutcome,
    updatedAtMs: 1_805_000_000_100,
  };
}
