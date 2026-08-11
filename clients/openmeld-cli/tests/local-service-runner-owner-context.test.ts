import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthSessionStateMock,
  requireOpenMeldProfileMock,
  resolveOpenMeldProfileOrNullMock,
} = vi.hoisted(() => ({
  getAuthSessionStateMock: vi.fn(),
  requireOpenMeldProfileMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
}));

vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: (...args: Parameters<typeof getAuthSessionStateMock>) =>
    getAuthSessionStateMock(...args),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  requireOpenMeldProfile: (
    ...args: Parameters<typeof requireOpenMeldProfileMock>
  ) => requireOpenMeldProfileMock(...args),
  resolveOpenMeldProfileOrNull: (
    ...args: Parameters<typeof resolveOpenMeldProfileOrNullMock>
  ) => resolveOpenMeldProfileOrNullMock(...args),
}));

import { resolveDaemonServiceOwnerContext } from "../src/local-service/carrier/service-runner";

const EXPLICIT_PROFILE = {
  openMeldProfileId: "agt_explicit",
  profileName: "Explicit Agent",
  profileKind: "agent",
  status: "active",
  ownerUserId: "usr_explicit",
  ownerName: "Explicit Owner",
  source: "cloud",
  createdByUserId: "usr_explicit",
  lastUsedAt: null,
  createdAt: "2026-03-11T00:00:00.000Z",
  updatedAt: "2026-03-11T00:00:00.000Z",
} as const;

const FALLBACK_PROFILE = {
  openMeldProfileId: "agt_fallback",
  profileName: "Fallback Agent",
  profileKind: "agent",
  status: "active",
  ownerUserId: "usr_fallback",
  ownerName: "Fallback Owner",
  source: "cloud",
  createdByUserId: "usr_fallback",
  lastUsedAt: null,
  createdAt: "2026-03-11T00:00:00.000Z",
  updatedAt: "2026-03-11T00:00:00.000Z",
} as const;

describe("local service runner owner context", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    requireOpenMeldProfileMock.mockReset();
    resolveOpenMeldProfileOrNullMock.mockReset();
  });

  it("uses the signed-in auth session when no profile override is provided", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.example.com",
        clientId: "cli",
        createdAt: "2026-03-11T00:00:00.000Z",
        user: {
          id: "usr_auth",
          name: "Auth Owner",
        },
      },
    });

    const result = await resolveDaemonServiceOwnerContext({});

    expect(result).toEqual({
      ownerUserId: "usr_auth",
      ownerName: "Auth Owner",
      openMeldProfile: null,
    });
    expect(requireOpenMeldProfileMock).not.toHaveBeenCalled();
    expect(resolveOpenMeldProfileOrNullMock).not.toHaveBeenCalled();
  });

  it("uses an explicit profile override when one is provided", async () => {
    requireOpenMeldProfileMock.mockResolvedValue(EXPLICIT_PROFILE);

    const result = await resolveDaemonServiceOwnerContext({
      openMeldProfileId: "agt_explicit",
    });

    expect(result).toEqual({
      ownerUserId: "usr_explicit",
      ownerName: "Explicit Owner",
      openMeldProfile: EXPLICIT_PROFILE,
    });
    expect(requireOpenMeldProfileMock).toHaveBeenCalledWith({
      openMeldProfileId: "agt_explicit",
      persistSelection: false,
      authAction: "starting OpenMeld Service",
    });
    expect(getAuthSessionStateMock).not.toHaveBeenCalled();
  });

  it("falls back to a resolved OpenMeld profile when auth is valid but missing user id", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        accessToken: "token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.example.com",
        clientId: "cli",
        createdAt: "2026-03-11T00:00:00.000Z",
        user: {
          name: "Auth Owner",
        },
      },
    });
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(FALLBACK_PROFILE);

    const result = await resolveDaemonServiceOwnerContext({});

    expect(result).toEqual({
      ownerUserId: "usr_fallback",
      ownerName: "Fallback Owner",
      openMeldProfile: FALLBACK_PROFILE,
    });
    expect(resolveOpenMeldProfileOrNullMock).toHaveBeenCalledWith({
      allowDefaultFallback: true,
      allowUnauthenticated: false,
      persistSelection: false,
    });
  });

  it("fails with auth_required when no auth session or fallback profile is available", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "missing",
      session: null,
    });
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);

    await expect(resolveDaemonServiceOwnerContext({})).rejects.toMatchObject({
      code: "daemon.run.auth_required",
    });
  });
});
