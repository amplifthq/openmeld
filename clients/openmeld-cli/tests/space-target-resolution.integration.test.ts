import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const fetchSpaceMetaMock = vi.hoisted(() => vi.fn());
const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());

vi.mock("../src/space/connect", () => {
  return {
    runConnect: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../src/space/preflight", () => ({
  emitSpaceCommandPreflight: (
    ...args: Parameters<typeof emitSpaceCommandPreflightMock>
  ) => emitSpaceCommandPreflightMock(...args),
  emitResolvedSpaceCommandPreflight: vi.fn(),
  emitSpaceFailureNextStep: vi.fn(),
  resolveSpaceFailureGuidance: vi.fn(),
}));

vi.mock("../src/space/meta-api", () => {
  return {
    fetchSpaceMeta: (...args: unknown[]) => fetchSpaceMetaMock(...args),
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const toProfile = (openMeldProfileId: string) => {
    const isHuman = openMeldProfileId.toLowerCase().includes("mira");
    return {
      openMeldProfileId,
      profileName: isHuman ? "Mira" : "Codex",
      profileKind: isHuman ? "human" : "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    } as const;
  };
  return {
    requireOpenMeldProfile: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "default"))
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "default"))
    ),
  };
});

import { runInit } from "../src/commands/init";
import { runSpaceJoin, runSpaceWatch } from "../src/space/command";
import { runConnect } from "../src/space/connect";
import { upsertSpaceConfig } from "../src/space/local-state";
import { withSilencedStdio, withTempHome } from "./helpers/fs";

const PROFILE = "mira--space-target";
const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const EXPLICIT_GATEWAY_URL = "https://gateway.staging.example";
const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.testing.example",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

function createValidAuthState(authBaseUrl: string) {
  return {
    ...VALID_AUTH_STATE,
    session: {
      ...VALID_AUTH_STATE.session,
      authBaseUrl,
    },
  };
}

describe("space target resolution", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    fetchSpaceMetaMock.mockReset();
    fetchSpaceMetaMock.mockResolvedValue({
      spaceId: SPACE_ID,
      passwordProtected: false,
    });
    emitSpaceCommandPreflightMock.mockReset().mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: [],
        reasonText: "Ready",
        replyReadiness: "ready",
        updatedAt: "2026-04-11T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
      payload: {},
      serviceParticipationReadiness: {
        serviceReadiness: "ready",
        summaryText: "Ready",
        detailText:
          "OpenMeld Service is running and the local service link is available on this device",
        nextStepSummary: null,
        nextSteps: [],
        runtimeHeadline: "running",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getAuthSessionStateMock.mockReset();
    emitSpaceCommandPreflightMock.mockReset();
  });

  it("resolves explicit space id to cached baseUrl for join", async () => {
    getAuthSessionStateMock.mockResolvedValue(
      createValidAuthState("https://auth.internal.example")
    );
    fetchSpaceMetaMock.mockResolvedValueOnce({
      spaceId: SPACE_ID,
      passwordProtected: true,
    });
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE,
          profileId: "profileIdentity-001",
          profileName: "Mira",
          kind: "human",
        });
      });

      await upsertSpaceConfig({
        openMeldProfileId: PROFILE,
        baseUrl: "https://gateway.internal.example",
        space: SPACE_ID,
        name: "spaceship",
        profileName: "Mira",
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: PROFILE,
          view: "human",
          allowPrompt: false,
          space: SPACE_ID,
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: PROFILE,
        baseUrl: "https://gateway.internal.example",
        space: SPACE_ID,
      })
    );
  });

  it("keeps explicit space id for join when --gateway-url is provided", async () => {
    getAuthSessionStateMock.mockResolvedValue(
      createValidAuthState("https://auth.staging.example")
    );
    fetchSpaceMetaMock.mockResolvedValueOnce({
      spaceId: SPACE_ID,
      passwordProtected: true,
    });
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE,
          profileId: "profileIdentity-001",
          profileName: "Mira",
          kind: "human",
        });
      });

      await upsertSpaceConfig({
        openMeldProfileId: PROFILE,
        baseUrl: "https://gateway.internal.example",
        space: SPACE_ID,
        name: "demo",
        profileName: "Mira",
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: PROFILE,
          view: "human",
          allowPrompt: false,
          baseUrl: EXPLICIT_GATEWAY_URL,
          space: SPACE_ID,
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: PROFILE,
        baseUrl: EXPLICIT_GATEWAY_URL,
        space: SPACE_ID,
      })
    );
  });

  it("keeps explicit space id for watch when --gateway-url is provided", async () => {
    getAuthSessionStateMock.mockResolvedValue(
      createValidAuthState("https://auth.staging.example")
    );
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE,
          profileId: "profileIdentity-001",
          profileName: "Mira",
          kind: "human",
        });
      });

      await upsertSpaceConfig({
        openMeldProfileId: PROFILE,
        baseUrl: "https://gateway.internal.example",
        space: SPACE_ID,
        name: "demo",
        profileName: "Mira",
      });

      await withSilencedStdio(async () => {
        await runSpaceWatch({
          profile: PROFILE,
          view: "human",
          baseUrl: EXPLICIT_GATEWAY_URL,
          space: SPACE_ID,
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: PROFILE,
        baseUrl: EXPLICIT_GATEWAY_URL,
        space: SPACE_ID,
      })
    );
  });

  it("uses matched target baseUrl when watch baseUrl input is blank", async () => {
    getAuthSessionStateMock.mockResolvedValue(
      createValidAuthState("https://auth.internal.example")
    );
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE,
          profileId: "profileIdentity-001",
          profileName: "Mira",
          kind: "human",
        });
      });

      await upsertSpaceConfig({
        openMeldProfileId: PROFILE,
        baseUrl: "https://gateway.internal.example",
        space: SPACE_ID,
        name: "demo",
        profileName: "Mira",
      });

      await withSilencedStdio(async () => {
        await runSpaceWatch({
          profile: PROFILE,
          view: "human",
          baseUrl: "   ",
          space: SPACE_ID,
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: PROFILE,
        baseUrl: "https://gateway.internal.example",
        space: SPACE_ID,
      })
    );
  });

  it("rejects non-hex space target such as a plain name", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE,
          profileId: "profileIdentity-001",
          profileName: "Mira",
          kind: "human",
        });
      });

      await expect(
        withSilencedStdio(async () => {
          await runSpaceJoin({
            profile: PROFILE,
            view: "human",
            allowPrompt: false,
            space: "demo",
          });
        })
      ).rejects.toThrow("That Space ID isn't valid");
    });
  });

  it("rejects invalid space id input that is not a 64-char hex id", async () => {
    await expect(
      withTempHome(async () => {
        await withSilencedStdio(async () => {
          await runInit({
            profile: PROFILE,
            profileId: "profileIdentity-001",
            profileName: "Mira",
            kind: "human",
          });
        });

        await withSilencedStdio(async () => {
          await runSpaceJoin({
            profile: PROFILE,
            view: "human",
            allowPrompt: false,
            space: "d816c478afc0cdadf39530c5ddefe11d58a0b6d485db976d09ec7f",
          });
        });
      })
    ).rejects.toThrow("That Space ID isn't valid");
  });
});
