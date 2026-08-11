import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpaceJoin } from "../src/space/command";
import { withSilencedStdio, withTempHome } from "./helpers/fs";
import { createSpaceMetaFixture } from "./helpers/space-meta-fixture";

const runConnectMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());
const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
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
    password: (input: unknown) => passwordPromptMock(input),
    select: vi.fn(() => "no"),
    text: vi.fn(),
  };
});

vi.mock("../src/runtime/context", () => {
  return {
    parseCliViewMode: vi.fn(),
    resolveRuntimeContext: vi.fn(async () => ({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    })),
  };
});

vi.mock("../src/space/connect", () => {
  return {
    runConnect: (...args: Parameters<typeof runConnectMock>) =>
      runConnectMock(...args),
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

vi.mock("../src/config/openmeld-profiles-api", () => {
  return {
    listOpenMeldProfiles: (
      ...args: Parameters<typeof listOpenMeldProfilesMock>
    ) => listOpenMeldProfilesMock(...args),
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
  const profile = {
    openMeldProfileId: "mira--join-password",
    profileName: "Mira",
    profileKind: "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  } as const;
  return {
    requireOpenMeldProfile: vi.fn(async () => profile),
    resolveOpenMeldProfileOrNull: vi.fn(async () => profile),
  };
});

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("space join password retry (human tty)", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
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
    listOpenMeldProfilesMock.mockResolvedValue([]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith(`/spaces/${SPACE_ID}/meta`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify(createSpaceMetaFixture({ spaceId: SPACE_ID })),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }
      throw new Error(`unexpected fetch call: ${url.toString()}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    runConnectMock.mockReset();
    passwordPromptMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
    getAuthSessionStateMock.mockReset();
  });

  it("prompts password and retries when join fails with password required", async () => {
    runConnectMock
      .mockRejectedValueOnce(
        new Error(
          'HTTP 401: {"ok":false,"error":{"code":"upstream_error","message":"space password required"}}'
        )
      )
      .mockResolvedValueOnce(undefined);
    passwordPromptMock.mockResolvedValueOnce("abc123");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "mira--join-password",
          view: "human",
          space: SPACE_ID,
        });
      });
    });

    expect(passwordPromptMock).toHaveBeenCalledTimes(1);
    expect(runConnectMock).toHaveBeenCalledTimes(2);
    const firstCall = runConnectMock.mock.calls[0]?.[0] as
      | { password?: string }
      | undefined;
    const secondCall = runConnectMock.mock.calls[1]?.[0] as
      | { password?: string }
      | undefined;
    expect(firstCall?.password).toBeUndefined();
    expect(secondCall?.password).toBe("abc123");
  });

  it("re-prompts when password is invalid and succeeds after retry", async () => {
    runConnectMock
      .mockRejectedValueOnce(
        new Error(
          'HTTP 401: {"ok":false,"error":{"code":"space.password_required","message":"space password required"}}'
        )
      )
      .mockRejectedValueOnce(
        new Error(
          'HTTP 403: {"ok":false,"error":{"code":"space.password_invalid","message":"space password invalid"}}'
        )
      )
      .mockResolvedValueOnce(undefined);
    passwordPromptMock
      .mockResolvedValueOnce("wrong-password")
      .mockResolvedValueOnce("correct-password");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "mira--join-password",
          view: "human",
          space: SPACE_ID,
        });
      });
    });

    expect(passwordPromptMock).toHaveBeenCalledTimes(2);
    expect(runConnectMock).toHaveBeenCalledTimes(3);
    const thirdCall = runConnectMock.mock.calls[2]?.[0] as
      | { password?: string }
      | undefined;
    expect(thirdCall?.password).toBe("correct-password");
  });
});
