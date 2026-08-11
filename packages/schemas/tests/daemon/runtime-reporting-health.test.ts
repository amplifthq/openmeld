import { describe, expect, it } from "vitest";
import { runtimeReportingHealthStateSchema } from "../../src/index";

describe("runtime reporting health schema", () => {
  it("accepts independent health for both reporting channels", () => {
    const result = runtimeReportingHealthStateSchema.safeParse({
      schema: "openmeld-runtime-reporting-health-v1",
      v: 1,
      runtimeAgentController: {
        lastSuccessAt: "2026-07-10T01:00:00.000Z",
        consecutiveFailures: 2,
        lastFailure: {
          at: "2026-07-10T01:05:00.000Z",
          reasonCode: "authentication_required",
          message: "authentication required",
        },
      },
      providerConversationProof: {
        lastSuccessAt: null,
        consecutiveFailures: 0,
        lastFailure: null,
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts service identity and explicit channel applicability", () => {
    const result = runtimeReportingHealthStateSchema.safeParse({
      schema: "openmeld-runtime-reporting-health-v1",
      v: 1,
      serviceIdentity: {
        contractGeneration: 4,
        deviceId: "device-4",
      },
      serviceIdentityObservedAt: "2026-07-10T01:00:00.000Z",
      runtimeAgentController: {
        applicability: {
          observedAt: "2026-07-10T01:00:00.000Z",
          status: "applicable",
        },
        lastSuccessAt: "2026-07-10T01:00:00.000Z",
        consecutiveFailures: 0,
        lastFailure: null,
      },
      providerConversationProof: {
        applicability: {
          observedAt: "2026-07-10T01:00:00.000Z",
          status: "not_applicable",
        },
        lastSuccessAt: null,
        consecutiveFailures: 0,
        lastFailure: null,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects partial state and negative failure counts", () => {
    const result = runtimeReportingHealthStateSchema.safeParse({
      schema: "openmeld-runtime-reporting-health-v1",
      v: 1,
      runtimeAgentController: {
        lastSuccessAt: null,
        consecutiveFailures: -1,
        lastFailure: null,
      },
    });

    expect(result.success).toBe(false);
  });
});
