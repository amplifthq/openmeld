import { describe, expect, it, vi } from "vitest";
import { createOpenMeldApiClient, createProfilesApi } from "../src";

const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("api-client profiles api", () => {
  it("renames a profile through the Auth profiles route", async () => {
    const transport = vi.fn((_: { init?: RequestInit }) =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          profile: profilePayload({
            profileName: "After Rename",
          }),
        })
      )
    );
    const api = createProfilesApi(
      createOpenMeldApiClient({
        baseUrl: "https://auth.openmeld.invalid",
        transport,
      })
    );

    const result = await api.rename({
      profileId: PROFILE_ID,
      profileName: "After Rename",
    });

    expect(result.profile.profileName).toBe("After Rename");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            profileName: "After Rename",
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "PATCH",
        }),
        operation: "profile.rename",
        url: `https://auth.openmeld.invalid/v1/profiles/${encodeURIComponent(PROFILE_ID)}`,
      })
    );
  });

  it("rejects empty rename input before sending a request", async () => {
    const transport = vi.fn();
    const api = createProfilesApi(
      createOpenMeldApiClient({
        baseUrl: "https://auth.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.rename({
        profileId: PROFILE_ID,
        profileName: " ",
      })
    ).rejects.toThrow("profileName is required");
    expect(transport).not.toHaveBeenCalled();
  });

  it("updates an Agent Profile Default Project through Core", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          profile: {
            ...profilePayload({ profileName: "Research Agent" }),
            defaultProjectId: "project-1",
          },
        })
      )
    );
    const api = createProfilesApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.updateDefaultProject({
      defaultProjectId: "project-1",
      expectedOrganizationId: "org-1",
      profileId: PROFILE_ID,
    });

    expect(result.profile.defaultProjectId).toBe("project-1");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            expectedOrganizationId: "org-1",
            defaultProjectId: "project-1",
          }),
          method: "PATCH",
        }),
        operation: "profile.updateDefaultProject",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(PROFILE_ID)}/default-project`,
      })
    );
  });
});

function profilePayload(input: { profileName: string }) {
  return {
    openMeldProfileId: PROFILE_ID,
    profileName: input.profileName,
    profileHandle: "after-rename",
    profileKind: "agent",
    isDefault: false,
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    managedRole: null,
    createdByUserId: "user-1",
    creatorProfileId: null,
    lastUsedAt: null,
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
