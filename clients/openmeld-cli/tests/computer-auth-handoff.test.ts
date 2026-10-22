import { computerSetupOutputSchema } from "@openmeld/schemas";
import type { OpenMeldToolsUpdateOperation } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStoredAuthSessionIdentity } from "../src/config/auth-session";
import type { Presenter } from "../src/runtime/presenter";
import type { RuntimeContext } from "../src/runtime/types";

const {
  beginAuthSessionTransitionMock,
  bestEffortStopCurrentLaneDaemonServiceMock,
  completeInterruptedComputerAuthSessionRecoveryMock,
  promptConfirmMock,
  exchangeComputerAuthorizationGrantMock,
  exchangeOneTimeTokenAuthSessionMock,
  getAuthSessionStateMock,
  getAuthSessionMetadataMock,
  getInterruptedComputerAuthSessionRecoveryMock,
  markInterruptedComputerAuthSessionRecoveryMock,
  recordInterruptedComputerAuthSessionRecoveryFailureMock,
  resolveBaseUrlMock,
  resolveExternalOpenMeldToolsUpdateMock,
  resolvePrepareSessionForHandoffMock,
  revokePreparedAuthSessionMock,
  runDaemonServiceParticipationGateMock,
  runPrepareSessionExecutorMock,
  connectPrepareSessionStreamMock,
  reportPrepareHandoffStoppedMock,
  waitForExternalOpenMeldToolsUpdateMock,
  readPendingDaemonServiceUpdateMock,
  readPendingOpenMeldToolsUpdateAttemptMock,
  scheduleDaemonServiceUpdateMock,
  startDaemonServiceUpdateWorkerMock,
  writeConnectionProgressMock,
} = vi.hoisted(() => {
  const writeConnectionProgressMock = vi.fn();
  return {
    beginAuthSessionTransitionMock: vi.fn(),
    bestEffortStopCurrentLaneDaemonServiceMock: vi.fn(),
    completeInterruptedComputerAuthSessionRecoveryMock: vi.fn(),
    promptConfirmMock: vi.fn(),
    exchangeComputerAuthorizationGrantMock: vi.fn(),
    exchangeOneTimeTokenAuthSessionMock: vi.fn(),
    getAuthSessionStateMock: vi.fn(),
    getAuthSessionMetadataMock: vi.fn(),
    getInterruptedComputerAuthSessionRecoveryMock: vi.fn(),
    markInterruptedComputerAuthSessionRecoveryMock: vi.fn(),
    recordInterruptedComputerAuthSessionRecoveryFailureMock: vi.fn(),
    resolveBaseUrlMock: vi.fn(),
    resolveExternalOpenMeldToolsUpdateMock: vi.fn(),
    resolvePrepareSessionForHandoffMock: vi.fn(),
    revokePreparedAuthSessionMock: vi.fn(),
    runDaemonServiceParticipationGateMock: vi.fn(),
    runPrepareSessionExecutorMock: vi.fn(),
    connectPrepareSessionStreamMock: vi.fn(async () => ({
      close: vi.fn(),
      writeConnectionProgress: writeConnectionProgressMock,
    })),
    reportPrepareHandoffStoppedMock: vi.fn(),
    waitForExternalOpenMeldToolsUpdateMock: vi.fn(),
    readPendingDaemonServiceUpdateMock: vi.fn(),
    readPendingOpenMeldToolsUpdateAttemptMock: vi.fn(),
    scheduleDaemonServiceUpdateMock: vi.fn(),
    startDaemonServiceUpdateWorkerMock: vi.fn(),
    writeConnectionProgressMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-update-state", () => ({
  readPendingDaemonServiceUpdate: readPendingDaemonServiceUpdateMock,
}));
vi.mock(
  "../src/local-service/maintenance/openmeld-tools-update-attempt-state",
  () => ({
    readPendingOpenMeldToolsUpdateAttempt:
      readPendingOpenMeldToolsUpdateAttemptMock,
  })
);
vi.mock(
  "../src/local-service/lifecycle/daemon-service-update-worker-manager",
  () => ({
    startDaemonServiceUpdateWorker: startDaemonServiceUpdateWorkerMock,
  })
);
vi.mock(
  "../src/local-service/lifecycle/daemon-service-update-coordinator",
  () => ({
    scheduleDaemonServiceUpdate: scheduleDaemonServiceUpdateMock,
  })
);

vi.mock("../src/ui/confirm", () => ({
  promptConfirm: promptConfirmMock,
}));

vi.mock("../src/config/auth-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config/auth-session")>()),
  beginAuthSessionTransition: beginAuthSessionTransitionMock,
  completeInterruptedComputerAuthSessionRecovery:
    completeInterruptedComputerAuthSessionRecoveryMock,
  getAuthSessionState: getAuthSessionStateMock,
  getAuthSessionMetadata: getAuthSessionMetadataMock,
  getInterruptedComputerAuthSessionRecovery:
    getInterruptedComputerAuthSessionRecoveryMock,
  markInterruptedComputerAuthSessionRecovery:
    markInterruptedComputerAuthSessionRecoveryMock,
  recordInterruptedComputerAuthSessionRecoveryFailure:
    recordInterruptedComputerAuthSessionRecoveryFailureMock,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/commands/computer-auth-session", () => ({
  exchangeComputerAuthorizationGrant: exchangeComputerAuthorizationGrantMock,
  revokePreparedAuthSession: revokePreparedAuthSessionMock,
}));

vi.mock("../src/commands/one-time-token-auth-session", () => ({
  exchangeOneTimeTokenAuthSession: exchangeOneTimeTokenAuthSessionMock,
}));

vi.mock("../src/commands/prepare-session-executor", () => ({
  resolvePrepareSessionForHandoff: resolvePrepareSessionForHandoffMock,
  runPrepareSessionExecutor: runPrepareSessionExecutorMock,
  connectPrepareSessionStream: connectPrepareSessionStreamMock,
  reportPrepareHandoffStopped: reportPrepareHandoffStoppedMock,
}));

vi.mock("../src/system/local-service-participation-gate", () => ({
  runDaemonServiceParticipationGate: runDaemonServiceParticipationGateMock,
}));

vi.mock("../src/commands/service", () => ({
  bestEffortStopCurrentLaneDaemonService:
    bestEffortStopCurrentLaneDaemonServiceMock,
}));

vi.mock("../src/local-service/maintenance/openmeld-tools-update-join", () => ({
  resolveExternalOpenMeldToolsUpdate: (...args: unknown[]) =>
    resolveExternalOpenMeldToolsUpdateMock(...args),
  waitForExternalOpenMeldToolsUpdate: (...args: unknown[]) =>
    waitForExternalOpenMeldToolsUpdateMock(...args),
}));

import {
  runComputerAuthorizationHandoff,
  runOneTimeTokenComputerHandoff,
} from "../src/commands/computer-auth-handoff";
import {
  recoverInterruptedComputerAuthHandoff,
  waitForOpenMeldToolsUpdateBeforeComputerHandoff,
} from "../src/commands/computer-auth-handoff-recovery";
import { createSetupUpdateObserver } from "../src/commands/setup-update-progress";
import { AuthSessionChangedBeforeTransitionError } from "../src/config/auth-session";
import { OPENMELD_VERSION } from "../src/runtime/version";

const candidateSession = {
  accessToken: "candidate-token",
  authBaseUrl: "https://auth.openmeld.test",
  clientId: "openmeld-cli",
  tokenType: "Bearer",
  user: {
    id: "user-1",
    email: "next@example.com",
  },
};

const existingSession = {
  accessToken: "existing-token",
  authBaseUrl: "https://auth.openmeld.test",
  clientId: "openmeld-cli",
  createdAt: "2026-08-29T00:00:00.000Z",
  tokenType: "Bearer",
  user: {
    id: "user-1",
    email: "existing@example.com",
  },
  v: 1 as const,
};

const agentRuntime = {
  interactive: false,
  resolvedView: "agent",
  viewMode: "agent",
} satisfies RuntimeContext;

const presenter = {
  data: vi.fn(),
  event: vi.fn(),
  line: vi.fn(),
  view: "agent",
} satisfies Presenter;

describe("Computer authorization handoff", () => {
  it("emits Desktop-readable progress from Service work, including drain completion", () => {
    const operation: OpenMeldToolsUpdateOperation = {
      operationId: "update-running",
      phase: "updating",
      requestSource: "cli",
      requestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      targetVersion: "0.3.264",
      urgency: "required",
    };
    const observe = createSetupUpdateObserver(presenter);
    observe(operation, {
      acceptedWakeCount: 2,
      safeToSwitch: false,
      unacknowledgedResultCount: 0,
    });
    observe(operation, {
      acceptedWakeCount: 1,
      safeToSwitch: false,
      unacknowledgedResultCount: 0,
    });
    observe(operation, {
      acceptedWakeCount: 0,
      safeToSwitch: true,
      unacknowledgedResultCount: 0,
    });
    expect(presenter.line).toHaveBeenCalledTimes(2);
    observe(operation, null);
    const events = presenter.line.mock.calls.map(([event]) =>
      computerSetupOutputSchema.parse({
        type: "line",
        code: event.code,
        message: event.text,
        data: event.data,
      })
    );
    expect(events).toMatchObject([
      { data: { phase: "waiting_for_current_work", state: "active" } },
      { data: { phase: "installing", state: "active" } },
    ]);
  });
  it("wakes an unclaimed update before waiting for it", async () => {
    readPendingOpenMeldToolsUpdateAttemptMock.mockResolvedValue({
      attempts: 0,
      operation: { operationId: "old-update" },
    });
    await waitForOpenMeldToolsUpdateBeforeComputerHandoff({ presenter });
    expect(startDaemonServiceUpdateWorkerMock).toHaveBeenCalledOnce();
    expect(
      startDaemonServiceUpdateWorkerMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      waitForExternalOpenMeldToolsUpdateMock.mock.invocationCallOrder[0] ?? 0
    );
    expect(waitForExternalOpenMeldToolsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ unclaimedTimeoutMs: 60_000 })
    );
  });
  it("advances an older waiting update before joining it, never racing it", async () => {
    readPendingDaemonServiceUpdateMock.mockResolvedValue({
      jobId: "older-pending-update",
      phase: "waiting_for_work",
      targetVersion: "0.0.1",
      urgency: "available",
    });
    await waitForOpenMeldToolsUpdateBeforeComputerHandoff({ presenter });
    expect(scheduleDaemonServiceUpdateMock).toHaveBeenCalledWith({
      targetVersion: OPENMELD_VERSION,
      urgency: "available",
      requestSource: "cli",
    });
    expect(
      scheduleDaemonServiceUpdateMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      waitForExternalOpenMeldToolsUpdateMock.mock.invocationCallOrder[0] ?? 0
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    readPendingDaemonServiceUpdateMock.mockResolvedValue(null);
    readPendingOpenMeldToolsUpdateAttemptMock.mockResolvedValue(null);
    startDaemonServiceUpdateWorkerMock.mockResolvedValue(undefined);
    getAuthSessionMetadataMock.mockResolvedValue(null);
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.test");
    resolveExternalOpenMeldToolsUpdateMock.mockResolvedValue(null);
    resolvePrepareSessionForHandoffMock.mockResolvedValue({
      ownerUserId: "user-1",
      prepareSessionId: "prepare-session",
    });
    exchangeComputerAuthorizationGrantMock.mockResolvedValue(candidateSession);
    exchangeOneTimeTokenAuthSessionMock.mockResolvedValue(candidateSession);
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: existingSession,
    });
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValue(null);
    markInterruptedComputerAuthSessionRecoveryMock.mockResolvedValue(undefined);
    recordInterruptedComputerAuthSessionRecoveryFailureMock.mockResolvedValue(
      undefined
    );
    completeInterruptedComputerAuthSessionRecoveryMock.mockResolvedValue(true);
    beginAuthSessionTransitionMock.mockResolvedValue({
      previousSession: existingSession,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    });
    runPrepareSessionExecutorMock.mockResolvedValue({
      snapshot: { selectedLocalAgentIds: [] },
      status: "completed",
    });
    waitForExternalOpenMeldToolsUpdateMock.mockResolvedValue(undefined);
    revokePreparedAuthSessionMock.mockResolvedValue({ ok: true });
    runDaemonServiceParticipationGateMock.mockResolvedValue({
      status: "aligned",
    });
    bestEffortStopCurrentLaneDaemonServiceMock.mockResolvedValue({
      status: "stopped",
    });
    promptConfirmMock.mockResolvedValue("confirmed");
  });

  it("reports a rejected authorization to Web without changing the current account", async () => {
    exchangeComputerAuthorizationGrantMock.mockRejectedValueOnce(
      new Error("Invalid device code")
    );
    await expect(runAgentHandoff()).rejects.toThrow("Invalid device code");
    expect(reportPrepareHandoffStoppedMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "prepare.authorization_failed" })
    );
    expect(beginAuthSessionTransitionMock).not.toHaveBeenCalled();
    expect(runPrepareSessionExecutorMock).not.toHaveBeenCalled();
  });

  it("validates Prepare before exchanging the grant and restores the previous Computer after failure", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const rollback = vi.fn().mockResolvedValue(undefined);
    beginAuthSessionTransitionMock.mockResolvedValueOnce({
      previousSession: existingSession,
      commit,
      rollback,
    });
    runPrepareSessionExecutorMock.mockRejectedValueOnce(
      new Error("OpenMeld Service could not connect")
    );

    await expect(runAgentHandoff()).rejects.toThrow(
      "OpenMeld Service could not connect"
    );

    expect(
      resolvePrepareSessionForHandoffMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      exchangeComputerAuthorizationGrantMock.mock.invocationCallOrder[0] ?? 0
    );
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(runDaemonServiceParticipationGateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOwnerUserId: "user-1",
        intent: "start",
      })
    );
  });

  it("streams real rollback recovery while retaining the original handoff failure", async () => {
    let releaseStop: (() => void) | undefined;
    bestEffortStopCurrentLaneDaemonServiceMock.mockImplementationOnce(
      async () =>
        await new Promise<{ status: "stopped" }>((resolve) => {
          releaseStop = () => resolve({ status: "stopped" });
        })
    );
    getInterruptedComputerAuthSessionRecoveryMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        candidateSession,
        gatewayUrl: "https://gateway.openmeld.test",
        id: "transition-recovery",
        previousSession: existingSession,
        remoteSessionRevoked: true,
        serviceReconciled: false,
      });
    runPrepareSessionExecutorMock.mockRejectedValueOnce(
      new Error("OpenMeld Service could not connect")
    );

    const handoff = runAgentHandoff();
    await vi.waitFor(() =>
      expect(writeConnectionProgressMock).toHaveBeenCalledWith({
        code: "setup.computer_handoff_recovery.started",
        phase: "restoring",
        state: "active",
        text: "Restoring the previous computer connection.",
      })
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.computer_handoff_recovery.started",
        data: { phase: "restoring", state: "active" },
      })
    );

    releaseStop?.();
    await expect(handoff).rejects.toThrow("OpenMeld Service could not connect");
    expect(writeConnectionProgressMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        code: "setup.computer_handoff_recovery.completed",
        phase: "restoring",
        state: "completed",
      })
    );
  });

  it("opens the diagnostic transport before waiting, but does not exchange credentials during a switching update", async () => {
    let releaseUpdateWait: (() => void) | undefined;
    waitForExternalOpenMeldToolsUpdateMock.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          releaseUpdateWait = resolve;
        })
    );

    const handoff = runAgentHandoff();
    await vi.waitFor(() => {
      expect(waitForExternalOpenMeldToolsUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(resolvePrepareSessionForHandoffMock).toHaveBeenCalledTimes(1);
    expect(exchangeComputerAuthorizationGrantMock).not.toHaveBeenCalled();

    releaseUpdateWait?.();
    await expect(handoff).resolves.toEqual(
      expect.objectContaining({ status: "completed" })
    );
    expect(resolvePrepareSessionForHandoffMock).toHaveBeenCalledTimes(1);
  });

  it("commits the new Computer session only after Prepare completes", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const rollback = vi.fn().mockResolvedValue(undefined);
    beginAuthSessionTransitionMock.mockResolvedValueOnce({
      previousSession: null,
      commit,
      rollback,
    });

    await expect(runAgentHandoff()).resolves.toMatchObject({
      status: "completed",
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    expect(commit.mock.invocationCallOrder[0]).toBeGreaterThan(
      runPrepareSessionExecutorMock.mock.invocationCallOrder[0] ?? 0
    );
    expect(beginAuthSessionTransitionMock).toHaveBeenCalledWith(
      candidateSession,
      {
        computerHandoff: {
          gatewayUrl: "https://gateway.openmeld.test",
          prepareContinuation: { prepareSessionId: "prepare-session" },
        },
        expectedPreviousSession: existingSession,
      }
    );
  });

  it("keeps a stale account-switch confirmation recognizable when candidate cleanup fails", async () => {
    beginAuthSessionTransitionMock.mockRejectedValueOnce(
      new AuthSessionChangedBeforeTransitionError()
    );
    revokePreparedAuthSessionMock.mockResolvedValueOnce({
      ok: false,
      error: Object.assign(
        new Error(
          `Auth Worker could not revoke ${candidateSession.accessToken}`
        ),
        {
          endpoint: `https://auth.openmeld.test/api/auth/revoke-token?token=${candidateSession.accessToken}`,
          operation: "revoke_auth_session",
          status: 503,
        }
      ),
    });

    const failure = await runAgentHandoff().then(
      () => null,
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(AuthSessionChangedBeforeTransitionError);
    expect(failure).toMatchObject({
      cleanup: {
        endpoint:
          "https://auth.openmeld.test/api/auth/revoke-token?token=<REDACTED>",
        message: "Auth Worker could not revoke <REDACTED>",
        operation: "revoke_auth_session",
        status: 503,
      },
      name: "AuthSessionChangedBeforeTransitionError",
      reason: "previous_session_changed",
    });
    expect(JSON.stringify(failure)).not.toContain(candidateSession.accessToken);
    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
    expect(runPrepareSessionExecutorMock).not.toHaveBeenCalled();
  });

  it("reconciles a crashed candidate Service and revokes its remote session before clearing recovery", async () => {
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-1",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: false,
    });

    await expect(
      recoverInterruptedComputerAuthHandoff({
        presenter,
        runtime: agentRuntime,
        view: "agent",
      })
    ).resolves.toBe("completed");

    expect(bestEffortStopCurrentLaneDaemonServiceMock).toHaveBeenCalledTimes(1);
    expect(
      waitForExternalOpenMeldToolsUpdateMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      bestEffortStopCurrentLaneDaemonServiceMock.mock.invocationCallOrder[0] ??
        0
    );
    expect(runDaemonServiceParticipationGateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOwnerUserId: "user-1",
        forceRefresh: true,
        gatewayUrl: "https://gateway.openmeld.test",
      })
    );
    expect(markInterruptedComputerAuthSessionRecoveryMock).toHaveBeenCalledWith(
      { id: "transition-1", phase: "service" }
    );
    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
    expect(markInterruptedComputerAuthSessionRecoveryMock).toHaveBeenCalledWith(
      { id: "transition-1", phase: "remote_session" }
    );
    expect(
      completeInterruptedComputerAuthSessionRecoveryMock
    ).toHaveBeenCalledWith("transition-1");
  });

  it("stops an incomplete first Computer and does not restart a Service", async () => {
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-first-sign-in",
      previousSession: null,
      remoteSessionRevoked: false,
      serviceReconciled: false,
    });

    await recoverInterruptedComputerAuthHandoff({
      presenter,
      runtime: agentRuntime,
    });

    expect(bestEffortStopCurrentLaneDaemonServiceMock).toHaveBeenCalledTimes(1);
    expect(runDaemonServiceParticipationGateMock).not.toHaveBeenCalled();
    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
  });

  it.each([
    { reasonCode: "session_expired", state: "expired" },
    { reasonCode: "remote_session_revoked", state: "revoked" },
    { reasonCode: "remote_session_invalid", state: "invalid" },
  ] as const)("leaves the Service stopped and finishes recovery when the previous sign-in is $state", async ({
    reasonCode,
    state,
  }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-previous-unusable",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: false,
    });
    getAuthSessionStateMock.mockResolvedValueOnce({
      reasonCode,
      session: state === "expired" ? existingSession : null,
      state,
    });

    await expect(
      recoverInterruptedComputerAuthHandoff({
        presenter,
        runtime: agentRuntime,
      })
    ).resolves.toBe("completed");

    expect(getAuthSessionStateMock).toHaveBeenCalledWith({
      refreshExpired: true,
      validateRemote: true,
    });
    expect(bestEffortStopCurrentLaneDaemonServiceMock).toHaveBeenCalledTimes(1);
    expect(runDaemonServiceParticipationGateMock).not.toHaveBeenCalled();
    expect(
      recordInterruptedComputerAuthSessionRecoveryFailureMock
    ).not.toHaveBeenCalled();
    expect(markInterruptedComputerAuthSessionRecoveryMock).toHaveBeenCalledWith(
      { id: "transition-previous-unusable", phase: "service" }
    );
    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
    expect(
      completeInterruptedComputerAuthSessionRecoveryMock
    ).toHaveBeenCalledWith("transition-previous-unusable");
    expect(presenter.line).toHaveBeenCalledWith({
      code: "setup.computer_handoff_recovery.previous_sign_in_unavailable",
      text: expect.stringContaining("left OpenMeld Service stopped"),
      data: { reasonCode, state },
    });
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.computer_handoff_recovery.completed",
        text: expect.stringContaining("stays stopped"),
      })
    );
    expect(warn).toHaveBeenCalledWith(
      "[openmeld.auth.computer_handoff_recovery_previous_sign_in_unavailable]",
      { reasonCode, state, transitionId: "transition-previous-unusable" }
    );
  });

  it("does not claim a restored Service when an earlier attempt finished the service phase", async () => {
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-service-done-earlier",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: true,
    });

    await expect(
      recoverInterruptedComputerAuthHandoff({
        presenter,
        runtime: agentRuntime,
      })
    ).resolves.toBe("completed");

    expect(runDaemonServiceParticipationGateMock).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.computer_handoff_recovery.completed",
        text: "Finished cleaning up the interrupted computer connection.",
      })
    );
    expect(presenter.line).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Restored the previous computer connection.",
      })
    );
  });

  it("does not restore the previous owner's Service from another account's sign-in", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-owner-mismatch",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: false,
    });
    getAuthSessionStateMock.mockResolvedValueOnce({
      session: { ...existingSession, user: { id: "someone-else" } },
      state: "valid",
    });

    await expect(
      recoverInterruptedComputerAuthHandoff({
        presenter,
        runtime: agentRuntime,
      })
    ).resolves.toBe("completed");

    expect(runDaemonServiceParticipationGateMock).not.toHaveBeenCalled();
  });

  it("still fails recovery when a usable previous sign-in cannot restart its Service", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-service-start-failed",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: false,
    });
    runDaemonServiceParticipationGateMock.mockResolvedValueOnce({
      errorMessage: "OpenMeld could not finish starting OpenMeld Service.",
      status: "needs_attention",
    });

    await expect(
      recoverInterruptedComputerAuthHandoff({
        presenter,
        runtime: agentRuntime,
      })
    ).rejects.toThrow("OpenMeld could not finish starting OpenMeld Service.");

    expect(
      recordInterruptedComputerAuthSessionRecoveryFailureMock
    ).toHaveBeenCalledWith({
      id: "transition-service-start-failed",
      message: "OpenMeld could not finish starting OpenMeld Service.",
      phase: "service",
    });
    expect(
      markInterruptedComputerAuthSessionRecoveryMock
    ).not.toHaveBeenCalled();
    expect(revokePreparedAuthSessionMock).not.toHaveBeenCalled();
  });

  it("waits and retries when an update wins the Service lock after the first preflight", async () => {
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-update-race",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: false,
    });
    bestEffortStopCurrentLaneDaemonServiceMock
      .mockResolvedValueOnce({
        status: "warning",
        errorMessage: "OpenMeld Service update owns the lifecycle lock.",
      })
      .mockResolvedValueOnce({ status: "stopped" });
    resolveExternalOpenMeldToolsUpdateMock.mockResolvedValueOnce({
      operationId: "update-operation-1",
      phase: "updating",
      requestSource: "automatic",
      requestedAt: "2026-09-01T12:27:00.000Z",
      targetVersion: "0.3.139",
      updatedAt: "2026-09-01T12:27:01.000Z",
      urgency: "required",
    });

    await expect(
      recoverInterruptedComputerAuthHandoff({
        presenter,
        runtime: agentRuntime,
      })
    ).resolves.toBe("completed");

    expect(waitForExternalOpenMeldToolsUpdateMock).toHaveBeenCalledTimes(2);
    expect(bestEffortStopCurrentLaneDaemonServiceMock).toHaveBeenCalledTimes(2);
    expect(
      recordInterruptedComputerAuthSessionRecoveryFailureMock
    ).not.toHaveBeenCalled();
  });

  it("retries when the update releases the Service lock before the warning is inspected", async () => {
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-update-finished-race",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: false,
    });
    bestEffortStopCurrentLaneDaemonServiceMock
      .mockResolvedValueOnce({
        status: "warning",
        errorMessage: "OpenMeld Service update owns the lifecycle lock.",
      })
      .mockResolvedValueOnce({ status: "stopped" });
    resolveExternalOpenMeldToolsUpdateMock.mockResolvedValueOnce(null);

    await expect(
      recoverInterruptedComputerAuthHandoff({
        presenter,
        runtime: agentRuntime,
      })
    ).resolves.toBe("completed");

    expect(waitForExternalOpenMeldToolsUpdateMock).toHaveBeenCalledTimes(1);
    expect(bestEffortStopCurrentLaneDaemonServiceMock).toHaveBeenCalledTimes(2);
    expect(
      recordInterruptedComputerAuthSessionRecoveryFailureMock
    ).not.toHaveBeenCalled();
  });

  it("keeps failed candidate revocation durable without redoing Service recovery", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-cleanup-retry",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: true,
    });
    revokePreparedAuthSessionMock.mockResolvedValueOnce({
      ok: false,
      error: Object.assign(new Error("Auth Worker unavailable"), {
        endpoint: "https://auth.openmeld.test/api/auth/revoke-token",
        status: 503,
      }),
    });

    await expect(
      recoverInterruptedComputerAuthHandoff({
        presenter,
        runtime: agentRuntime,
      })
    ).resolves.toBe("deferred");

    expect(bestEffortStopCurrentLaneDaemonServiceMock).not.toHaveBeenCalled();
    expect(runDaemonServiceParticipationGateMock).not.toHaveBeenCalled();
    expect(
      recordInterruptedComputerAuthSessionRecoveryFailureMock
    ).toHaveBeenCalledWith({
      endpoint: "https://auth.openmeld.test/api/auth/revoke-token",
      id: "transition-cleanup-retry",
      message: "Auth Worker unavailable",
      phase: "remote_session",
      status: 503,
    });
    expect(
      completeInterruptedComputerAuthSessionRecoveryMock
    ).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[openmeld.auth.computer_handoff_recovery_deferred]",
      {
        endpoint: "https://auth.openmeld.test/api/auth/revoke-token",
        error: "Auth Worker unavailable",
        phase: "remote_session",
        status: 503,
        transitionId: "transition-cleanup-retry",
      }
    );
  });

  it("stops a new setup before exchanging credentials when prior recovery is deferred", async () => {
    getInterruptedComputerAuthSessionRecoveryMock.mockResolvedValueOnce({
      candidateSession,
      gatewayUrl: "https://gateway.openmeld.test",
      id: "transition-deferred-before-new-setup",
      previousSession: existingSession,
      remoteSessionRevoked: false,
      serviceReconciled: true,
    });
    revokePreparedAuthSessionMock.mockResolvedValueOnce({
      ok: false,
      error: Object.assign(new Error("Auth Worker unavailable"), {
        endpoint: "https://auth.openmeld.test/api/auth/revoke-token",
        status: 503,
      }),
    });

    await expect(runAgentHandoff()).rejects.toMatchObject({
      name: "AuthSessionRecoveryInProgressError",
    });

    expect(resolveBaseUrlMock).toHaveBeenCalledTimes(1);
    expect(resolvePrepareSessionForHandoffMock).toHaveBeenCalledTimes(1);
    expect(reportPrepareHandoffStoppedMock).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "prepare.handoff_failed" })
    );
    expect(exchangeComputerAuthorizationGrantMock).not.toHaveBeenCalled();
    expect(beginAuthSessionTransitionMock).not.toHaveBeenCalled();
    expect(runPrepareSessionExecutorMock).not.toHaveBeenCalled();
    expect(
      recordInterruptedComputerAuthSessionRecoveryFailureMock
    ).toHaveBeenCalledWith({
      endpoint: "https://auth.openmeld.test/api/auth/revoke-token",
      id: "transition-deferred-before-new-setup",
      message: "Auth Worker unavailable",
      phase: "remote_session",
      status: 503,
    });
  });

  it("rolls a legacy OTT candidate back when Prepare fails", async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const rollback = vi.fn().mockResolvedValue(undefined);
    beginAuthSessionTransitionMock.mockResolvedValue({
      previousSession: existingSession,
      commit,
      rollback,
    });
    runPrepareSessionExecutorMock.mockRejectedValue(
      new Error("Prepare connection failed")
    );

    await expect(
      runOneTimeTokenComputerHandoff({
        oneTimeToken: "legacy-one-time-token",
        interactive: false,
        presenter,
        runtime: agentRuntime,
        startSession: "starttok_demo",
        view: "agent",
      })
    ).rejects.toThrow("Prepare connection failed");

    expect(
      resolvePrepareSessionForHandoffMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      exchangeOneTimeTokenAuthSessionMock.mock.invocationCallOrder[0] ?? 0
    );
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a grant from a different Prepare owner without changing local auth", async () => {
    resolvePrepareSessionForHandoffMock.mockResolvedValueOnce({
      ownerUserId: "user-other",
      prepareSessionId: "prepare-session",
    });

    await expect(runAgentHandoff()).rejects.toThrow(
      "This setup command and its computer authorization belong to different OpenMeld accounts."
    );

    expect(beginAuthSessionTransitionMock).not.toHaveBeenCalled();
    expect(runPrepareSessionExecutorMock).not.toHaveBeenCalled();
    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
  });

  it("fails closed when the current Computer sign-in cannot be inspected", async () => {
    getAuthSessionStateMock.mockResolvedValueOnce({
      errorMessage: "macOS Keychain is unavailable",
      reasonCode: "session_token_unavailable",
      session: null,
      state: "invalid",
    });

    await expect(runAgentHandoff()).rejects.toThrow(
      "OpenMeld could not inspect the current Computer sign-in. The current Computer connection was not changed."
    );

    expect(beginAuthSessionTransitionMock).not.toHaveBeenCalled();
    expect(runPrepareSessionExecutorMock).not.toHaveBeenCalled();
    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
  });

  it.each([
    "session_token_unavailable",
    "session_token_missing",
  ])("recovers %s after fresh authorization without dropping account identity", async (reasonCode) => {
    getAuthSessionStateMock.mockResolvedValueOnce({
      reasonCode,
      session: null,
      state: "invalid",
    });
    const {
      accessToken: _token,
      tokenType: _type,
      v: _version,
      ...metadata
    } = existingSession;
    getAuthSessionMetadataMock.mockResolvedValueOnce(metadata);

    await runAgentHandoff();

    expect(beginAuthSessionTransitionMock).toHaveBeenCalledWith(
      candidateSession,
      expect.objectContaining({ expectedPreviousSession: metadata })
    );
    expect(runPrepareSessionExecutorMock).toHaveBeenCalled();
  });

  it("fails closed when the current Computer account identity is missing", async () => {
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "valid",
      session: { ...existingSession, user: undefined },
    });

    await expect(runAgentHandoff()).rejects.toThrow(
      "OpenMeld could not verify the account currently connected to this Computer. The current Computer connection was not changed."
    );

    expect(beginAuthSessionTransitionMock).not.toHaveBeenCalled();
    expect(runPrepareSessionExecutorMock).not.toHaveBeenCalled();
    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
  });

  it.each([
    "valid",
    "session_token_missing",
    "session_token_unavailable",
  ])("requires confirmation for a cross-account switch with %s credentials", async (reason) => {
    const otherSession = {
      ...existingSession,
      user: { id: "user-other", email: "other@example.com" },
    };
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: reason === "valid" ? "valid" : "invalid",
      session: reason === "valid" ? otherSession : null,
      reasonCode: reason,
    });
    getAuthSessionMetadataMock.mockResolvedValueOnce(otherSession);

    await expect(runAgentHandoff()).rejects.toThrow(
      "Run the setup command in an interactive Terminal to review and confirm the account switch. The current Computer connection was not changed."
    );

    expect(promptConfirmMock).not.toHaveBeenCalled();
    expect(beginAuthSessionTransitionMock).not.toHaveBeenCalled();
    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
  });

  it.each([
    "matching",
    "different_account",
    "replaced_session",
  ] as const)("binds GUI connection consent to the exact reviewed session: %s", async (review) => {
    const previous = {
      ...existingSession,
      user: { id: "user-other", email: "other@example.com" },
    };
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "valid",
      session: previous,
    });
    const result = runComputerAuthorizationHandoff({
      deviceCode: "approved-device-code",
      interactive: false,
      presenter,
      runtime: agentRuntime,
      startSession: "starttok_demo",
      view: "agent",
      connectionIntent: {
        expectedAccount:
          review === "different_account"
            ? "unexpected-account"
            : candidateSession.user.id,
        previousSessionIdentity: buildStoredAuthSessionIdentity(
          review === "replaced_session"
            ? { ...previous, createdAt: "2026-08-30T00:00:00.000Z" }
            : previous
        ),
      },
    });
    if (review === "matching") {
      await expect(result).resolves.toMatchObject({ status: "completed" });
      expect(beginAuthSessionTransitionMock).toHaveBeenCalledWith(
        candidateSession,
        expect.objectContaining({ expectedPreviousSession: previous })
      );
    } else {
      await expect(result).rejects.toThrow("The computer sign-in changed");
      expect(beginAuthSessionTransitionMock).not.toHaveBeenCalled();
      expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
        candidateSession
      );
    }
    expect(promptConfirmMock).not.toHaveBeenCalled();
  });

  it("switches accounts only after an interactive human confirms it", async () => {
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "valid",
      session: {
        ...existingSession,
        user: { id: "user-other", email: "other@example.com" },
      },
    });
    const commit = vi.fn().mockResolvedValue(undefined);
    beginAuthSessionTransitionMock.mockResolvedValueOnce({
      previousSession: existingSession,
      commit,
      rollback: vi.fn().mockResolvedValue(undefined),
    });
    const humanRuntime = {
      interactive: true,
      resolvedView: "human",
      viewMode: "human",
    } satisfies RuntimeContext;
    const humanPresenter = {
      data: vi.fn(),
      event: vi.fn(),
      line: vi.fn(),
      view: "human",
    } satisfies Presenter;

    await expect(
      runComputerAuthorizationHandoff({
        deviceCode: "approved-device-code",
        interactive: true,
        presenter: humanPresenter,
        runtime: humanRuntime,
        startSession: "starttok_demo",
        view: "human",
      })
    ).resolves.toMatchObject({ status: "completed" });

    expect(promptConfirmMock).toHaveBeenCalledWith({
      activeLabel: "Switch account",
      inactiveLabel: "Keep current account",
      initialValue: false,
      message:
        "Switch this computer from other@example.com to next@example.com?",
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it.each([
    "declined",
    "cancelled",
  ] as const)("revokes the unused candidate when an interactive account switch is %s", async (decision) => {
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "valid",
      session: {
        ...existingSession,
        user: { id: "user-other", email: "other@example.com" },
      },
    });
    promptConfirmMock.mockResolvedValueOnce(decision);
    const humanRuntime = {
      interactive: true,
      resolvedView: "human",
      viewMode: "human",
    } satisfies RuntimeContext;
    const humanPresenter = {
      data: vi.fn(),
      event: vi.fn(),
      line: vi.fn(),
      view: "human",
    } satisfies Presenter;

    await expect(
      runComputerAuthorizationHandoff({
        deviceCode: "approved-device-code",
        interactive: true,
        presenter: humanPresenter,
        runtime: humanRuntime,
        startSession: "starttok_demo",
        view: "human",
      })
    ).resolves.toEqual({
      reason: "user_cancelled",
      status: "not_completed",
    });

    expect(reportPrepareHandoffStoppedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "prepare.account_switch_cancelled",
      })
    );

    expect(revokePreparedAuthSessionMock).toHaveBeenCalledWith(
      candidateSession
    );
    expect(beginAuthSessionTransitionMock).not.toHaveBeenCalled();
  });
});

function runAgentHandoff() {
  return runComputerAuthorizationHandoff({
    deviceCode: "approved-device-code",
    interactive: false,
    presenter,
    runtime: agentRuntime,
    startSession: "starttok_demo",
    view: "agent",
  });
}
