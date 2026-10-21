import { resolveProfileResponseSchema } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const { getAuthSessionStateMock, runAuthLoginMock, selectPromptMock } =
  vi.hoisted(() => ({
    getAuthSessionStateMock: vi.fn(),
    runAuthLoginMock: vi.fn(),
    selectPromptMock: vi.fn(),
  }));
const UNAVAILABLE_JSON_MESSAGE_RE =
  /saved sign-in is unavailable.*macOS Keychain helper timed out after 5000ms/u;

vi.mock("@clack/prompts", async () => {
  const actual =
    await vi.importActual<typeof import("@clack/prompts")>("@clack/prompts");
  return {
    ...actual,
    select: selectPromptMock,
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
  runAuthLogin: runAuthLoginMock,
}));

import { runSignInCheck } from "../src/command-entry-checks/check-sign-in";
import { resetCurrentCommandCheckState } from "../src/command-entry-checks/current-command-check-state";
import type { CommandEntryContext } from "../src/command-entry-checks/types";
import {
  resetOpenMeldProfilesSessionCacheForTests,
  resolveOpenMeldProfileByIdOrName,
} from "../src/config/openmeld-profiles-api";

describe("sign-in command entry check", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    runAuthLoginMock.mockReset();
    selectPromptMock.mockReset();
    resetCurrentCommandCheckState();
    resetOpenMeldProfilesSessionCacheForTests();
  });

  it.each([
    "macOS Keychain helper could not start",
    "Read access token failed: macOS Keychain denied access (OSStatus -25293). OpenMeld did not open a background authorization window. Reconnect this computer from an interactive setup or login.",
  ])("preserves an unavailable credential's diagnostic: %s", async (errorMessage) => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "invalid",
      session: null,
      reasonCode: "session_token_unavailable",
      errorMessage,
    });
    const data = vi.fn();

    const result = await runSignInCheck({
      context: createAgentContext(data),
      requirement: {
        mode: "required",
        stage: "before-entry",
      },
    });

    expect(result).toEqual({ status: "blocked", exitCode: 1 });
    expect(getAuthSessionStateMock).toHaveBeenCalledTimes(2);
    expect(data).toHaveBeenCalledWith({
      code: "command.entry.sign_in.blocked",
      payload: expect.objectContaining({
        code: "auth.session_token_unavailable",
        status: "blocked",
        reason: expect.stringContaining("saved sign-in is unavailable"),
        nextSteps: [
          "Retry the same command.",
          "If it still fails, run `openmeld auth status --view agent` for diagnostics.",
        ],
        humanActionRequired: false,
        details: expect.objectContaining({
          guidanceReason: "unavailable",
          action: "downloading a Space file",
          authStateReasonCode: "session_token_unavailable",
          authStateErrorMessage: errorMessage,
        }),
      }),
    });
    expect(runAuthLoginMock).not.toHaveBeenCalled();
  });

  it("continues a Space file download when the bounded credential reread recovers", async () => {
    getAuthSessionStateMock
      .mockResolvedValueOnce({
        state: "invalid",
        session: null,
        reasonCode: "session_token_unavailable",
        errorMessage: "macOS Keychain helper could not start",
      })
      .mockResolvedValueOnce({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token-123",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.testing.example",
          clientId: "openmeld-cli",
          createdAt: "2026-08-25T00:00:00.000Z",
          user: {
            id: "user-1",
            email: "felix@example.com",
          },
        },
      });
    const data = vi.fn();

    const result = await runSignInCheck({
      context: createAgentContext(data),
      requirement: {
        mode: "required",
        stage: "before-entry",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(getAuthSessionStateMock).toHaveBeenCalledTimes(2);
    expect(data).not.toHaveBeenCalled();
  });

  it("reuses a Space read's remotely validated session for explicit Profile resolution", async () => {
    const session = {
      v: 1 as const,
      accessToken: "token-123",
      tokenType: "Bearer",
      authBaseUrl: "https://auth.testing.example",
      clientId: "openmeld-cli",
      createdAt: "2026-08-25T00:00:00.000Z",
      user: {
        id: "user-1",
        email: "felix@example.com",
      },
    };
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          resolveProfileResponseSchema.parse({
            ok: true,
            profile: {
              createdAt: "2026-08-25T00:00:00.000Z",
              createdByUserId: "user-1",
              creatorProfileId: null,
              isDefault: true,
              lastUsedAt: null,
              managedRole: null,
              openMeldProfileId: "human-profile-1",
              ownerUserId: "user-1",
              profileHandle: "mira",
              profileKind: "human",
              profileName: "Mira",
              source: "web_create",
              status: "active",
              updatedAt: "2026-08-25T00:00:00.000Z",
            },
          })
        )
      )
    );

    await expect(
      runSignInCheck({
        context: createAgentContext(vi.fn(), "space.status"),
        requirement: {
          mode: "required",
          stage: "before-entry",
        },
      })
    ).resolves.toEqual({ status: "continue" });
    await expect(
      resolveOpenMeldProfileByIdOrName({
        profileIdentifier: "human-profile-1",
      })
    ).resolves.toMatchObject({ openMeldProfileId: "human-profile-1" });

    expect(getAuthSessionStateMock.mock.calls).toEqual([
      [{ validateRemote: true }],
      [{ validateRemote: false }],
    ]);
  });

  it("reuses an interactive login session for the command's Profile resolution", async () => {
    const session = {
      v: 1 as const,
      accessToken: "token-after-login",
      tokenType: "Bearer",
      authBaseUrl: "https://auth.testing.example",
      clientId: "openmeld-cli",
      createdAt: "2026-08-25T00:00:00.000Z",
      user: {
        id: "user-1",
        email: "felix@example.com",
      },
    };
    getAuthSessionStateMock
      .mockResolvedValueOnce({
        state: "invalid",
        session: null,
        reasonCode: "session_metadata_missing",
      })
      .mockResolvedValueOnce({ state: "valid", session })
      .mockResolvedValueOnce({ state: "valid", session });
    selectPromptMock.mockResolvedValue("__command_auth_login__");
    runAuthLoginMock.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          resolveProfileResponseSchema.parse({
            ok: true,
            profile: {
              createdAt: "2026-08-25T00:00:00.000Z",
              createdByUserId: "user-1",
              creatorProfileId: null,
              isDefault: true,
              lastUsedAt: null,
              managedRole: null,
              openMeldProfileId: "human-profile-1",
              ownerUserId: "user-1",
              profileHandle: "mira",
              profileKind: "human",
              profileName: "Mira",
              source: "web_create",
              status: "active",
              updatedAt: "2026-08-25T00:00:00.000Z",
            },
          })
        )
      )
    );
    const context = createAgentContext(vi.fn(), "space.status");
    context.runtime = {
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    };
    context.allowPrompt = true;

    await expect(
      runSignInCheck({
        context,
        requirement: { mode: "required", stage: "before-entry" },
      })
    ).resolves.toEqual({ status: "continue" });
    await expect(
      resolveOpenMeldProfileByIdOrName({
        profileIdentifier: "human-profile-1",
      })
    ).resolves.toMatchObject({ openMeldProfileId: "human-profile-1" });

    expect(runAuthLoginMock).toHaveBeenCalledOnce();
    expect(getAuthSessionStateMock.mock.calls).toEqual([
      [{ validateRemote: true }],
      [{ validateRemote: true }],
      [{ validateRemote: false }],
    ]);
  });

  it("keeps the credential-read cause structured under --json", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "invalid",
      session: null,
      reasonCode: "session_token_unavailable",
      errorMessage: "macOS Keychain helper timed out after 5000ms",
    });
    const context = createAgentContext(vi.fn());
    context.jsonOutput = true;

    const result = await runSignInCheck({
      context,
      requirement: {
        mode: "required",
        stage: "before-entry",
      },
    });

    expect(result).toEqual({
      status: "blocked",
      exitCode: 1,
      jsonError: {
        code: "auth.session_token_unavailable",
        message: expect.stringMatching(UNAVAILABLE_JSON_MESSAGE_RE),
      },
    });
  });
});

function createAgentContext(
  data: Mock<(input: { code: string; payload: unknown }) => void>,
  entryName: CommandEntryContext["entryName"] = "space.files.download"
): CommandEntryContext {
  return {
    entryName,
    argv: ["node", "openmeld", "space", "files", "download"],
    runtime: {
      viewMode: "agent",
      resolvedView: "agent",
      interactive: false,
    },
    presenter: {
      view: "agent",
      event: vi.fn(),
      line: vi.fn(),
      data,
    },
    allowPrompt: false,
    environmentTarget: {
      authBaseUrl: "https://auth.openmeld.invalid",
      gatewayUrl: "https://gateway.openmeld.invalid",
      preset: "prod",
      userFacingCommand: "openmeld",
    },
    gatewayUrl: null,
    profileArg: "agent-profile-1",
    jsonOutput: false,
  };
}
