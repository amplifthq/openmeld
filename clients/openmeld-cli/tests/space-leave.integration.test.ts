import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpaceLeave } from "../src/space/command";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CURRENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

const resolveOpenMeldProfileOrNullMock = vi.hoisted(() => vi.fn());
const updateProfileSpaceHistoryStatusMock = vi.hoisted(() => vi.fn());
const fetchSpaceRequestWithTimeoutMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const canUseInteractivePromptsMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn());

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

vi.mock("../src/config/resolve-openmeld-profile", () => {
  return {
    resolveOpenMeldProfileOrNull: (...args: unknown[]) =>
      resolveOpenMeldProfileOrNullMock(...args),
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (...args: unknown[]) =>
      getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/config/profile-space-history-api", () => {
  return {
    listProfileSpaceHistory: vi.fn(),
    upsertProfileSpaceHistory: vi.fn(),
    updateProfileSpaceHistoryStatus: (...args: unknown[]) =>
      updateProfileSpaceHistoryStatusMock(...args),
    resolveGatewayHost: vi.fn(() => "gateway.openmeld.invalid"),
    ProfileSpaceHistoryApiError: class ProfileSpaceHistoryApiError extends Error {},
  };
});

vi.mock("../src/space/fetch-with-timeout", () => {
  return {
    fetchSpaceRequestWithTimeout: (...args: unknown[]) =>
      fetchSpaceRequestWithTimeoutMock(...args),
    resolveSpaceRequestTimeoutMsForDiagnostics: vi.fn(() => 10_000),
  };
});

vi.mock("../src/runtime/interaction", () => {
  return {
    canUseInteractivePrompts: (...args: unknown[]) =>
      canUseInteractivePromptsMock(...args),
  };
});

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: (...args: unknown[]) => confirmMock(...args),
    isCancel: (value: unknown) => isCancelMock(value),
    multiselect: vi.fn(),
    password: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
  };
});

describe("space leave", () => {
  beforeEach(() => {
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: "Mira",
        profileKind: "agent",
      })
    );
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
    canUseInteractivePromptsMock.mockReset().mockReturnValue(false);
    isCancelMock.mockReset().mockReturnValue(false);
    confirmMock.mockReset().mockResolvedValue(true);
    updateProfileSpaceHistoryStatusMock.mockReset().mockResolvedValue({
      profileId: CURRENT_PROFILE_ID,
      gatewayHost: "gateway.openmeld.invalid",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-04-29T00:00:00.000Z",
    });
    fetchSpaceRequestWithTimeoutMock.mockReset().mockResolvedValue(
      new Response(
        JSON.stringify({
          leftProfileId: CURRENT_PROFILE_ID,
          status: "left",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("leaves a space in agent view and marks profile-space-history removed", async () => {
    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceLeave({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          view: "agent",
        })
      )
    );

    const leaveRequest = fetchSpaceRequestWithTimeoutMock.mock.calls[0]?.[0] as
      | {
          url?: string;
          operation?: string;
          init?: { method?: string; body?: string };
        }
      | undefined;
    expect(leaveRequest).toMatchObject({
      url: `https://gateway.openmeld.invalid/v1/spaces/${SPACE_ID}/leave`,
      operation: "space.leave",
      init: {
        method: "POST",
      },
    });
    expect(leaveRequest?.init?.body).toBeUndefined();

    expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledWith({
      baseUrl: "https://gateway.openmeld.invalid",
      requestContext: {
        actorContext: {
          requestId: expect.any(String),
          openMeldProfileId: CURRENT_PROFILE_ID,
          profileKind: "agent",
          profileHandle: "Mira",
          profileName: "Mira",
          ownerUserId: "user-felix",
          ownerName: "Felix",
        },
      },
      openMeldProfileId: CURRENT_PROFILE_ID,
      profileName: "Mira",
      spaceId: SPACE_ID,
      body: {
        gatewayHost: "gateway.openmeld.invalid",
        status: "removed",
        reason: "left_space",
      },
    });

    const payload = findAgentPayload(captured.stdout, "space.leave");
    expect(payload).toMatchObject({
      spaceId: SPACE_ID,
      leftProfileId: CURRENT_PROFILE_ID,
      status: "left",
      profileSpaceHistory: {
        updated: true,
        reason: "left_space",
      },
    });
  });

  it("uses the already-absent history reason when Core reports no active membership", async () => {
    fetchSpaceRequestWithTimeoutMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          leftProfileId: CURRENT_PROFILE_ID,
          status: "already_absent",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );

    await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceLeave({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          view: "agent",
        })
      )
    );

    expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          gatewayHost: "gateway.openmeld.invalid",
          status: "removed",
          reason: "leave_space_already_absent",
        },
      })
    );
  });

  it("asks for confirmation in human view before leaving", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);

    await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceLeave({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          view: "human",
        })
      )
    );

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(SPACE_ID),
      })
    );
    expect(fetchSpaceRequestWithTimeoutMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the leave API when human confirmation is declined", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    confirmMock.mockResolvedValueOnce(false);

    const result = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceLeave({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          view: "human",
        })
      )
    );

    expect(result.result).toBe("cancelled");
    expect(fetchSpaceRequestWithTimeoutMock).not.toHaveBeenCalled();
  });
});

function buildProfile(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent";
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    profileHandle: input.profileName,
    status: "active",
    ownerUserId: "user-felix",
    ownerName: "Felix",
    source: "cli_create",
    createdByUserId: "user-felix",
    lastUsedAt: null,
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
  };
}

function findAgentPayload(stdout: string, code: string): unknown {
  const envelope = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as { code?: unknown; payload?: unknown };
      } catch {
        return null;
      }
    })
    .find((item) => item?.code === code);
  return envelope?.payload;
}
