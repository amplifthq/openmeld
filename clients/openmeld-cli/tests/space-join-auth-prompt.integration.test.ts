import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMMAND_AUTH_LOGIN = "__command_auth_login__";
const COMMAND_AUTH_CANCEL = "__command_auth_cancel__";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
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

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: vi.fn(
    async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
      openMeldProfileId: String(openMeldProfileId ?? "mira--space-auth"),
      profileName: "Mira",
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

import { cancel, select } from "@clack/prompts";
import { runSpaceJoin } from "../src/space/command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const EXPLICIT_BASE_URL = "https://gateway.testing.example";
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

describe("space join auth prompt", () => {
  // Drive auth by state, not call order: the entry path reads the session more
  // than once before the sign-in gate, so a positional mockResolvedValueOnce
  // for the "missing" state was being consumed early and the gate never
  // prompted. The session is "missing" until runAuthLogin flips it to valid.
  let isSignedIn = false;

  beforeEach(() => {
    isSignedIn = false;
    getAuthSessionStateMock.mockReset();
    listAccountSpaceIndexMock.mockReset();
    listProfileSpaceHistoryMock.mockReset();
    runAuthLoginMock.mockReset();

    getAuthSessionStateMock.mockImplementation(async () =>
      isSignedIn ? VALID_AUTH_STATE : { state: "missing", session: null }
    );
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [],
    });
    listProfileSpaceHistoryMock.mockResolvedValue([]);
    runAuthLoginMock.mockImplementation(() => {
      isSignedIn = true;
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prompts for sign-in first and then continues join flow", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce(COMMAND_AUTH_LOGIN);
    selectMock.mockResolvedValueOnce("back");

    const { result, stdout } = await withTempHome(async () => {
      return await withCapturedStdio(async () => {
        return await runSpaceJoin({
          profile: "mira--space-auth",
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });
    expect(result).toBe("back");
    expect(stdout).toContain("Sign In Needed");
    expect(stdout).toContain("What happened: Sign in before joining a space.");
    expect(stdout).toContain("Next: Choose Sign in now to continue.");
    expect(selectMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
    expect(selectMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: expect.stringContaining("No spaces yet"),
      })
    );
    expect(runAuthLoginMock).toHaveBeenCalledWith({
      view: "human",
    });
    // After sign-in the join flow loads known spaces from the server
    // Space-Index projection in a single call (no separate active/removed
    // profile-history fan-out); the legacy read source is no longer used.
    expect(listAccountSpaceIndexMock).toHaveBeenCalledTimes(1);
    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "profile",
        selectedProfileId: "mira--space-auth",
        limit: 500,
      })
    );
    expect(listProfileSpaceHistoryMock).not.toHaveBeenCalled();
  });

  it("returns cancelled when the user backs out at the sign-in gate", async () => {
    const selectMock = vi.mocked(select);
    const cancelMock = vi.mocked(cancel);
    selectMock.mockResolvedValueOnce(COMMAND_AUTH_CANCEL);

    const result = await withTempHome(async () => {
      return await withSilencedStdio(async () => {
        return await runSpaceJoin({
          profile: "mira--space-auth",
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    expect(result).toBe("cancelled");
    expect(runAuthLoginMock).not.toHaveBeenCalled();
    expect(listAccountSpaceIndexMock).not.toHaveBeenCalled();
    expect(listProfileSpaceHistoryMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });
});
