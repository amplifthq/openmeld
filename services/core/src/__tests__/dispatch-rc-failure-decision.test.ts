import { describe, expect, it, vi } from "vitest";
import { handleRuntimeCoordinatorQueueFailureDecision } from "../dispatch/application/dispatch-queue-service";

// Blocker 2 (round 2): a D1 schema fault must not be re-queued by the
// RuntimeCoordinator retry_later path. Production sets forceTerminal to
// `isD1SchemaError(errorMessage)` (services/core/src/dispatch/application/dispatch-queue-service.ts) —
// strictly narrower than non_retryable, so other non-retryable errors with a
// transient RC handoff still pend. This unit test pins the pure-function
// contract directly: forceTerminal=true on a retry_later decision falls through
// (handled:false) to the terminal path instead of scheduling another attempt.

type Decision = Parameters<
  typeof handleRuntimeCoordinatorQueueFailureDecision
>[0]["decision"];
type QueueMessage = Parameters<
  typeof handleRuntimeCoordinatorQueueFailureDecision
>[0]["message"];

const retryLaterDecision = {
  handled: true,
  status: "retry_later",
  reasonCode: "runtime_coordinator.head_execution_link_unavailable",
} as unknown as Decision;

const createMessage = () =>
  ({ ack: vi.fn(), retry: vi.fn() }) as unknown as QueueMessage & {
    ack: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  };

describe("RuntimeCoordinator queue-failure decision honours non-retryable faults", () => {
  it("does NOT re-queue a non-retryable failure on a retry_later RC decision", () => {
    const message = createMessage();

    const result = handleRuntimeCoordinatorQueueFailureDecision({
      decision: retryLaterDecision,
      forceTerminal: true,
      message,
      queueAttempt: 1,
    });

    // handled:false → caller falls through to the terminal DLQ/ack path.
    expect(result).toEqual({ handled: false, shouldAck: true });
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("re-queues a retryable failure on a retry_later RC decision", () => {
    const message = createMessage();

    const result = handleRuntimeCoordinatorQueueFailureDecision({
      decision: retryLaterDecision,
      forceTerminal: false,
      message,
      queueAttempt: 1,
    });

    expect(result).toEqual({ handled: true, shouldAck: false });
    expect(message.retry).toHaveBeenCalledTimes(1);
  });
});
