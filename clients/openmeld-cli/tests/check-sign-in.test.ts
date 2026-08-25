import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());

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
  runAuthLogin: vi.fn(),
}));

import { runSignInCheck } from "../src/command-entry-checks/check-sign-in";
import { resetCurrentCommandCheckState } from "../src/command-entry-checks/current-command-check-state";
import type { CommandEntryContext } from "../src/command-entry-checks/types";

describe("sign-in command entry check", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    resetCurrentCommandCheckState();
  });

  it("reports a retryable credential-read failure for Space file downloads", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "invalid",
      session: null,
      reasonCode: "session_token_unavailable",
      errorMessage: "macOS Keychain helper could not start",
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
        code: "auth.authentication_required",
        status: "blocked",
        reason: expect.stringContaining(
          "saved sign-in is temporarily unavailable"
        ),
        nextSteps: [
          "Retry the same command.",
          "If it still fails, run `openmeld auth status --view agent` for diagnostics.",
        ],
        humanActionRequired: false,
        details: expect.objectContaining({
          guidanceReason: "unavailable",
          action: "downloading a Space file",
          authStateReasonCode: "session_token_unavailable",
          authStateErrorMessage: "macOS Keychain helper could not start",
        }),
      }),
    });
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
        code: "auth.authentication_required",
        message: expect.stringContaining(
          "saved sign-in is temporarily unavailable"
        ),
        details: {
          reasonCode: "session_token_unavailable",
          errorMessage: "macOS Keychain helper timed out after 5000ms",
        },
      },
    });
  });
});

function createAgentContext(
  data: ReturnType<typeof vi.fn>
): CommandEntryContext {
  return {
    entryName: "space.files.download",
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
