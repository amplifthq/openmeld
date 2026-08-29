import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertAuthSessionMutationAvailableMock,
  beginAuthSessionTransitionMock,
  getAuthSessionStateMock,
} = vi.hoisted(() => ({
  assertAuthSessionMutationAvailableMock: vi.fn(),
  beginAuthSessionTransitionMock: vi.fn(),
  getAuthSessionStateMock: vi.fn(),
}));

vi.mock("../src/config/auth-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config/auth-session")>()),
  assertAuthSessionMutationAvailable: assertAuthSessionMutationAvailableMock,
  beginAuthSessionTransition: beginAuthSessionTransitionMock,
  getAuthSessionState: getAuthSessionStateMock,
}));

import { runAuthLogin } from "../src/commands/auth";
import { withCapturedStdio } from "./helpers/fs";

const AUTH_BASE_URL = "https://auth.openmeld.invalid";
const CANDIDATE_ACCESS_TOKEN = "access-token-ott-transition-candidate";

describe("one-time token auth session transition", () => {
  beforeEach(() => {
    assertAuthSessionMutationAvailableMock.mockResolvedValue(undefined);
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        accessToken: CANDIDATE_ACCESS_TOKEN,
        user: { id: "candidate-owner" },
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  it("restores the previous owner and revokes the candidate after commit fails", async () => {
    const commitError = Object.assign(new Error("journal commit failed"), {
      code: "EIO",
      path: "/tmp/session-transition.json",
    });
    let localOwner = "previous-owner";
    const rollback = vi.fn(() => {
      localOwner = "previous-owner";
      return Promise.resolve();
    });
    beginAuthSessionTransitionMock.mockImplementation(() => {
      localOwner = "candidate-owner";
      return Promise.resolve({
        previousSession: {
          accessToken: "previous-token",
          user: { id: "previous-owner" },
        },
        commit: vi.fn().mockRejectedValue(commitError),
        rollback,
      });
    });
    const fetchMock = createOneTimeTokenFetchMock({ cleanupStatus: 200 });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    await withCapturedStdio(async () => {
      try {
        await runAuthLogin({
          view: "human",
          authUrl: AUTH_BASE_URL,
          clientId: "openmeld-cli",
          method: "ott",
          ott: "OTT_TRANSITION_COMMIT_FAILURE",
        });
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBe(commitError);
    expect(rollback).toHaveBeenCalledOnce();
    expect(localOwner).toBe("previous-owner");
    expect(fetchMock.mock.calls.map(([request]) => String(request))).toEqual([
      `${AUTH_BASE_URL}/api/auth/one-time-token/verify`,
      `${AUTH_BASE_URL}/api/auth/sign-out`,
    ]);
  });

  it("preserves primary, rollback, and remote cleanup diagnostics without exposing the candidate token", async () => {
    const primaryCause = Object.assign(
      new Error(`fsync failed for ${CANDIDATE_ACCESS_TOKEN}`),
      {
        code: "EPRIMARYCAUSE",
        path: `/tmp/${CANDIDATE_ACCESS_TOKEN}/primary-cause`,
      }
    );
    primaryCause.name = "PrimaryCommitCauseError";
    primaryCause.stack = `PrimaryCommitCauseError: ${CANDIDATE_ACCESS_TOKEN}\n    at commit-cause.ts:1:1`;
    const commitError = Object.assign(
      new Error(`commit failed for ${CANDIDATE_ACCESS_TOKEN}`, {
        cause: primaryCause,
      }),
      {
        code: "ECOMMIT",
        path: `/tmp/${CANDIDATE_ACCESS_TOKEN}/session-transition.json`,
      }
    );
    commitError.name = "AuthSessionCommitError";
    commitError.stack = `AuthSessionCommitError: ${CANDIDATE_ACCESS_TOKEN}\n    at commit.ts:2:2`;

    const rollbackCause = Object.assign(
      new Error(`rollback cause included ${CANDIDATE_ACCESS_TOKEN}`),
      {
        code: "EROLLBACKCAUSE",
        path: `/tmp/${CANDIDATE_ACCESS_TOKEN}/rollback-cause`,
      }
    );
    rollbackCause.name = "RollbackCauseError";
    const rollbackError = Object.assign(
      new Error(`rollback failed for ${CANDIDATE_ACCESS_TOKEN}`, {
        cause: rollbackCause,
      }),
      {
        code: "EROLLBACK",
        endpoint: `${AUTH_BASE_URL}/local-session-recovery`,
        path: `/tmp/${CANDIDATE_ACCESS_TOKEN}/session.json`,
        status: 507,
      }
    );
    rollbackError.name = "AuthSessionRollbackError";
    rollbackError.stack = `AuthSessionRollbackError: ${CANDIDATE_ACCESS_TOKEN}\n    at rollback.ts:3:3`;

    beginAuthSessionTransitionMock.mockResolvedValue({
      previousSession: {
        accessToken: "previous-token",
        user: { id: "previous-owner" },
      },
      commit: vi.fn().mockRejectedValue(commitError),
      rollback: vi.fn().mockRejectedValue(rollbackError),
    });
    const fetchMock = createOneTimeTokenFetchMock({ cleanupStatus: 503 });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    await withCapturedStdio(async () => {
      try {
        await runAuthLogin({
          view: "human",
          authUrl: AUTH_BASE_URL,
          clientId: "openmeld-cli",
          method: "ott",
          ott: "OTT_TRANSITION_TRIPLE_FAILURE",
        });
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toMatchObject({
      cleanup: {
        endpoint: `${AUTH_BASE_URL}/api/auth/sign-out`,
        name: "AuthDeviceSessionClientError",
        operation: "revoke_auth_session",
        status: 503,
      },
      name: "OneTimeTokenCandidateSessionCleanupError",
    });
    const cleanupError = thrown as Error & {
      cause: Error & {
        cause: AggregateError;
        primary: Record<string, unknown>;
        recovery: Record<string, unknown>;
      };
      cleanup: Record<string, unknown>;
    };
    expect(cleanupError.cause).toMatchObject({
      name: "OneTimeTokenLocalSessionRecoveryError",
      primary: {
        cause: {
          code: "EPRIMARYCAUSE",
          name: "PrimaryCommitCauseError",
          path: "/tmp/[REDACTED]/primary-cause",
        },
        code: "ECOMMIT",
        name: "AuthSessionCommitError",
        path: "/tmp/[REDACTED]/session-transition.json",
      },
      recovery: {
        cause: {
          code: "EROLLBACKCAUSE",
          name: "RollbackCauseError",
          path: "/tmp/[REDACTED]/rollback-cause",
        },
        code: "EROLLBACK",
        endpoint: `${AUTH_BASE_URL}/local-session-recovery`,
        name: "AuthSessionRollbackError",
        path: "/tmp/[REDACTED]/session.json",
        status: 507,
      },
    });
    expect(cleanupError.cause.primary.stack).toContain("at commit.ts:2:2");
    expect(cleanupError.cause.recovery.stack).toContain("at rollback.ts:3:3");
    expect(cleanupError.cause.cause).toBeInstanceOf(AggregateError);
    expect(cleanupError.cause.cause.errors).toMatchObject([
      {
        code: "ECOMMIT",
        name: "AuthSessionCommitError",
        path: "/tmp/[REDACTED]/session-transition.json",
      },
      {
        code: "EROLLBACK",
        name: "AuthSessionRollbackError",
        path: "/tmp/[REDACTED]/session.json",
      },
    ]);
    const diagnosticText = [
      cleanupError.message,
      cleanupError.stack ?? "",
      cleanupError.cause.message,
      cleanupError.cause.stack ?? "",
      JSON.stringify({
        cleanup: cleanupError.cleanup,
        primary: cleanupError.cause.primary,
        recovery: cleanupError.cause.recovery,
      }),
      ...cleanupError.cause.cause.errors.flatMap((error: Error) => [
        error.message,
        error.stack ?? "",
        JSON.stringify(error),
      ]),
    ].join("\n");
    expect(diagnosticText).toContain("[REDACTED]");
    expect(diagnosticText).not.toContain(CANDIDATE_ACCESS_TOKEN);
    expect(fetchMock.mock.calls.map(([request]) => String(request))).toEqual([
      `${AUTH_BASE_URL}/api/auth/one-time-token/verify`,
      `${AUTH_BASE_URL}/api/auth/sign-out`,
    ]);
  });
});

function createOneTimeTokenFetchMock(input: { cleanupStatus: number }) {
  return vi.fn((request: string | URL | Request) => {
    const url = String(request);
    if (url.endsWith("/api/auth/one-time-token/verify")) {
      return createJsonResponse(
        {
          session: {
            id: "candidate-session",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          user: {
            id: "candidate-owner",
            email: "candidate@example.com",
          },
        },
        200,
        { "set-auth-token": CANDIDATE_ACCESS_TOKEN }
      );
    }
    if (url.endsWith("/api/auth/sign-out")) {
      return createJsonResponse(
        input.cleanupStatus === 200
          ? { ok: true }
          : { message: "candidate cleanup failed" },
        input.cleanupStatus
      );
    }
    throw new Error(`Unexpected auth request: ${url}`);
  });
}

function createJsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}
