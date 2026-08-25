import { describe, expect, it, vi } from "vitest";
import { createRemoteAgentCallbackContext } from "../agent-core/callback-context";
import { emitCenterAgentPerformanceMilestone } from "../flue-adapter/center-agent-performance-observability";
import { createSubmitTurnRequest } from "./fixtures";

describe("Center Agent performance observability", () => {
  it("writes a channel- and model-queryable milestone without prompt text", () => {
    const writeDataPoint = vi.fn();
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: 100,
        idempotencyKey: request.idempotencyKey,
        requestId: "request-1",
        status: "pending",
        submissionId: "submission-1",
      },
      nowMs: 100,
      request,
    });

    emitCenterAgentPerformanceMilestone(
      {
        OPENMELD_CENTER_AGENT_PERFORMANCE: { writeDataPoint },
        OPENMELD_WORKER_ENVIRONMENT: "prod",
      },
      {
        availableToolCount: 80,
        context,
        exposedToolCount: 12,
        milestone: "provider_request_prepared",
        modelId: "openai/gpt-5.4",
        observedAtMs: 350,
        stageDurationMs: 250,
      }
    );

    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: expect.arrayContaining([
        "provider_request_prepared",
        request.turnEnvelope.trigger.source,
        "openai/gpt-5.4",
      ]),
      doubles: [1, 250, 250, 80, 12, 68, 0],
      indexes: [request.organizationId],
    });
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain(
      request.messages[0]?.content
    );
  });
});
