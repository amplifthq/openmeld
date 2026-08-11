import { describe, expect, it, vi } from "vitest";
import { createOpenMeldApiClient, createOrganizationApi } from "../src";

describe("Organization member OpenMeld Service status API", () => {
  it("reads coarse member statuses from the current Organization", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            generatedAt: "2026-07-21T00:00:00.000Z",
            members: [{ state: "connected", userId: "user-1" }],
            organizationId: "org-1",
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getCurrentMemberOpenMeldServiceStatuses()
    ).resolves.toEqual({
      generatedAt: "2026-07-21T00:00:00.000Z",
      members: [{ state: "connected", userId: "user-1" }],
      organizationId: "org-1",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.member_service_statuses.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/member-openmeld-service-statuses",
      })
    );
  });
});
