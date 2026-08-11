import { describe, expect, it } from "vitest";
import {
  getPrepareReadinessQuerySchema,
  getPrepareReadinessResponseSchema,
  prepareReadinessRouteParamsSchema,
} from "../../src";

describe("prepare readiness http schemas", () => {
  it("accepts a read-only query and explicit readiness evidence response", () => {
    expect(
      prepareReadinessRouteParamsSchema.safeParse({
        deviceId: "device-123",
      }).success
    ).toBe(true);

    expect(
      getPrepareReadinessQuerySchema.safeParse({
        agentControllerRefs: ["builtin:codex", "custom:local-agent"],
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      }).success
    ).toBe(true);

    const response = getPrepareReadinessResponseSchema.parse({
      agentControllerReportsRead: true,
      nonRunnableCapabilities: [
        {
          agentControllerRef: "builtin:claude-code",
          expiresAtMs: 2000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report_disabled"],
          status: "disabled",
        },
      ],
      projection: {
        allRunnableCapabilitiesPrepared: {
          status: "partial",
        },
        projectionStatus: "needs_prepare",
        reasonCodes: ["runtime.agent_controller_report_disabled"],
      },
      reason: "runtime_not_ready",
      runnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.ready"],
          status: "ready",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "not_ready",
      summary: {
        displayState: "needs_prepare",
        ready: false,
        reasonCodes: ["runtime.agent_controller_report_disabled"],
      },
    });

    expect(response.openMeldServiceRuntimeId?.source).toBe(
      "runtime_registry_authority"
    );
    expect(response.runnableCapabilities).toHaveLength(1);
    expect(response.nonRunnableCapabilities).toHaveLength(1);
  });

  it("rejects owner or caller identity in the read query and non-authority openMeldServiceRuntimeId in the response", () => {
    const validQuery = {
      agentControllerRefs: ["builtin:codex"],
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: "runtime_opaque_1",
    };

    expect(
      getPrepareReadinessQuerySchema.safeParse({
        ...validQuery,
        callerPrincipalId: "principal-1",
        ownerId: "owner-1",
      }).success
    ).toBe(false);

    expect(
      getPrepareReadinessResponseSchema.safeParse({
        agentControllerReportsRead: false,
        nonRunnableCapabilities: [],
        projection: {
          projectionStatus: "unknown",
          reasonCodes: ["runtime.id_invalid"],
        },
        reason: "openmeld_service_runtime_id_invalid",
        runnableCapabilities: [],
        openMeldServiceRuntimeId: {
          source: "caller_supplied",
          value: "runtime_opaque_1",
        },
        status: "not_ready",
        summary: {
          displayState: "unknown",
          ready: false,
          reasonCodes: ["runtime.id_invalid"],
        },
      }).success
    ).toBe(false);
  });

  it("rejects a ready response without authority openMeldServiceRuntimeId evidence", () => {
    expect(
      getPrepareReadinessResponseSchema.safeParse({
        agentControllerReportsRead: true,
        nonRunnableCapabilities: [],
        projection: {
          projectionStatus: "ready",
          reasonCodes: [],
        },
        runnableCapabilities: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs: 5000,
            observedAtMs: 1000,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
        status: "ready",
        summary: {
          displayState: "ready",
          ready: true,
          reasonCodes: [],
        },
      }).success
    ).toBe(false);
  });
});
