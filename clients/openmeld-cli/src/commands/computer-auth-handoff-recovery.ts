import {
  completeInterruptedComputerAuthSessionRecovery,
  getInterruptedComputerAuthSessionRecovery,
  markInterruptedComputerAuthSessionRecovery,
  recordInterruptedComputerAuthSessionRecoveryFailure,
} from "../config/auth-session";
import { readOpenMeldToolsUpdateContextFromEnv } from "../local-service/maintenance/openmeld-tools-update-context";
import {
  resolveExternalOpenMeldToolsUpdate,
  waitForExternalOpenMeldToolsUpdate,
} from "../local-service/maintenance/openmeld-tools-update-join";
import type { Presenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { runDaemonServiceParticipationGate } from "../system/local-service-participation-gate";
import { revokePreparedAuthSession } from "./computer-auth-session";
import { bestEffortStopCurrentLaneDaemonService } from "./service";

const UNUSED_SETUP_SESSION_CLEANUP_SUFFIX =
  " OpenMeld also could not revoke the unused setup session.";

export type ComputerAuthHandoffRecoveryOutcome =
  | "none"
  | "completed"
  | "deferred";

export async function recoverInterruptedComputerAuthHandoff(input: {
  presenter: Presenter;
  runtime: RuntimeContext;
  view?: string;
}): Promise<ComputerAuthHandoffRecoveryOutcome> {
  const recovery = await getInterruptedComputerAuthSessionRecovery();
  if (!recovery) {
    return "none";
  }

  const previousOwnerUserId = normalizeOptionalString(
    recovery.previousSession?.user?.id
  );
  if (!recovery.serviceReconciled) {
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

    if (previousOwnerUserId) {
      const restored = await runDaemonServiceParticipationGate({
        intent: "start",
        presenter: input.presenter,
        resolvedView: input.runtime.resolvedView,
        allowPrompt: false,
        autoRepair: true,
        expectedOwnerUserId: previousOwnerUserId,
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
    }
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
  return completed ? "completed" : "deferred";
}

async function stopCurrentLaneDaemonServiceAfterToolsUpdate(input: {
  presenter: Presenter;
  runtime: RuntimeContext;
  view?: string;
}): Promise<
  Awaited<ReturnType<typeof bestEffortStopCurrentLaneDaemonService>>
> {
  await waitForOpenMeldToolsUpdateBeforeComputerHandoff(input);
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
  await waitForExternalOpenMeldToolsUpdate({
    allowRecoveryWhileWaitingForWork: true,
    currentOperationId: currentUpdate?.operationId,
    onWaiting: (operation) => {
      input.presenter.line({
        code: "setup.openmeld_tools_update.waiting",
        text: "OpenMeld is finishing an update already in progress. Setup will continue automatically when the update finishes.",
        data: {
          operationId: operation.operationId,
          phase: operation.phase,
          targetVersion: operation.targetVersion,
        },
      });
    },
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
