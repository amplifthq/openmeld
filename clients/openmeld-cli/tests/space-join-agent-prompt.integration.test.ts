import { afterEach, describe, expect, it, vi } from "vitest";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const fetchSpaceMetaMock = vi.hoisted(() => vi.fn());
const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    select: vi.fn(),
    text: vi.fn(
      async () =>
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ),
  };
});

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

vi.mock("../src/config/profile-space-history-api", () => {
  class ProfileSpaceHistoryApiError extends Error {
    readonly status: number | null;
    readonly code: string | null;
    readonly endpoint: string;
    readonly canFallbackToLocal: boolean;

    constructor(input: {
      message: string;
      endpoint: string;
      status?: number | null;
      code?: string | null;
      canFallbackToLocal?: boolean;
    }) {
      super(input.message);
      this.name = "ProfileSpaceHistoryApiError";
      this.status = input.status ?? null;
      this.code = input.code ?? null;
      this.endpoint = input.endpoint;
      this.canFallbackToLocal = input.canFallbackToLocal === true;
    }
  }

  return {
    ProfileSpaceHistoryApiError,
    listProfileSpaceHistory: vi.fn(async () => []),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const toProfile = (openMeldProfileId: string) =>
    ({
      openMeldProfileId,
      profileName: "Codex",
      profileKind: "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    }) as const;
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
import { runSpaceJoin } from "../src/space/command";
import { runConnect } from "../src/space/connect";
import { withSilencedStdio, withTempHome } from "./helpers/fs";

describe("space join agent prompt override", () => {
  const readyPreflight = {
    deviceReplyReadiness: {
      reasonCodes: [],
      reasonText: "Ready",
      replyReadiness: "ready" as const,
      updatedAt: "2026-04-11T00:00:00.000Z",
      wakeableRouteCount: 1,
    },
    payload: {},
    serviceParticipationReadiness: {
      serviceReadiness: "ready" as const,
      summaryText: "Ready",
      detailText:
        "OpenMeld Service is running and the local service link is available on this device",
      nextStepSummary: null,
      nextSteps: [],
      runtimeHeadline: "running",
    },
  };

  afterEach(() => {
    vi.clearAllMocks();
    getAuthSessionStateMock.mockReset();
    fetchSpaceMetaMock.mockReset();
    emitSpaceCommandPreflightMock.mockReset();
  });

  it("requires explicit space target in agent view even when prompting is enabled", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      emitSpaceCommandPreflightMock.mockResolvedValue(readyPreflight);
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--aaaaaaaa",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await expect(
        runSpaceJoin({
          profile: "codex--aaaaaaaa",
          view: "agent",
          allowPrompt: true,
          output: "text",
        })
      ).rejects.toMatchObject({
        code: "space.join.target.required",
      });

      expect(runConnect).not.toHaveBeenCalled();
    });
  });

  it("does not try manual prompt fallback when agent target is missing", async () => {
    const prompts = await import("@clack/prompts");
    const textMock = vi.mocked(prompts.text);

    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      emitSpaceCommandPreflightMock.mockResolvedValue(readyPreflight);
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--bbbbbbbb",
          profileId: "bbbbbbbb-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await expect(
        runSpaceJoin({
          profile: "codex--bbbbbbbb",
          view: "agent",
          allowPrompt: true,
          output: "text",
        })
      ).rejects.toMatchObject({
        code: "space.join.target.required",
      });

      expect(textMock).not.toHaveBeenCalled();
      expect(runConnect).not.toHaveBeenCalled();
    });
  });

  it("passes through localEcho=true when agent view already has an explicit target", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      emitSpaceCommandPreflightMock.mockResolvedValue(readyPreflight);
      fetchSpaceMetaMock.mockResolvedValueOnce({
        spaceId:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        passwordProtected: false,
      });
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--cccccccc",
          profileId: "cccccccc-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await runSpaceJoin({
        profile: "codex--cccccccc",
        view: "agent",
        allowPrompt: true,
        output: "text",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        localEcho: true,
      });

      expect(runConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: "codex--cccccccc",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          stdio: false,
          localEcho: true,
          connectionMode: "join",
        })
      );
    });
  });

  it("keeps agent cancellation path on the explicit-target guard", async () => {
    const prompts = await import("@clack/prompts");
    const textMock = vi.mocked(prompts.text);
    const cancelMock = vi.mocked(prompts.cancel);

    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      emitSpaceCommandPreflightMock.mockResolvedValue(readyPreflight);
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--dddddddd",
          profileId: "dddddddd-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await expect(
        runSpaceJoin({
          profile: "codex--dddddddd",
          view: "agent",
          allowPrompt: true,
          output: "text",
        })
      ).rejects.toMatchObject({
        code: "space.join.target.required",
      });

      expect(textMock).not.toHaveBeenCalled();
      expect(runConnect).not.toHaveBeenCalled();
      expect(cancelMock).not.toHaveBeenCalled();
    });
  });
});
