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

import { evaluateCommandAuthentication } from "../src/auth/command-auth";

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
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
  },
};

const UNAVAILABLE_AUTH_STATE = {
  state: "invalid" as const,
  session: null,
  reasonCode: "session_token_unavailable" as const,
  errorMessage: "macOS Keychain helper could not start",
};

describe("command authentication", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
  });

  it("recovers when a transient credential read succeeds on the bounded retry", async () => {
    getAuthSessionStateMock
      .mockResolvedValueOnce(UNAVAILABLE_AUTH_STATE)
      .mockResolvedValueOnce(VALID_AUTH_STATE);

    await expect(evaluateCommandAuthentication()).resolves.toMatchObject({
      status: "valid",
      session: VALID_AUTH_STATE.session,
      reasonCode: null,
      errorMessage: null,
    });
    expect(getAuthSessionStateMock).toHaveBeenCalledTimes(2);
    expect(getAuthSessionStateMock).toHaveBeenNthCalledWith(1, {
      validateRemote: true,
    });
    expect(getAuthSessionStateMock).toHaveBeenNthCalledWith(2, {
      validateRemote: true,
    });
  });

  it("keeps credential-read provenance when the bounded retry cannot recover", async () => {
    getAuthSessionStateMock.mockResolvedValue(UNAVAILABLE_AUTH_STATE);

    await expect(evaluateCommandAuthentication()).resolves.toMatchObject({
      status: "unavailable",
      session: null,
      reasonCode: "session_token_unavailable",
      errorMessage: "macOS Keychain helper could not start",
    });
    expect(getAuthSessionStateMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an unexpected credential-read exception as unavailable", async () => {
    getAuthSessionStateMock.mockRejectedValue(
      new Error(
        "macOS Keychain helper crashed before returning a result; access_token=not-a-real-secret"
      )
    );

    await expect(evaluateCommandAuthentication()).resolves.toMatchObject({
      status: "unavailable",
      session: null,
      reasonCode: "session_token_unavailable",
      errorMessage:
        "macOS Keychain helper crashed before returning a result; access_token=[redacted]",
    });
    expect(getAuthSessionStateMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a genuinely invalid local session", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "invalid",
      session: null,
      reasonCode: "session_metadata_invalid",
    });

    await expect(evaluateCommandAuthentication()).resolves.toMatchObject({
      status: "invalid",
      session: null,
      reasonCode: "session_metadata_invalid",
    });
    expect(getAuthSessionStateMock).toHaveBeenCalledTimes(1);
  });
});
