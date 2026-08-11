import { describe, expect, it, vi } from "vitest";
import {
  createLocalRuntimeExpectedRoutesApi,
  createOpenMeldApiClient,
} from "../src";

function createResolvedResponse() {
  return {
    excludedProfiles: [],
    expectedRoutes: [],
    generatedAt: "2026-07-28T00:00:00.000Z",
    runtimeResolution: "resolved" as const,
    openMeldServiceRuntimeId: "runtime-1",
  };
}

describe("api-client local runtime expected-routes api", () => {
  it("requests the negotiated v2 projection explicitly", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(createResolvedResponse()), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      )
    );
    const api = createLocalRuntimeExpectedRoutesApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.getExpectedRoutes({
      contractVersion: "v2",
      deviceId: "device-1",
      lane: "prod",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "local_runtime.expected_routes.read",
        url: "https://gateway.openmeld.invalid/v1/local-runtime/expected-routes?contractVersion=v2&deviceId=device-1&lane=prod",
      })
    );
  });

  it("keeps the legacy request shape available for mixed-version fallback", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(createResolvedResponse()), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      )
    );
    const api = createLocalRuntimeExpectedRoutesApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.getExpectedRoutes({
      deviceId: "device-1",
      lane: "prod",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtime/expected-routes?deviceId=device-1&lane=prod",
      })
    );
  });
});
