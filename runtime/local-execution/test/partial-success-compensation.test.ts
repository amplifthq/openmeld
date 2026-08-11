import { describe, expect, it } from "vitest";
import {
  buildCompensationExecutionPlan,
  buildTaskResultPayloadFromOutcome,
  COMPENSATION_DELAYS_MS,
  getCompensationDelayMs,
  isCompensationAttemptAllowed,
  resolveCompensationProgress,
} from "../src/recovery-policy";
import { buildTaskResultEnvelope } from "../src/result-envelope";

describe("ledger-recovery partial_success + compensation policy", () => {
  it("maps output + emit failure to partial_success with failure mapping fields", () => {
    const payload = buildTaskResultPayloadFromOutcome({
      agentId: "agent-1",
      attemptId: "attempt-1",
      deduped: false,
      emitFailed: true,
      errorMessage: "emit transport failed",
      errorType: "network",
      output: "completed output",
      sourceEventId: "evt-1",
      taskId: "task-1",
    });

    const envelope = buildTaskResultEnvelope(payload);
    expect(envelope.payload.status).toBe("partial_success");
    if (envelope.payload.status !== "partial_success") {
      throw new Error("expected partial_success status");
    }

    expect(envelope.payload.partialReason).toBe("emit_failed");
    expect(envelope.payload.errorType).toBe("network");
  });

  it("maps no-output failure to failed (never partial_success)", () => {
    const payload = buildTaskResultPayloadFromOutcome({
      agentId: "agent-2",
      attemptId: "attempt-2",
      deduped: false,
      emitFailed: true,
      errorMessage: "adapter timeout",
      errorType: "timeout",
      output: " ",
      sourceEventId: "evt-2",
      taskId: "task-2",
    });

    const envelope = buildTaskResultEnvelope(payload);
    expect(envelope.payload.status).toBe("failed");
  });

  it("carries provider account evidence on failed task results", () => {
    const payload = buildTaskResultPayloadFromOutcome({
      agentId: "agent-claude-code",
      attemptId: "attempt-provider-access-1",
      deduped: false,
      emitFailed: true,
      errorCode: "quota.exceeded",
      errorMessage:
        "Claude Code subscription access is unavailable for this account.",
      errorType: "adapter",
      providerAccessEvidence: {
        observedAtMs: 1_770_000_000_000,
        provider: "claude-code",
        reasonCode: "provider_account.subscription_access_unavailable",
        source: "wake_failure",
      },
      sourceEventId: "evt-provider-access-1",
      taskId: "task-provider-access-1",
    });

    expect(payload).toMatchObject({
      providerAccessEvidence: {
        provider: "claude-code",
        reasonCode: "provider_account.subscription_access_unavailable",
      },
      status: "failed",
    });
  });

  it("freezes compensation cadence to 5s/15s/30s with max 3 attempts", () => {
    expect([...COMPENSATION_DELAYS_MS]).toEqual([5000, 15_000, 30_000]);
    expect(getCompensationDelayMs(1)).toBe(5000);
    expect(getCompensationDelayMs(2)).toBe(15_000);
    expect(getCompensationDelayMs(3)).toBe(30_000);
    expect(getCompensationDelayMs(4)).toBeNull();

    expect(isCompensationAttemptAllowed(1)).toBe(true);
    expect(isCompensationAttemptAllowed(2)).toBe(true);
    expect(isCompensationAttemptAllowed(3)).toBe(true);
    expect(isCompensationAttemptAllowed(4)).toBe(false);
  });

  it("stops compensation on success and after 3 failed attempts", () => {
    expect(buildCompensationExecutionPlan()).toEqual([
      { attempt: 1, delayMs: 5000 },
      { attempt: 2, delayMs: 15_000 },
      { attempt: 3, delayMs: 30_000 },
    ]);

    expect(
      resolveCompensationProgress({
        attemptsCompleted: 1,
        lastAttemptSucceeded: true,
      })
    ).toEqual({
      nextDelayMs: null,
      terminal: true,
    });

    expect(
      resolveCompensationProgress({
        attemptsCompleted: 0,
        lastAttemptSucceeded: false,
      })
    ).toEqual({
      nextDelayMs: 5000,
      terminal: false,
    });

    expect(
      resolveCompensationProgress({
        attemptsCompleted: 3,
        lastAttemptSucceeded: false,
      })
    ).toEqual({
      nextDelayMs: null,
      terminal: true,
    });
  });
});
