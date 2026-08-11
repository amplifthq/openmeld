import { getPrepareReadinessResponseSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createOpenMeldApiClient, createPrepareReadinessApi } from "../src";

describe("api-client prepare readiness api", () => {
  it("reads Prepare readiness through the canonical read-only route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            agentControllerReportsRead: true,
            nonRunnableCapabilities: [],
            projection: {
              allRunnableCapabilitiesPrepared: {
                status: "prepared",
              },
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
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
            status: "ready",
            summary: {
              displayState: "ready",
              ready: true,
              reasonCodes: ["runtime.ready"],
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          }
        )
      )
    );
    const api = createPrepareReadinessApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getReadiness({
      agentControllerRefs: ["builtin:codex", "custom:local-agent"],
      deviceId: "device-macbook-pro",
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: "runtime_opaque_1",
    });

    expect(result.status).toBe("ready");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "prepare_readiness.read",
        url: "https://gateway.openmeld.invalid/v1/devices/device-macbook-pro/prepare-readiness?lane=openmeld-dev&openMeldServiceRuntimeId=runtime_opaque_1&agentControllerRef=builtin%3Acodex&agentControllerRef=custom%3Alocal-agent",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("uses the shared Prepare readiness response schema", () => {
    expect(getPrepareReadinessResponseSchema).toBeDefined();
  });
});
