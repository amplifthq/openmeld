import { describe, expect, it, vi } from "vitest";
import { pauseActiveCenterAgentNativeDeliveries } from "../src/center-agent/center-agent-operating-state-service";
import type { CoreBindings } from "../src/lib/bindings";

describe("Center Agent operating state", () => {
  it("requests cancellation for every active Center Agent delivery across the Organization", async () => {
    const cancelExecution = vi.fn().mockResolvedValue({
      execution: executionState("cancellation_requested"),
      status: "cancellation_requested",
    } as const);
    const db = activeDeliveriesDb();

    await expect(
      pauseActiveCenterAgentNativeDeliveries({
        db,
        env: {
          OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
        } as unknown as CoreBindings,
        organizationId: "org-1",
        profileId: "agt-center",
      })
    ).resolves.toBe(2);

    expect(cancelExecution).toHaveBeenCalledTimes(2);
    expect(cancelExecution).toHaveBeenNthCalledWith(1, {
      idempotencyKey: "turn-space",
      organizationId: "org-1",
      reason: "Center Agent was paused by an Organization owner or admin.",
      spaceId: "space-1",
      submissionId: "submission-space",
      v: 1,
    });
    expect(cancelExecution).toHaveBeenNthCalledWith(2, {
      idempotencyKey: "turn-slack",
      organizationId: "org-1",
      reason: "Center Agent was paused by an Organization owner or admin.",
      spaceId: "slack-conversation-1",
      submissionId: "submission-slack",
      v: 1,
    });
    expect(String(db.prepare.mock.calls[0]?.[0])).toContain(
      "status IN ('submitted', 'accepted', 'retry_observed')"
    );
  });

  it("fails when an active delivery is missing from the execution owner", async () => {
    const cancelExecution = vi
      .fn()
      .mockResolvedValue({ status: "not_found" } as const);

    await expect(
      pauseActiveCenterAgentNativeDeliveries({
        db: activeDeliveriesDb(),
        env: {
          OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
        } as unknown as CoreBindings,
        organizationId: "org-1",
        profileId: "agt-center",
      })
    ).rejects.toThrow(
      "One or more active Center Agent tasks could not be stopped."
    );
  });

  it("accepts a terminal execution as already stopped", async () => {
    const cancelExecution = vi.fn().mockResolvedValue({
      execution: executionState("completed"),
      status: "not_stoppable",
    } as const);

    await expect(
      pauseActiveCenterAgentNativeDeliveries({
        db: activeDeliveriesDb(),
        env: {
          OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
        } as unknown as CoreBindings,
        organizationId: "org-1",
        profileId: "agt-center",
      })
    ).resolves.toBe(2);
  });
});

function executionState(status: "cancellation_requested" | "completed") {
  return {
    acceptedAtMs: 100,
    cancellationReason:
      status === "cancellation_requested"
        ? "Center Agent was paused by an Organization owner or admin."
        : null,
    completedAtMs: status === "completed" ? 200 : null,
    idempotencyKey: "turn-space",
    lastProgressAtMs: status === "completed" ? 200 : 100,
    lastProgressKind:
      status === "completed" ? ("prompt_completed" as const) : status,
    organizationId: "org-1",
    spaceId: "space-1",
    status,
    submissionId: "submission-space",
    v: 1 as const,
  };
}

function activeDeliveriesDb(): D1Database & {
  prepare: ReturnType<typeof vi.fn>;
} {
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      all: vi.fn(async () => ({
        results: [
          {
            idempotency_key: "turn-space",
            organization_id: "org-1",
            space_id: "space-1",
            submission_id: "submission-space",
          },
          {
            idempotency_key: "turn-slack",
            organization_id: "org-1",
            space_id: "slack-conversation-1",
            submission_id: "submission-slack",
          },
        ],
      })),
    })),
  }));
  return { prepare } as unknown as D1Database & {
    prepare: ReturnType<typeof vi.fn>;
  };
}
