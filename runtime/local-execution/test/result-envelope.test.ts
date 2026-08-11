import { describe, expect, it } from "vitest";
import { buildTaskResultEnvelope } from "../src/result-envelope";

describe("task result envelope helper", () => {
  it("builds success envelope", () => {
    const envelope = buildTaskResultEnvelope({
      attemptId: "attempt-1",
      status: "success",
      taskId: "task-1",
      sourceEventId: "evt-1",
      agentId: "agent-1",
      deduped: false,
      output: "ok",
    });
    expect(envelope.payload.status).toBe("success");
  });

  it("builds success envelope with space action provenance", () => {
    const envelope = buildTaskResultEnvelope({
      attemptId: "attempt-1a",
      status: "success",
      taskId: "task-1a",
      sourceEventId: "evt-1a",
      agentId: "agent-1",
      deduped: false,
      output: "ok",
      spaceAction: {
        type: "stay_silent",
        reason: "Handled privately.",
      },
      spaceActionProvenance: "controller_repair",
    });

    expect(envelope.payload.status).toBe("success");
    if (envelope.payload.status !== "success") {
      throw new Error("expected success status");
    }
    expect(envelope.payload.spaceActionProvenance).toBe("controller_repair");
  });

  it("builds partial_success envelope with mapped error fields", () => {
    const envelope = buildTaskResultEnvelope({
      attemptId: "attempt-2",
      status: "partial_success",
      taskId: "task-2",
      sourceEventId: "evt-2",
      agentId: "agent-1",
      deduped: false,
      output: "partial output",
      errorType: "network",
      partialReason: "emit_failed_after_adapter_output",
    });
    expect(envelope.payload.status).toBe("partial_success");
    expect(envelope.payload.errorType).toBe("network");
  });

  it("rejects invalid failed envelope without errorType", () => {
    expect(() =>
      buildTaskResultEnvelope({
        attemptId: "attempt-3",
        status: "failed",
        taskId: "task-3",
        sourceEventId: "evt-3",
        agentId: "agent-1",
        deduped: false,
      })
    ).toThrowError("invalid daemon task result envelope");
  });
});
