import {
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES,
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  classifyRemoteAgentTurnFailure,
  emitRemoteAgentAdmissionStageEvidence,
  emitRemoteAgentExecutionStageEvidence,
  observeRemoteAgentRpc,
  resolveSubmitConversationTurnOutcome,
} from "../flue-adapter/cloudflare-runtime-evidence";

type AnalyticsPoint = {
  blobs: string[];
  doubles: number[];
  indexes: string[];
};

describe("Remote Agent Cloudflare runtime evidence", () => {
  it("persists RPC start evidence before a stuck admission can settle", async () => {
    const writeDataPoint = vi.fn();
    let resolveAdmission:
      | ((value: { accepted: true; submissionId: string }) => void)
      | undefined;
    const admission = observeRemoteAgentRpc({
      dispatchId: "dispatch_stuck_admission",
      env: {
        OPENMELD_OBSERVABILITY: { writeDataPoint },
        OPENMELD_WORKER_ENVIRONMENT: "test",
      },
      execute: () =>
        new Promise<{ accepted: true; submissionId: string }>((resolve) => {
          resolveAdmission = resolve;
        }),
      operation: "submitConversationTurn",
      spaceId: "space_123",
    });

    expect(writeDataPoint).toHaveBeenCalledOnce();
    const startedPoint = writeDataPoint.mock.calls[0]?.[0] as AnalyticsPoint;
    expect(readBlob(startedPoint, "event")).toBe("remote_agent.openmeld.rpc");
    expect(readBlob(startedPoint, "status")).toBe("started");
    expect(readBlob(startedPoint, "dispatchId")).toBe(
      "dispatch_stuck_admission"
    );

    resolveAdmission?.({
      accepted: true,
      submissionId: "submission_stuck_admission",
    });
    await admission;
    expect(writeDataPoint).toHaveBeenCalledTimes(2);
  });

  it("persists a correlated Durable Object admission stage", () => {
    const writeDataPoint = vi.fn();

    emitRemoteAgentAdmissionStageEvidence(
      {
        OPENMELD_OBSERVABILITY: { writeDataPoint },
        OPENMELD_WORKER_ENVIRONMENT: "test",
      },
      {
        bindingId: "binding_123",
        clientMessageId: "123e4567-e89b-42d3-a456-426614174000",
        dispatchId: "dispatch_123",
        operation: "durable_object_entered",
        spaceId: "space_123",
        status: "started",
        targetProfileId: "agt_123",
      }
    );

    expect(writeDataPoint).toHaveBeenCalledOnce();
    const point = writeDataPoint.mock.calls[0]?.[0] as AnalyticsPoint;
    expect(readBlob(point, "event")).toBe(
      "remote_agent.openmeld.admission_stage.durable_object_entered"
    );
    expect(readBlob(point, "runtimeKind")).toBe("durable_object");
    expect(readBlob(point, "status")).toBe("started");
    expect(readBlob(point, "dispatchId")).toBe("dispatch_123");
  });

  it("persists execution substages with their category and operation in the event name", () => {
    const writeDataPoint = vi.fn();

    emitRemoteAgentExecutionStageEvidence(
      {
        OPENMELD_OBSERVABILITY: { writeDataPoint },
        OPENMELD_WORKER_ENVIRONMENT: "test",
      },
      {
        category: "materialization",
        dispatchId: "dispatch_123",
        durationMs: 321,
        inputBytes: 4096,
        operation: "skills",
        requestId: "submission_123",
        spaceId: "space_123",
        status: "succeeded",
        toolCount: 42,
      }
    );

    expect(writeDataPoint).toHaveBeenCalledOnce();
    const point = writeDataPoint.mock.calls[0]?.[0] as AnalyticsPoint;
    expect(readBlob(point, "event")).toBe(
      "remote_agent.openmeld.execution_stage.materialization.skills"
    );
    expect(readBlob(point, "runtimeKind")).toBe("durable_object");
    expect(readBlob(point, "requestId")).toBe("submission_123");
    expect(readDouble(point, "durationMs")).toBe(321);
    expect(readDouble(point, "inputBytes")).toBe(4096);
    expect(readDouble(point, "toolCount")).toBe(42);
  });

  it("writes successful RPC evidence with the shared Analytics Engine layout", async () => {
    const writeDataPoint = vi.fn();
    const result = await observeRemoteAgentRpc({
      env: {
        OPENMELD_OBSERVABILITY: { writeDataPoint },
        OPENMELD_WORKER_ENVIRONMENT: "test",
      },
      execute: async () => ({ ok: true }),
      operation: "readUsageDiagnostics",
      spaceId: "space_123",
    });

    expect(result).toEqual({ ok: true });
    expect(writeDataPoint).toHaveBeenCalledTimes(2);
    const point = writeDataPoint.mock.calls[1]?.[0] as AnalyticsPoint;
    expect(point.blobs).toHaveLength(
      OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.length
    );
    expect(point.doubles).toHaveLength(
      OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES.length
    );
    expect(readBlob(point, "event")).toBe("remote_agent.openmeld.rpc");
    expect(readBlob(point, "workerName")).toBe("openmeld-remote-agent");
    expect(readBlob(point, "runtimeKind")).toBe("rpc");
    expect(readBlob(point, "status")).toBe("succeeded");
    expect(readBlob(point, "reasonCode")).toBe(
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.RPC_SUCCEEDED
    );
    expect(readBlob(point, "spaceId")).toBe("space_123");
    expect(readDouble(point, "durationMs")).toBeGreaterThanOrEqual(0);
    expect(point.indexes).toEqual(["space_123"]);
  });

  it("records a busy admission as a failed RPC outcome without changing its response", async () => {
    const writeDataPoint = vi.fn();
    const response = {
      accepted: false,
      createdAt: 1,
      status: "running",
      submissionId: "submission_existing",
    } as const;

    await expect(
      observeRemoteAgentRpc({
        env: {
          OPENMELD_OBSERVABILITY: { writeDataPoint },
          OPENMELD_WORKER_ENVIRONMENT: "test",
        },
        execute: async () => response,
        operation: "submitConversationTurn",
        resolveOutcome: resolveSubmitConversationTurnOutcome,
        requestId: "submission_existing",
        spaceId: "space_123",
      })
    ).resolves.toBe(response);

    const point = writeDataPoint.mock.calls[1]?.[0] as AnalyticsPoint;
    expect(readBlob(point, "status")).toBe("failed");
    expect(readBlob(point, "reasonCode")).toBe(
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.ADMISSION_CONVERSATION_BUSY
    );
    expect(readBlob(point, "requestId")).toBe("submission_existing");
  });

  it("rethrows RPC failures after recording bounded failure evidence", async () => {
    const writeDataPoint = vi.fn();
    const failure = new Error("private provider detail");

    await expect(
      observeRemoteAgentRpc({
        env: {
          OPENMELD_OBSERVABILITY: { writeDataPoint },
          OPENMELD_WORKER_ENVIRONMENT: "test",
        },
        execute: () => Promise.reject(failure),
        operation: "summarizeAgentActivityDigest",
      })
    ).rejects.toBe(failure);

    const point = writeDataPoint.mock.calls[1]?.[0] as AnalyticsPoint;
    expect(readBlob(point, "status")).toBe("failed");
    expect(readBlob(point, "reasonCode")).toBe(
      REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.RPC_FAILED
    );
    expect(point.blobs).not.toContain("private provider detail");
  });

  it("classifies timeout and provider failures without returning provider text", () => {
    expect(
      classifyRemoteAgentTurnFailure({
        name: "SubmissionTimeoutError",
        type: "submission_timeout",
      })
    ).toEqual({
      errorName: "SubmissionTimeoutError",
      reasonCode: "remote_agent.turn.timeout",
    });
    expect(
      classifyRemoteAgentTurnFailure({
        code: "rate_limit_exceeded",
        message: "sensitive upstream response",
        name: "APIError",
      })
    ).toEqual({
      errorName: "APIError",
      reasonCode: "remote_agent.provider.rate_limited",
    });
    expect(
      classifyRemoteAgentTurnFailure(
        new Error("Customer message mentioned network and 503")
      )
    ).toEqual({
      errorName: "Error",
      reasonCode: "remote_agent.turn.failed",
    });
  });

  it("classifies a provider context-window rejection as its own terminal cause", () => {
    expect(
      classifyRemoteAgentTurnFailure({
        message:
          "This endpoint's maximum context length is 500000 tokens. However, you requested about 516153 tokens.",
        name: "FlueError",
        type: "operation_failed",
      })
    ).toEqual({
      errorName: "FlueError",
      reasonCode: "remote_agent.turn.context_window_exceeded",
    });
  });
});

function readBlob(
  point: AnalyticsPoint,
  field: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): string | undefined {
  return point.blobs[OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(field)];
}

function readDouble(
  point: AnalyticsPoint,
  field: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES)[number]
): number | undefined {
  return point.doubles[
    OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES.indexOf(field)
  ];
}
