import {
  CENTER_AGENT_PERFORMANCE_ANALYTICS_BLOBS,
  CENTER_AGENT_PERFORMANCE_ANALYTICS_DOUBLES,
  CENTER_AGENT_PERFORMANCE_MODEL_VERSION,
  projectCenterAgentPerformanceAnalyticsDataPoint,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("Center Agent performance evidence", () => {
  it("projects channel and model dimensions without using a unique turn as the aggregate index", () => {
    const point = projectCenterAgentPerformanceAnalyticsDataPoint({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      availableToolCount: 80,
      bindingId: "binding-1",
      deferredToolCount: 68,
      dispatchId: "dispatch-1",
      elapsedFromAdmissionMs: 250,
      exposedToolCount: 12,
      milestone: "provider_request_prepared",
      modelId: "openai/gpt-5.4",
      modelVersion: CENTER_AGENT_PERFORMANCE_MODEL_VERSION,
      organizationId: "org-1",
      reasonCode: null,
      sourceClientMessageId: "cm_12345678",
      spaceId: "space-1",
      stageDurationMs: 250,
      status: "succeeded",
      statusCode: null,
      submissionId: "submission-1",
      triggerSource: "slack",
      workerEnvironment: "prod",
    });

    expect(point.blobs).toHaveLength(
      CENTER_AGENT_PERFORMANCE_ANALYTICS_BLOBS.length
    );
    expect(point.doubles).toHaveLength(
      CENTER_AGENT_PERFORMANCE_ANALYTICS_DOUBLES.length
    );
    expect(point.indexes).toEqual(["org-1"]);
    expect(
      point.blobs[CENTER_AGENT_PERFORMANCE_ANALYTICS_BLOBS.indexOf("modelId")]
    ).toBe("openai/gpt-5.4");
    expect(
      point.blobs[
        CENTER_AGENT_PERFORMANCE_ANALYTICS_BLOBS.indexOf("triggerSource")
      ]
    ).toBe("slack");
  });
});
