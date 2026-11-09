import { describe, expect, it } from "vitest";
import {
  hasRuntimeCoordinatorLocalProgressStaleTerminalExpired,
  RUNTIME_COORDINATOR_COMMUNICATION_RECOVERY_WINDOW_MS,
  RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_STALE_TERMINAL_AFTER_MS,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION,
  type RuntimeCoordinatorRunCommandState,
} from "../../../services/core/src/runtime-transport/application/runtime-coordinator-authority.ts";

const progressAt = 1_700_000_000_000;

const command = (
  overrides: Partial<RuntimeCoordinatorRunCommandState> = {}
): RuntimeCoordinatorRunCommandState =>
  ({
    activeRunId: "run-1",
    attemptId: "attempt-1",
    createdAtMs: progressAt,
    dispatchId: "dispatch-1",
    lastCommandReasonCode: null,
    lastDeliveryProvenance: {
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      leaseEpoch: 1,
    },
    lastWatchdogCheckAtMs: null,
    localProgress: {
      acceptedLocalAtMs: progressAt,
      completedLocalAtMs: null,
      lastLifecycleAtMs: progressAt,
      phase: "running",
      resultReceivedAtMs: null,
      runningAtMs: progressAt,
    },
    modelVersion: RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION,
    ownerUserId: "owner-1",
    profileId: "agent-1",
    redeliveryCount: 0,
    runtimeCoordinatorExecutionId: "rce-1",
    sanitizedDeliveryRequest: {},
    sourceClientMessageId: "client-message-1",
    targetProfileId: "agent-1",
    updatedAtMs: progressAt,
    ...overrides,
  }) as RuntimeCoordinatorRunCommandState;

const expired = (
  commandState: RuntimeCoordinatorRunCommandState,
  nowMs: number
) =>
  hasRuntimeCoordinatorLocalProgressStaleTerminalExpired({
    commandState,
    nowMs,
  });

describe("runtime coordinator liveness", () => {
  it("uses a five-minute window, or thirty after the computer disconnects", () => {
    expect(RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_STALE_TERMINAL_AFTER_MS).toBe(
      5 * 60_000
    );
    expect(RUNTIME_COORDINATOR_COMMUNICATION_RECOVERY_WINDOW_MS).toBe(
      30 * 60_000
    );
    const working = command();
    expect(expired(working, progressAt + 5 * 60_000 - 1)).toBe(false);
    expect(expired(working, progressAt + 5 * 60_000)).toBe(true);

    const away = command({
      communicationRecoveryBaselineAtMs: progressAt,
    });
    expect(expired(away, progressAt + 30 * 60_000 - 1)).toBe(false);
    expect(expired(away, progressAt + 30 * 60_000)).toBe(true);
    const moved = progressAt + 1;
    const progressed = command({
      communicationRecoveryBaselineAtMs: progressAt,
      localProgress: {
        ...working.localProgress,
        lastLifecycleAtMs: moved,
      },
    });
    expect(expired(progressed, moved + 5 * 60_000 - 1)).toBe(false);
    expect(expired(progressed, moved + 5 * 60_000)).toBe(true);
  });

  it("does not fail a wake while it is waiting for the user", () => {
    expect(
      expired(
        command({
          pendingInteraction: {
            response: null,
          },
        }),
        progressAt + 30 * 60_000
      )
    ).toBe(false);
  });
});
