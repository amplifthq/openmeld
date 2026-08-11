import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMMAND_AUTH_LOGIN = "__command_auth_login__";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const resolveOpenMeldProfileByIdOrNameMock = vi.hoisted(() => vi.fn());
const runAuthLoginMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    isCancel: vi.fn((value: unknown) => value === "__cancel__"),
    multiselect: vi.fn(),
    password: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
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

vi.mock("../src/commands/auth", () => ({
  runAuthLogin: (...args: Parameters<typeof runAuthLoginMock>) =>
    runAuthLoginMock(...args),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

vi.mock("../src/config/account-space-index-api", () => ({
  listAccountSpaceIndex: (
    ...args: Parameters<typeof listAccountSpaceIndexMock>
  ) => listAccountSpaceIndexMock(...args),
}));

vi.mock("../src/config/profile-space-history-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/profile-space-history-api")
  >("../src/config/profile-space-history-api");
  return {
    ...actual,
    listProfileSpaceHistory: (
      ...args: Parameters<typeof listProfileSpaceHistoryMock>
    ) => listProfileSpaceHistoryMock(...args),
  };
});

vi.mock("../src/config/openmeld-profiles-api", () => ({
  resolveOpenMeldProfileByIdOrName: (
    ...args: Parameters<typeof resolveOpenMeldProfileByIdOrNameMock>
  ) => resolveOpenMeldProfileByIdOrNameMock(...args),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: vi.fn(
    async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
      openMeldProfileId: String(openMeldProfileId ?? "mira-space-list"),
      profileName: "Mira",
      profileHandle: "mira",
      profileKind: "human",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    })
  ),
}));

import { select } from "@clack/prompts";
import { runSpaceList } from "../src/space/command";
import { withSilencedStdio, withTempHome } from "./helpers/fs";

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

describe("space list auth prompt", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    listAccountSpaceIndexMock.mockReset();
    listProfileSpaceHistoryMock.mockReset();
    resolveOpenMeldProfileByIdOrNameMock.mockReset();
    runAuthLoginMock.mockReset();

    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [],
    });
    listProfileSpaceHistoryMock.mockResolvedValue([]);
    resolveOpenMeldProfileByIdOrNameMock.mockResolvedValue({
      openMeldProfileId: "mira-space-list",
      profileName: "Mira",
      profileHandle: "mira",
      profileKind: "human",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    });
    runAuthLoginMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prompts for sign-in before listing spaces", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce(COMMAND_AUTH_LOGIN);
    getAuthSessionStateMock
      .mockResolvedValueOnce({
        state: "missing",
        session: null,
      })
      .mockResolvedValueOnce(VALID_AUTH_STATE);

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceList({
          profile: "mira-space-list",
          baseUrl: "https://gateway.testing.example",
          limit: 20,
          view: "human",
        });
      });
    });

    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
    expect(runAuthLoginMock).toHaveBeenCalledWith({
      view: "human",
    });
    expect(listAccountSpaceIndexMock).toHaveBeenCalledTimes(1);
    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        scope: "profile",
        selectedProfileId: "mira-space-list",
      })
    );
    expect(listProfileSpaceHistoryMock).not.toHaveBeenCalled();
  });
});
