import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticationError } from "../src/auth/auth-guidance";
import {
  isSelectedOpenMeldProfileRequiredError,
  requireOpenMeldProfile,
  resolveOpenMeldProfileOrNull,
} from "../src/config/resolve-openmeld-profile";

vi.mock("../src/config/openmeld-profile-selection", () => {
  return {
    clearSelectedOpenMeldProfileId: vi.fn(),
    getSelectedOpenMeldProfileId: vi.fn(),
    setSelectedOpenMeldProfileId: vi.fn(),
  };
});

vi.mock("../src/config/openmeld-profiles-api", () => {
  return {
    resolveOpenMeldProfile: vi.fn(),
    resolveOpenMeldProfileByIdOrName: vi.fn(),
  };
});

vi.mock("../src/config/auth-session", () => {
  return {
    getAuthSessionState: vi.fn(),
  };
});

import { getAuthSessionState } from "../src/config/auth-session";
import { getSelectedOpenMeldProfileId } from "../src/config/openmeld-profile-selection";
import {
  resolveOpenMeldProfile,
  resolveOpenMeldProfileByIdOrName,
} from "../src/config/openmeld-profiles-api";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

describe("resolve OpenMeld profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSelectedOpenMeldProfileId).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not fall back to remote default profile unless explicitly enabled", async () => {
    const profile = await resolveOpenMeldProfileOrNull();

    expect(profile).toBeNull();
    expect(resolveOpenMeldProfile).not.toHaveBeenCalled();
  });

  it("allows explicit remote default fallback when requested", async () => {
    vi.mocked(resolveOpenMeldProfile).mockResolvedValueOnce(
      createTestOpenMeldProfile({
        openMeldProfileId: "hum_felix",
        profileName: "Felix",
        profileKind: "human",
        source: "cloud_default",
        createdAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
      })
    );

    const profile = await resolveOpenMeldProfileOrNull({
      profileKind: "human",
      allowDefaultFallback: true,
    });

    expect(profile?.openMeldProfileId).toBe("hum_felix");
    expect(resolveOpenMeldProfile).toHaveBeenCalledWith({
      profileKind: "human",
    });
  });

  it("returns null for an explicit profile id when local auth is stale and unauthenticated fallback is allowed", async () => {
    vi.mocked(resolveOpenMeldProfileByIdOrName).mockRejectedValueOnce(
      createAuthenticationError({
        reason: "expired",
      })
    );

    const profile = await resolveOpenMeldProfileOrNull({
      openMeldProfileId: "agt_local",
      allowUnauthenticated: true,
    });

    expect(profile).toBeNull();
  });

  it("keeps explicit profile lookup strict when unauthenticated fallback is not allowed", async () => {
    const authError = createAuthenticationError({
      reason: "expired",
    });
    vi.mocked(resolveOpenMeldProfileByIdOrName).mockRejectedValueOnce(
      authError
    );

    await expect(
      resolveOpenMeldProfileOrNull({
        openMeldProfileId: "agt_local",
      })
    ).rejects.toBe(authError);
  });

  it("reports profile-required when auth is valid but no profile is selected", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValueOnce({
      state: "valid",
      session: {
        v: 1,
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli-dev",
        createdAt: "2026-03-06T00:00:00.000Z",
      },
    });

    await expect(requireOpenMeldProfile()).rejects.toThrow(
      "no OpenMeld profile is selected for this terminal session yet"
    );
    expect(resolveOpenMeldProfile).not.toHaveBeenCalled();
  });

  it("explains the acting-profile requirement for dispatch trace", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValueOnce({
      state: "valid",
      session: {
        v: 1,
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli-dev",
        createdAt: "2026-03-06T00:00:00.000Z",
      },
    });

    let thrown: unknown = null;
    try {
      await requireOpenMeldProfile({
        authAction: "reading a dispatch trace",
      });
    } catch (error) {
      thrown = error;
    }

    expect(isSelectedOpenMeldProfileRequiredError(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      "dispatch trace needs an acting profile"
    );
    expect((thrown as Error).message).toContain(
      "`--target-profile` only identifies the agent being traced"
    );
  });

  it("reports login-required when auth is missing", async () => {
    vi.mocked(getAuthSessionState).mockResolvedValueOnce({
      state: "missing",
      session: null,
    });

    await expect(requireOpenMeldProfile()).rejects.toThrow(
      "sign-in required; run `openmeld login`"
    );
    expect(resolveOpenMeldProfile).not.toHaveBeenCalled();
  });

  it("renders openmeld-dev login guidance when the dev shortcut is active", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    vi.mocked(getAuthSessionState).mockResolvedValueOnce({
      state: "missing",
      session: null,
    });

    await expect(requireOpenMeldProfile()).rejects.toThrow(
      "sign-in required; run `openmeld-dev login`"
    );
  });

  it("recognizes selected-profile-required errors after openmeld-dev command formatting", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    vi.mocked(getAuthSessionState).mockResolvedValueOnce({
      state: "valid",
      session: {
        v: 1,
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli-dev",
        createdAt: "2026-03-06T00:00:00.000Z",
      },
    });

    let thrown: unknown = null;
    try {
      await requireOpenMeldProfile();
    } catch (error) {
      thrown = error;
    }

    expect(isSelectedOpenMeldProfileRequiredError(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("run `openmeld-dev start`");
  });
});
