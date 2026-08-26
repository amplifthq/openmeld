import { afterEach, describe, expect, it, vi } from "vitest";
import { setAuthSession } from "../src/config/auth-session";
import {
  createOpenMeldHumanProfile,
  getOpenMeldProfileCapabilities,
  listOpenMeldProfiles,
  primeOpenMeldProfilesSessionCache,
  resetOpenMeldProfilesSessionCacheForTests,
} from "../src/config/openmeld-profiles-api";
import { withTempHome } from "./helpers/fs";

const AUTH_SESSION = {
  v: 1 as const,
  accessToken: "token-1",
  tokenType: "Bearer",
  authBaseUrl: "https://auth.openmeld.invalid",
  clientId: "openmeld-cli",
  createdAt: "2026-07-16T00:00:00.000Z",
};

describe("OpenMeld Profiles API capability", () => {
  afterEach(() => {
    resetOpenMeldProfilesSessionCacheForTests();
    vi.unstubAllGlobals();
  });

  it("reads the strict Auth-owned creation capability", async () => {
    await withAuthenticatedTempHome(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({
            ok: true,
            additionalHumanProfileCreationEnabled: false,
          })
        )
      );

      await expect(getOpenMeldProfileCapabilities()).resolves.toEqual({
        ok: true,
        additionalHumanProfileCreationEnabled: false,
      });
    });
  });

  it("preserves an Agent Profile Default Project from Auth", async () => {
    await withAuthenticatedTempHome(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({
            ok: true,
            profiles: [
              {
                createdAt: "2026-08-20T00:00:00.000Z",
                defaultProjectId: "project-1",
                openMeldProfileId: "agt_profile_1",
                ownerUserId: "user-1",
                profileHandle: "research-agent",
                profileKind: "agent",
                profileName: "Research Agent",
                source: "web_create",
                status: "active",
                updatedAt: "2026-08-20T00:00:00.000Z",
              },
            ],
          })
        )
      );

      await expect(listOpenMeldProfiles()).resolves.toEqual([
        expect.objectContaining({
          defaultProjectId: "project-1",
          openMeldProfileId: "agt_profile_1",
        }),
      ]);
    });
  });

  it("fails closed when the capability response is incomplete", async () => {
    await withAuthenticatedTempHome(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
      );

      await expect(getOpenMeldProfileCapabilities()).rejects.toThrow(
        "invalid profile capabilities payload"
      );
    });
  });

  it("does not send a Human creation request when the capability is disabled", async () => {
    await withAuthenticatedTempHome(async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          additionalHumanProfileCreationEnabled: false,
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        createOpenMeldHumanProfile({ profileName: "Secondary Human" })
      ).rejects.toMatchObject({
        code: "profile.additional_human_profile_creation_disabled",
        message:
          "Creating additional Human Profiles is currently unavailable. Use your default Human Profile, or create an Agent Profile.",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        String(fetchMock.mock.calls[0]?.[0]).endsWith(
          "/v1/profiles/capabilities"
        )
      ).toBe(true);
    });
  });

  it("parses the shared Auth error envelope for a rejected Human creation", async () => {
    await withAuthenticatedTempHome(async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            ok: true,
            additionalHumanProfileCreationEnabled: true,
          })
        )
        .mockResolvedValueOnce(
          jsonResponse(
            {
              code: "profile.additional_human_profile_creation_disabled",
              message:
                "Creating additional Human Profiles is currently unavailable. Use your default Human Profile, or create an Agent Profile.",
              ok: false,
            },
            409
          )
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        createOpenMeldHumanProfile({ profileName: "Secondary Human" })
      ).rejects.toMatchObject({
        code: "profile.additional_human_profile_creation_disabled",
        message:
          "Creating additional Human Profiles is currently unavailable. Use your default Human Profile, or create an Agent Profile.",
        status: 409,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

async function withAuthenticatedTempHome(
  operation: () => Promise<void>
): Promise<void> {
  await withTempHome(async () => {
    process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
    await setAuthSession(AUTH_SESSION);
    primeOpenMeldProfilesSessionCache(AUTH_SESSION);
    await operation();
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
