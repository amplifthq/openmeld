import { describe, expect, it, vi } from "vitest";
import {
  buildOrganizationUsageOverviewPath,
  createOpenMeldApiClient,
  createOrganizationUsageApi,
  type OpenMeldApiClientTransport,
} from "../src";

describe("api-client Organization Usage API", () => {
  it("reads the strict current Organization overview", async () => {
    expect(buildOrganizationUsageOverviewPath()).toBe(
      "/v1/organizations/current/usage/overview"
    );
    const url =
      "https://gateway.openmeld.invalid/v1/organizations/current/usage/overview";
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        jsonResponse({
          aiSpend: {
            dailyLimitNanoUsd: null,
            resetsAt: "2026-07-17T00:00:00.000Z",
            usedNanoUsd: 120_000_000,
            missingCostRequests: 0,
            exhausted: false,
          },
          routines: {
            count: 7,
            limit: 50,
          },
        })
      )
    );
    const api = createOrganizationUsageApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(api.readOverview()).resolves.toMatchObject({
      aiSpend: { usedNanoUsd: 120_000_000 },
      routines: { count: 7 },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "organization_usage.overview.read",
        url,
      })
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
