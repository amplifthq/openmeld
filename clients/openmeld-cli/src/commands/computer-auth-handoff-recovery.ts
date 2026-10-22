import {
  AuthSessionRecoveryInProgressError,
  completeInterruptedComputerAuthSessionRecovery,
  getAuthSessionState,
  getInterruptedComputerAuthSessionRecovery,
  hasInterruptedComputerAuthSessionTransition,
  markInterruptedComputerAuthSessionRecovery,
  recordInterruptedComputerAuthSessionRecoveryFailure,
} from "../config/auth-session";
import { compareSemver } from "../config/version-state";
import { scheduleDaemonServiceUpdate } from "../local-service/lifecycle/daemon-service-update-coordinator";
import { readPendingDaemonServiceUpdate } from "../local-service/lifecycle/daemon-service-update-state";
import { startDaemonServiceUpdateWorker } from "../local-service/lifecycle/daemon-service-update-worker-manager";
import { readPendingOpenMeldToolsUpdateAttempt } from "../local-service/maintenance/openmeld-tools-update-attempt-state";
import { readOpenMeldToolsUpdateContextFromEnv } from "../local-service/maintenance/openmeld-tools-update-context";
import {
  resolveExternalOpenMeldToolsUpdate,
  waitForExternalOpenMeldToolsUpdate,
} from "../local-service/maintenance/openmeld-tools-update-join";
import type { Presenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { OPENMELD_VERSION } from "../runtime/version";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
import { revokePreparedAuthSession } from "./computer-auth-session";
import { bestEffortStopCurrentLaneDaemonService } from "./service";
import { createSetupUpdateObserver } from "./setup-update-progress";

const UNUSED_SETUP_SESSION_CLEANUP_SUFFIX =
  " OpenMeld also could not revoke the unused setup session.";

export type ComputerAuthHandoffRecoveryOutcome =
  | "none"
  | "completed"
  | "deferred";

type ComputerAuthHandoffRecoveryInput = {
  onProgress?(progress: {
    code: string;
    phase: "restoring";
    state: "active" | "completed" | "failed";
    text: string;
  }): void;
  presenter: Presenter;
  runtime: RuntimeContext;
  view?: string;
};

export async function recoverInterruptedComputerAuthHandoff(
  input: ComputerAuthHandoffRecoveryInput
): Promise<ComputerAuthHandoffRecoveryOutcome> {
  try {
    return await runInterruptedComputerAuthHandoffRecovery(input);
  } catch (error) {
    emitComputerAuthHandoffRecoveryProgress(input, {
      code: "setup.computer_handoff_recovery.failed",
      state: "failed",
      text:
        error instanceof Error && error.message.trim()
          ? error.message
          : "The previous computer connection could not be restored.",
    });
    throw error;
  }
}

async function runInterruptedComputerAuthHandoffRecovery(
  input: ComputerAuthHandoffRecoveryInput
): Promise<ComputerAuthHandoffRecoveryOutcome> {
  await waitForOpenMeldToolsUpdateBeforeComputerHandoff(input);
  const recovery = await getInterruptedComputerAuthSessionRecovery();
  if (!recovery) {
    return "none";
  }
  emitComputerAuthHandoffRecoveryProgress(input, {
    code: "setup.computer_handoff_recovery.started",
    state: "active",
    text: "Restoring the previous computer connection.",
  });

  // An earlier attempt may have finished the service phase; this attempt then
  // does not know whether the Service was restored or left stopped.
  let serviceOutcome: ComputerServiceRecoveryOutcome = "reconciled_earlier";
  if (!recovery.serviceReconciled) {
    serviceOutcome = await reconcileInterruptedComputerService(input, {
      gatewayUrl: recovery.gatewayUrl,
      id: recovery.id,
      previousOwnerUserId: recovery.previousOwnerUserId,
    });
    await markInterruptedComputerAuthSessionRecovery({
      id: recovery.id,
      phase: "service",
    });
  }

  if (!recovery.remoteSessionRevoked) {
    const revoked = await revokePreparedAuthSession(recovery.candidateSession);
    if (!revoked.ok) {
      await recordInterruptedComputerAuthSessionRecoveryFailure({
        endpoint: revoked.error.endpoint,
        id: recovery.id,
        message: revoked.error.message,
        phase: "remote_session",
        status: revoked.error.status,
      });
      logDeferredComputerAuthHandoffRecovery({
        endpoint: revoked.error.endpoint,
        error: revoked.error.message,
        phase: "remote_session",
        status: revoked.error.status,
        transitionId: recovery.id,
      });
      emitUnusedSetupSessionCleanupWarning(input.presenter, revoked.error);
      emitComputerAuthHandoffRecoveryProgress(input, {
        code: "setup.computer_handoff_recovery.deferred",
        state: "failed",
        text: "The previous computer connection has not been fully restored.",
      });
      return "deferred";
    }
    await markInterruptedComputerAuthSessionRecovery({
      id: recovery.id,
      phase: "remote_session",
    });
  }

  const completed = await completeInterruptedComputerAuthSessionRecovery(
    recovery.id
  );
  emitComputerAuthHandoffRecoveryProgress(input, {
    code: completed
      ? "setup.computer_handoff_recovery.completed"
      : "setup.computer_handoff_recovery.deferred",
    state: completed ? "completed" : "failed",
    text: resolveComputerAuthHandoffRecoveryCompletionText({
      completed,
      serviceOutcome,
    }),
  });
  return completed ? "completed" : "deferred";
}

type ComputerServiceRecoveryOutcome =
  | "restored"
  | "left_stopped"
  | "reconciled_earlier";

function resolveComputerAuthHandoffRecoveryCompletionText(input: {
  completed: boolean;
  serviceOutcome: ComputerServiceRecoveryOutcome;
}): string {
  if (!input.completed) {
    return "The previous computer connection has not been fully restored.";
  }
  switch (input.serviceOutcome) {
    case "left_stopped":
      return "Cleared the interrupted computer connection. OpenMeld Service stays stopped until this computer signs in again.";
    case "reconciled_earlier":
      return "Finished cleaning up the interrupted computer connection.";
    default:
      return "Restored the previous computer connection.";
  }
}

// The previous owner's Service is restored only from that owner's usable
// sign-in. Otherwise the Service stays stopped (fail closed). Returns
// whether the Service was restored or left stopped. An unreadable secret
// store throws instead, so the restore point survives for a retry.
async function reconcileInterruptedComputerService(
  input: ComputerAuthHandoffRecoveryInput,
  recovery: {
    gatewayUrl: string;
    id: string;
    previousOwnerUserId: string | null;
  }
): Promise<Exclude<ComputerServiceRecoveryOutcome, "reconciled_earlier">> {
  const stopped = await stopCurrentLaneDaemonServiceAfterToolsUpdate(input);
  if (stopped.status === "warning") {
    const error = new Error(
      stopped.errorMessage ??
        "OpenMeld could not stop the incomplete Computer connection."
    );
    await recordInterruptedComputerAuthSessionRecoveryFailure({
      id: recovery.id,
      message: error.message,
      phase: "service",
    });
    logDeferredComputerAuthHandoffRecovery({
      error: error.message,
      phase: "service",
      transitionId: recovery.id,
    });
    throw error;
  }

  if (!recovery.previousOwnerUserId) {
    // An incomplete first connection has no previous account to reconnect.
    return "left_stopped";
  }
  const previousSignIn = await readPreviousComputerSignIn(
    recovery.previousOwnerUserId
  );
  if (previousSignIn.usable === "retry") {
    await recordInterruptedComputerAuthSessionRecoveryFailure({
      id: recovery.id,
      message: previousSignIn.message,
      phase: "service",
    });
    logDeferredComputerAuthHandoffRecovery({
      error: previousSignIn.message,
      phase: "service",
      transitionId: recovery.id,
    });
    throw new Error(previousSignIn.message);
  }
  if (!previousSignIn.usable) {
    // Only a usable sign-in for the previous owner may run its Service.
    // Without one, the Service stays stopped: the committed sign-in remains
    // the previous account's, and neither account receives a running
    // Service. An explicit sign-in or a new setup can then replace it.
    emitPreviousComputerSignInUnavailable(input.presenter, {
      reasonCode: previousSignIn.reasonCode,
      state: previousSignIn.state,
      transitionId: recovery.id,
    });
    return "left_stopped";
  }
  const restored = await runDaemonServiceParticipationGate({
    intent: "start",
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
    allowPrompt: false,
    autoRepair: true,
    expectedOwnerUserId: recovery.previousOwnerUserId,
    forcePrompt: true,
    forceRefresh: true,
    gatewayUrl: recovery.gatewayUrl,
    suppressRefreshHumanResultCard: true,
    suppressStartSpinner: true,
    view: input.view,
  });
  if (restored.status !== "aligned") {
    const error = new Error(
      restored.errorMessage ??
        "OpenMeld could not reconnect the previous Computer account."
    );
    await recordInterruptedComputerAuthSessionRecoveryFailure({
      id: recovery.id,
      message: error.message,
      phase: "service",
    });
    logDeferredComputerAuthHandoffRecovery({
      error: error.message,
      phase: "service",
      transitionId: recovery.id,
    });
    throw error;
  }
  return "restored";
}

// Explicit account changes (sign-in and sign-out) finish an interrupted
// Computer handoff through this same owner before touching the sign-in, so a
// stale recovery cannot block the command that replaces the previous account.
export async function finishInterruptedComputerAuthHandoffBeforeAccountChange(
  input: ComputerAuthHandoffRecoveryInput
): Promise<void> {
  if (!(await hasInterruptedComputerAuthSessionTransition())) {
    return;
  }
  const outcome = await recoverInterruptedComputerAuthHandoff(input);
  if (outcome === "deferred") {
    throw new AuthSessionRecoveryInProgressError({ recoveryRequired: true });
  }
}

type PreviousComputerSignIn =
  | { usable: true }
  // The secret store could not be read right now (for example, a locked
  // Keychain). That says nothing about the sign-in, so recovery retries.
  | { usable: "retry"; message: string }
  | {
      usable: false;
      reasonCode: string | null;
      state: Awaited<ReturnType<typeof getAuthSessionState>>["state"];
    };

async function readPreviousComputerSignIn(
  previousOwnerUserId: string
): Promise<PreviousComputerSignIn> {
  // Rollback restored the previous payload as the committed sign-in. Ask the
  // server, so a stale local expiry is refreshed instead of treated as final;
  // an unreachable server keeps the restore path and its retryable failure.
  const previous = await getAuthSessionState({
    refreshExpired: true,
    validateRemote: true,
  });
  if (
    previous.state === "valid" &&
    normalizeOptionalString(previous.session?.user?.id) === previousOwnerUserId
  ) {
    return { usable: true };
  }
  if (previous.reasonCode === "session_token_unavailable") {
    return {
      usable: "retry",
      message:
        previous.errorMessage ??
        "OpenMeld could not read the previous Computer sign-in. Try again.",
    };
  }
  return {
    usable: false,
    reasonCode: previous.reasonCode ?? null,
    state: previous.state,
  };
}

function emitPreviousComputerSignInUnavailable(
  presenter: Presenter,
  input: { reasonCode: string | null; state: string; transitionId: string }
): void {
  console.warn(
    "[openmeld.auth.computer_handoff_recovery_previous_sign_in_unavailable]",
    input
  );
  presenter.line({
    code: "setup.computer_handoff_recovery.previous_sign_in_unavailable",
    text: "The previous account's sign-in on this computer is no longer valid, so OpenMeld left OpenMeld Service stopped instead of reconnecting it.",
    data: { reasonCode: input.reasonCode, state: input.state },
  });
}

function emitComputerAuthHandoffRecoveryProgress(
  input: ComputerAuthHandoffRecoveryInput,
  progress: {
    code: string;
    state: "active" | "completed" | "failed";
    text: string;
  }
): void {
  input.presenter.line({
    code: progress.code,
    text: progress.text,
    data: { phase: "restoring", state: progress.state },
  });
  try {
    input.onProgress?.({ ...progress, phase: "restoring" });
  } catch {
    // Recovery remains authoritative when an optional observer fails.
  }
}

async function stopCurrentLaneDaemonServiceAfterToolsUpdate(input: {
  presenter: Presenter;
  runtime: RuntimeContext;
  view?: string;
}): Promise<
  Awaited<ReturnType<typeof bestEffortStopCurrentLaneDaemonService>>
> {
  let stopped = await bestEffortStopCurrentLaneDaemonService({
    runtime: input.runtime,
  });
  let retriedAfterUpdateDisappeared = false;
  while (stopped.status === "warning") {
    const externalUpdate = await resolveExternalOpenMeldToolsUpdate({
      currentOperationId: readOpenMeldToolsUpdateContextFromEnv()?.operationId,
    });
    if (externalUpdate) {
      if (externalUpdate.phase === "waiting_for_work") {
        // Waiting for accepted work is not a switching lock. A failed stop
        // needs its own recovery guidance, not a tight retry loop.
        break;
      }
      await waitForOpenMeldToolsUpdateBeforeComputerHandoff(input);
    } else if (retriedAfterUpdateDisappeared) {
      break;
    } else {
      // The updater can release the lifecycle lock and remove its operation
      // between stop's warning and this inspection. Retry once so Setup does
      // not turn that successful completion into a stale failure.
      retriedAfterUpdateDisappeared = true;
    }
    stopped = await bestEffortStopCurrentLaneDaemonService({
      runtime: input.runtime,
    });
  }
  return stopped;
}

export async function waitForOpenMeldToolsUpdateBeforeComputerHandoff(input: {
  presenter: Presenter;
}): Promise<void> {
  const currentUpdate = readOpenMeldToolsUpdateContextFromEnv();
  const pending = await readPendingDaemonServiceUpdate();
  if (
    pending &&
    pending.jobId !== currentUpdate?.operationId &&
    pending.phase === "waiting_for_work" &&
    compareSemver(OPENMELD_VERSION, pending.targetVersion) > 0
  ) {
    // Keep one operation owner. A newer Setup must advance the existing job,
    // not start a replacement that the older pending worker can later undo.
    await scheduleDaemonServiceUpdate({
      targetVersion: OPENMELD_VERSION,
      urgency: pending.urgency,
      requestSource: "cli",
    });
  }
  const pendingToolsUpdate = await readPendingOpenMeldToolsUpdateAttempt();
  if (
    pendingToolsUpdate?.attempts === 0 &&
    pendingToolsUpdate.operation.operationId !== currentUpdate?.operationId &&
    !pending
  ) {
    // An earlier Service may have persisted the request but failed to hand it
    // to its OS-owned worker. Wake that same operation before joining it.
    await startDaemonServiceUpdateWorker();
  }
  await waitForExternalOpenMeldToolsUpdate({
    currentOperationId: currentUpdate?.operationId,
    unclaimedTimeoutMs: 60_000,
    pollIntervalMs: 2000,
    onObservation: createSetupUpdateObserver(input.presenter),
  });
}

function logDeferredComputerAuthHandoffRecovery(input: {
  endpoint?: string;
  error: string;
  phase: "service" | "remote_session";
  status?: number | null;
  transitionId: string;
}): void {
  console.warn("[openmeld.auth.computer_handoff_recovery_deferred]", {
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    error: input.error,
    phase: input.phase,
    ...(input.status === undefined ? {} : { status: input.status }),
    transitionId: input.transitionId,
  });
}

export function emitUnusedSetupSessionCleanupWarning(
  presenter: Presenter,
  cleanupError: Error & { endpoint?: string; status?: number | null }
): void {
  presenter.line({
    code: "setup.computer_authorization.cleanup_warning",
    text: "OpenMeld kept the current Computer sign-in, but could not revoke the unused setup session. You can remove it later from Account sessions.",
    data: {
      endpoint: cleanupError.endpoint ?? null,
      status: cleanupError.status ?? null,
      error: cleanupError.message,
    },
  });
}

export function formatComputerAuthCleanupFailureSuffix(
  result: Awaited<ReturnType<typeof revokePreparedAuthSession>>
): string {
  if (result.ok) {
    return "";
  }
  const status =
    result.error.status === null
      ? "network error"
      : `HTTP ${result.error.status}`;
  return `${UNUSED_SETUP_SESSION_CLEANUP_SUFFIX} Cleanup endpoint ${result.error.endpoint} returned ${status}: ${result.error.message}`;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
