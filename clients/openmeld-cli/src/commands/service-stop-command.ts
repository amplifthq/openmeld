import { confirm } from "@clack/prompts";
import { toErrorMessage } from "@openmeld/utils";
import {
  clearDaemonServiceRuntimeState,
  type DaemonServiceRuntimeStatus,
} from "../config/daemon-state";
import {
  LocalDaemonControlPlaneClientError,
  requestLocalDaemonShutdown,
} from "../local-service/control-plane/client";
import {
  emitDaemonLifecycleEvent,
  runDaemonServiceManagerAction,
} from "../local-service/lifecycle/daemon-lifecycle-journal";
import { disableDaemonServiceAutostartIfConfigured } from "../local-service/lifecycle/daemon-service-manager";
import {
  type DaemonOwnerSnapshot,
  hasActiveDaemonOwners,
  readCurrentDaemonOwnerSnapshot,
  resolveDaemonStopStrategy,
  summarizeDaemonOwnerSnapshot,
} from "../local-service/lifecycle/daemon-service-owner-snapshot";
import { waitForDaemonSystemServiceToStop as waitForSystemServiceToStop } from "../local-service/lifecycle/daemon-service-runtime";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import type { RuntimeContext, resolveRuntimeContext } from "../runtime/context";
import { canUseInteractivePrompts } from "../runtime/interaction";
import type { createPresenter } from "../runtime/presenter/index";
import { describeDaemonRuntimeStatus } from "./service-status-view";

export const STOP_WAIT_MS = 2000;

export const STOP_POLL_INTERVAL_MS = 200;

export const SERVICE_STOP_CHECK_MS = 3000;

export const SERVICE_STOP_POLL_MS = 200;

export type SharedDaemonStopMode = "interactive" | "best_effort";

export type SharedDaemonStopResult =
  | {
      status: "stopped";
      pid: number | null;
      signal: NodeJS.Signals | "system";
      forcedAfterTimeout?: boolean;
    }
  | {
      status: "not_running";
      runtimeStatus: DaemonServiceRuntimeStatus;
    }
  | {
      status: "cancelled";
    }
  | {
      status: "warning";
      pid: number | null;
      reason:
        | "invalid_state"
        | "process_timeout"
        | "stop_failed"
        | "system_timeout";
      runtimeStatus: DaemonServiceRuntimeStatus;
      errorMessage?: string;
    };

export function summarizeDaemonStopJournalResult(
  stopResult: SharedDaemonStopResult
): {
  metadata?: Record<string, unknown>;
  result: string;
} {
  switch (stopResult.status) {
    case "stopped":
      return {
        result: "stopped",
        metadata: {
          forcedAfterTimeout: stopResult.forcedAfterTimeout ?? false,
          pid: stopResult.pid,
          signal: stopResult.signal,
        },
      };
    case "not_running":
      return {
        result: "not_running",
        metadata: {
          runtimeStatus: stopResult.runtimeStatus.status,
        },
      };
    case "cancelled":
      return {
        result: "cancelled",
      };
    case "warning":
      return {
        result: "warning",
        metadata: {
          errorMessage: stopResult.errorMessage ?? null,
          pid: stopResult.pid,
          reason: stopResult.reason,
          runtimeStatus: stopResult.runtimeStatus.status,
        },
      };
    default:
      return {
        result: "unknown",
      };
  }
}

export async function stopCurrentLaneDaemonService(input: {
  force?: boolean;
  mode: SharedDaemonStopMode;
  runtime: RuntimeContext;
}): Promise<SharedDaemonStopResult> {
  const context = await loadCurrentLaneDaemonStopContext();
  await emitDaemonLifecycleEvent({
    type: "owner.snapshot",
    result: "observed",
    metadata: summarizeDaemonOwnerSnapshot(context.ownerSnapshot),
    command: "openmeld service stop",
    intent: "stop",
  });
  await emitDaemonLifecycleEvent({
    type: "stop.strategy.selected",
    result: context.stopStrategy.kind,
    metadata: {
      reason: context.stopStrategy.reason,
      requiresResidualProcessCleanup:
        context.stopStrategy.requiresResidualProcessCleanup,
    },
    command: "openmeld service stop",
    intent: "stop",
  });

  if (context.stopStrategy.kind === "not_running") {
    return await buildDaemonStopNotRunningResult(
      context.ownerSnapshot.runtimeStatus
    );
  }
  if (context.stopStrategy.kind === "manager_first") {
    return await stopManagedCurrentLaneDaemonService({
      force: input.force,
      mode: input.mode,
      ownerSnapshot: context.ownerSnapshot,
      runtime: input.runtime,
    });
  }
  if (context.stopStrategy.kind === "process_then_manager_cleanup") {
    return await stopCurrentLaneDaemonProcessThenManagerCleanup({
      force: input.force,
      mode: input.mode,
      ownerSnapshot: context.ownerSnapshot,
      runtime: input.runtime,
    });
  }
  return await stopCurrentLaneDaemonProcess({
    force: input.force,
    mode: input.mode,
    runtime: input.runtime,
    runtimeStatus: context.ownerSnapshot.runtimeStatus,
  });
}

export const handleDaemonNotRunningStopStatus = async (
  runtime: RuntimeContext,
  presenter: ReturnType<typeof createPresenter>,
  runtimeStatus: DaemonServiceRuntimeStatus
): Promise<void> => {
  if (runtimeStatus.status === "stale") {
    await clearDaemonServiceRuntimeState();
  }
  const payload = {
    ok: false,
    reason: "service_not_running",
    status: runtimeStatus,
  } as const;
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.stop.not_running",
      payload,
    });
    return;
  }

  presenter.line({
    code: "daemon.stop.not_running",
    text: describeDaemonRuntimeStatus(runtimeStatus),
  });
};

export const emitDaemonStopCancelled = (
  runtime: RuntimeContext,
  presenter: ReturnType<typeof createPresenter>
): void => {
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "daemon.stop.cancelled",
      payload: {
        ok: false,
        reason: "user_cancelled",
      },
    });
    return;
  }

  presenter.line({
    code: "daemon.stop.cancelled",
    text: "Service stop was cancelled.",
  });
};

export async function loadCurrentLaneDaemonStopContext(): Promise<{
  ownerSnapshot: DaemonOwnerSnapshot;
  stopStrategy: ReturnType<typeof resolveDaemonStopStrategy>;
}> {
  const ownerSnapshot = await readCurrentDaemonOwnerSnapshot();
  return {
    ownerSnapshot,
    stopStrategy: resolveDaemonStopStrategy(ownerSnapshot),
  };
}

export async function buildDaemonStopNotRunningResult(
  runtimeStatus: DaemonServiceRuntimeStatus
): Promise<SharedDaemonStopResult> {
  if (runtimeStatus.status === "stale") {
    await clearDaemonServiceRuntimeState();
  }
  return {
    status: "not_running",
    runtimeStatus,
  };
}

export async function stopManagedCurrentLaneDaemonService(input: {
  force?: boolean;
  mode: SharedDaemonStopMode;
  ownerSnapshot: DaemonOwnerSnapshot;
  runtime: RuntimeContext;
}): Promise<SharedDaemonStopResult> {
  if (!input.ownerSnapshot.serviceManager) {
    const invalidManagerResult = await stopRegisteredDaemonServiceManager({
      force: input.force,
      mode: input.mode,
      ownerSnapshot: input.ownerSnapshot,
      runtime: input.runtime,
    });
    if (invalidManagerResult) {
      return invalidManagerResult;
    }
  }

  if (input.mode === "interactive") {
    const shouldStop = await confirmStopServiceManager(
      input.runtime,
      input.ownerSnapshot.runtimeStatus
    );
    if (!shouldStop) {
      return {
        status: "cancelled",
      };
    }
  }

  const drainPreparationResult = await prepareManagedDaemonServiceForStop({
    force: input.force,
    mode: input.mode,
    ownerSnapshot: input.ownerSnapshot,
  });
  if (drainPreparationResult) {
    return drainPreparationResult;
  }

  const managerCleanupResult = await stopRegisteredDaemonServiceManager({
    force: input.force,
    mode: input.mode,
    ownerSnapshot: input.ownerSnapshot,
    runtime: input.runtime,
    skipConfirmation: true,
  });
  if (managerCleanupResult) {
    return managerCleanupResult;
  }

  await clearDaemonServiceRuntimeState();
  return {
    status: "stopped",
    pid: input.ownerSnapshot.runtimeStatus.pid,
    signal: "system",
  };
}

async function prepareManagedDaemonServiceForStop(input: {
  force?: boolean;
  mode: SharedDaemonStopMode;
  ownerSnapshot: DaemonOwnerSnapshot;
}): Promise<Extract<SharedDaemonStopResult, { status: "warning" }> | null> {
  const serviceManager = input.ownerSnapshot.serviceManager;
  if (!serviceManager) {
    return null;
  }

  const shouldRestoreAutostart =
    await disableDaemonServiceAutostartIfConfigured({
      manager: serviceManager,
      status: input.ownerSnapshot.serviceManagerStatus,
    });
  if (input.force === true) {
    return null;
  }

  try {
    const shutdown = await requestLocalDaemonShutdown({
      payload: {
        gracePeriodMs: STOP_WAIT_MS,
        mode: "graceful",
      },
      // The Service acknowledges only after the active socket session has
      // sent its final heartbeat and drained durable results. A client-side
      // deadline would let the manager kill the process before that proof.
      timeoutMs: 0,
    });
    await emitDaemonLifecycleEvent({
      command: "openmeld service stop",
      intent: "stop",
      metadata: {
        accepted: shutdown.accepted,
        gracePeriodMs: shutdown.gracePeriodMs,
        mode: shutdown.mode,
      },
      result: shutdown.accepted ? "completed" : "unsupported",
      stopCause: "user_stop",
      type: "stop.controlled_drain",
    });
    return null;
  } catch (error) {
    const isLegacyShutdownContract =
      error instanceof LocalDaemonControlPlaneClientError &&
      error.code === "daemon.control.contract_mismatch";
    const isManagerRunningWithoutRuntime =
      error instanceof LocalDaemonControlPlaneClientError &&
      error.code === "daemon.control.endpoint_missing" &&
      input.ownerSnapshot.runtimeStatus.status !== "running" &&
      input.ownerSnapshot.ownedProcesses.length === 0;
    const isCompatibilityFallback =
      isLegacyShutdownContract || isManagerRunningWithoutRuntime;
    await emitDaemonLifecycleEvent({
      command: "openmeld service stop",
      intent: "stop",
      metadata: {
        compatibilityFallback: isCompatibilityFallback,
        ...(isManagerRunningWithoutRuntime
          ? { compatibilityReason: "manager_running_without_runtime" }
          : {}),
        errorMessage: toErrorMessage(error),
      },
      result: isCompatibilityFallback ? "fallback" : "failed",
      stopCause: "user_stop",
      type: "stop.controlled_drain",
    });
    if (isCompatibilityFallback) {
      return null;
    }

    let errorMessage = toErrorMessage(error);
    if (shouldRestoreAutostart) {
      try {
        await serviceManager.enableAutostart();
      } catch (restoreError) {
        errorMessage = `${errorMessage}; failed to restore service autostart: ${toErrorMessage(restoreError)}`;
      }
    }
    if (input.mode !== "best_effort") {
      throw new Error(
        `OpenMeld Service stayed running because its final offline status could not be delivered: ${errorMessage}`
      );
    }
    return buildDaemonStopWarningResult({
      reason: "stop_failed",
      runtimeStatus: input.ownerSnapshot.runtimeStatus,
      errorMessage,
    });
  }
}

export async function stopCurrentLaneDaemonProcessThenManagerCleanup(input: {
  force?: boolean;
  mode: SharedDaemonStopMode;
  ownerSnapshot: DaemonOwnerSnapshot;
  runtime: RuntimeContext;
}): Promise<SharedDaemonStopResult> {
  const processStopResult = await stopCurrentLaneDaemonProcess({
    force: input.force,
    mode: input.mode,
    runtime: input.runtime,
    runtimeStatus: input.ownerSnapshot.runtimeStatus,
  });
  if (processStopResult.status !== "stopped") {
    return processStopResult;
  }

  const managerCleanupResult = await stopRegisteredDaemonServiceManager({
    force: input.force,
    mode: input.mode,
    ownerSnapshot: input.ownerSnapshot,
    runtime: input.runtime,
    skipConfirmation: true,
  });
  if (managerCleanupResult) {
    return managerCleanupResult;
  }

  return processStopResult;
}

export async function stopRegisteredDaemonServiceManager(input: {
  force?: boolean;
  mode: SharedDaemonStopMode;
  ownerSnapshot: DaemonOwnerSnapshot;
  runtime: RuntimeContext;
  skipConfirmation?: boolean;
}): Promise<Extract<
  SharedDaemonStopResult,
  { status: "warning" | "cancelled" }
> | null> {
  if (!input.ownerSnapshot.serviceManager) {
    if (input.mode !== "best_effort") {
      throw new Error(
        "OpenMeld found system service registration, but the local service manager is unavailable."
      );
    }
    return buildDaemonStopWarningResult({
      reason: "invalid_state",
      runtimeStatus: input.ownerSnapshot.runtimeStatus,
      errorMessage:
        "system service registration is present, but the local service manager could not be resolved",
    });
  }
  if (input.mode === "interactive" && input.skipConfirmation !== true) {
    const shouldStop = await confirmStopServiceManager(
      input.runtime,
      input.ownerSnapshot.runtimeStatus
    );
    if (!shouldStop) {
      return {
        status: "cancelled",
      };
    }
  }

  try {
    await runDaemonServiceManagerAction({
      action: "stop",
      command: "openmeld service stop",
      controller: input.ownerSnapshot.serviceManager.controller,
      intent: "stop",
      metadata: {
        ownerSetSummary: input.ownerSnapshot.ownerSetSummary,
      },
      run: async () => await input.ownerSnapshot.serviceManager?.stop(),
    });
  } catch (error) {
    if (input.mode !== "best_effort") {
      throw new Error(
        `Failed to stop system service (${input.ownerSnapshot.runtimeStatus.serviceController}): ${toErrorMessage(error)}`
      );
    }
    return buildDaemonStopWarningResult({
      reason: "stop_failed",
      runtimeStatus: input.ownerSnapshot.runtimeStatus,
      errorMessage: toErrorMessage(error),
    });
  }

  const stopped = await waitForSystemServiceToStop({
    manager: input.ownerSnapshot.serviceManager,
    waitMs: SERVICE_STOP_CHECK_MS,
    pollMs: SERVICE_STOP_POLL_MS,
  });
  if (!stopped) {
    const finalOwnerSnapshot = await readCurrentDaemonOwnerSnapshot();
    if (
      hasDifferentActiveDaemonOwnerAfterSystemStop(
        input.ownerSnapshot,
        finalOwnerSnapshot
      )
    ) {
      return buildDaemonStopWarningResult({
        reason: "stop_failed",
        runtimeStatus: finalOwnerSnapshot.runtimeStatus,
        errorMessage:
          "local service owners are still active after stopping the system service",
      });
    }
    return buildDaemonStopWarningResult({
      reason: "system_timeout",
      runtimeStatus: input.ownerSnapshot.runtimeStatus,
    });
  }

  let residualCleanupResult: Awaited<
    ReturnType<typeof stopResidualDaemonProcessesAfterManagerStop>
  >;
  try {
    residualCleanupResult = await stopResidualDaemonProcessesAfterManagerStop({
      force: input.force,
      mode: input.mode,
      runtimeStatus: input.ownerSnapshot.runtimeStatus,
    });
  } catch (error) {
    if (input.mode !== "best_effort") {
      throw error;
    }
    return buildDaemonStopWarningResult({
      reason: "stop_failed",
      runtimeStatus: input.ownerSnapshot.runtimeStatus,
      errorMessage: toErrorMessage(error),
    });
  }

  const finalOwnerSnapshot = residualCleanupResult.shouldRefresh
    ? await readCurrentDaemonOwnerSnapshot()
    : residualCleanupResult.ownerSnapshot;
  if (
    hasActiveDaemonOwners(finalOwnerSnapshot) ||
    finalOwnerSnapshot.serviceManagerStatus?.enabled === true
  ) {
    return buildDaemonStopWarningResult({
      reason: "stop_failed",
      runtimeStatus: finalOwnerSnapshot.runtimeStatus,
      errorMessage:
        "local service owners are still active after stopping the system service",
    });
  }

  return null;
}

export function hasDifferentActiveDaemonOwnerAfterSystemStop(
  initialOwnerSnapshot: DaemonOwnerSnapshot,
  finalOwnerSnapshot: DaemonOwnerSnapshot
): boolean {
  if (!hasActiveDaemonOwners(finalOwnerSnapshot)) {
    return false;
  }
  if (
    finalOwnerSnapshot.activeOwnerKinds.some(
      (ownerKind) => ownerKind !== "system_service"
    )
  ) {
    return true;
  }
  const initialPid = initialOwnerSnapshot.runtimeStatus.pid;
  const finalPid = finalOwnerSnapshot.runtimeStatus.pid;
  return (
    finalOwnerSnapshot.runtimeStatus.status === "running" &&
    finalPid !== null &&
    initialPid !== null &&
    finalPid !== initialPid
  );
}

export function buildDaemonStopWarningResult(input: {
  reason: Extract<SharedDaemonStopResult, { status: "warning" }>["reason"];
  runtimeStatus: DaemonServiceRuntimeStatus;
  errorMessage?: string;
}): Extract<SharedDaemonStopResult, { status: "warning" }> {
  return {
    status: "warning",
    pid: input.runtimeStatus.pid,
    reason: input.reason,
    runtimeStatus: input.runtimeStatus,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  };
}

export async function stopResidualDaemonProcessesAfterManagerStop(input: {
  force?: boolean;
  mode: SharedDaemonStopMode;
  runtimeStatus: DaemonServiceRuntimeStatus;
}): Promise<{
  ownerSnapshot: DaemonOwnerSnapshot;
  shouldRefresh: boolean;
}> {
  const residualOwnerSnapshot = await readCurrentDaemonOwnerSnapshot();
  for (const processInfo of residualOwnerSnapshot.ownedProcesses) {
    const signal = input.force ? "SIGKILL" : "SIGTERM";
    const terminated = await stopTrackedDaemonProcess({
      pid: processInfo.pid,
      reason: "residual_cleanup_after_manager_stop",
      signal,
    });
    if (!terminated) {
      if (input.force) {
        continue;
      }
      throw new Error(
        `Residual OpenMeld-owned process pid=${String(processInfo.pid)} did not exit after ${signal}.`
      );
    }
  }
  return {
    ownerSnapshot: residualOwnerSnapshot,
    shouldRefresh: residualOwnerSnapshot.ownedProcesses.length > 0,
  };
}

export async function stopCurrentLaneDaemonProcess(input: {
  force?: boolean;
  mode: SharedDaemonStopMode;
  runtime: RuntimeContext;
  runtimeStatus: DaemonServiceRuntimeStatus;
}): Promise<SharedDaemonStopResult> {
  const daemonPid = input.runtimeStatus.pid;
  if (daemonPid === null) {
    await clearDaemonServiceRuntimeState();
    return {
      status: "warning",
      pid: null,
      reason: "invalid_state",
      runtimeStatus: input.runtimeStatus,
    };
  }

  const stopSignal = await resolveDaemonStopSignal(input);
  if (!stopSignal) {
    return {
      status: "cancelled",
    };
  }

  try {
    return await requestDaemonProcessStop({
      daemonPid,
      runtime: input.runtime,
      runtimeStatus: input.runtimeStatus,
      stopSignal,
      mode: input.mode,
    });
  } catch (error) {
    if (input.mode !== "best_effort") {
      throw error;
    }
    return {
      status: "warning",
      pid: daemonPid,
      reason: "stop_failed",
      runtimeStatus: input.runtimeStatus,
      errorMessage: toErrorMessage(error),
    };
  }
}

export async function resolveDaemonStopSignal(input: {
  force?: boolean;
  mode: SharedDaemonStopMode;
  runtime: RuntimeContext;
  runtimeStatus: DaemonServiceRuntimeStatus;
}): Promise<NodeJS.Signals | null> {
  if (input.mode === "interactive") {
    return await confirmDaemonStopWithMode(
      input.runtime,
      input.runtimeStatus,
      input.force
    );
  }
  if (input.force) {
    return "SIGKILL";
  }
  return "SIGTERM";
}

export async function requestDaemonProcessStop(input: {
  daemonPid: number;
  mode: SharedDaemonStopMode;
  runtime: RuntimeContext;
  runtimeStatus: DaemonServiceRuntimeStatus;
  stopSignal: NodeJS.Signals;
}): Promise<SharedDaemonStopResult> {
  const terminated = await stopTrackedDaemonProcess({
    pid: input.daemonPid,
    reason: "interactive_stop",
    signal: input.stopSignal,
  });
  if (input.stopSignal === "SIGTERM" && !terminated) {
    return await handleDaemonProcessStopTimeout(input);
  }
  await clearDaemonServiceRuntimeState();
  return {
    status: "stopped",
    pid: input.daemonPid,
    signal: input.stopSignal,
  };
}

export async function handleDaemonProcessStopTimeout(input: {
  daemonPid: number;
  mode: SharedDaemonStopMode;
  runtime: RuntimeContext;
  runtimeStatus: DaemonServiceRuntimeStatus;
}): Promise<SharedDaemonStopResult> {
  if (shouldOfferForceKillAfterStopTimeout(input)) {
    const forceKill = await confirm({
      message: "Service did not stop within timeout, force kill now?",
      initialValue: true,
    });
    if (forceKill) {
      await stopTrackedDaemonProcess({
        pid: input.daemonPid,
        reason: "interactive_force_kill_after_timeout",
        signal: "SIGKILL",
      });
      await clearDaemonServiceRuntimeState();
      return {
        status: "stopped",
        pid: input.daemonPid,
        signal: "SIGKILL",
        forcedAfterTimeout: true,
      };
    }
  }
  return {
    status: "warning",
    pid: input.daemonPid,
    reason: "process_timeout",
    runtimeStatus: input.runtimeStatus,
  };
}

export function shouldOfferForceKillAfterStopTimeout(input: {
  mode: SharedDaemonStopMode;
  runtime: RuntimeContext;
}): boolean {
  return (
    input.mode === "interactive" &&
    input.runtime.resolvedView === "human" &&
    canUseInteractivePrompts(input.runtime)
  );
}

export function buildDaemonStopSuccessText(
  input: Extract<SharedDaemonStopResult, { status: "stopped" }>
): string {
  if (input.forcedAfterTimeout) {
    return `Service process (pid=${String(input.pid)}) was force killed.`;
  }
  if (input.signal === "system") {
    return "System service has been stopped.";
  }
  return `Service process (pid=${String(input.pid)}) stop request sent (${input.signal}).`;
}

export function buildDaemonStopWarningText(
  input: Extract<SharedDaemonStopResult, { status: "warning" }>
): string {
  if (input.reason === "invalid_state") {
    return "Service runtime state is invalid. Please retry with service status and run stop again.";
  }
  if (input.reason === "system_timeout") {
    return formatInlineOpenMeldCliCommands(
      "System service is still stopping. Check again with `openmeld service status`."
    );
  }
  if (input.reason === "process_timeout") {
    return formatInlineOpenMeldCliCommands(
      `Service process (pid=${String(input.pid)}) did not exit after ${String(STOP_WAIT_MS)}ms. Run \`openmeld service stop --force\` to kill.`
    );
  }
  const detail = input.errorMessage ? ` ${input.errorMessage}` : "";
  return formatInlineOpenMeldCliCommands(
    `OpenMeld could not stop the local service cleanly.${detail} Run \`openmeld service stop --force\` and retry.`
  );
}

export async function stopTrackedDaemonProcess(input: {
  pid: number;
  reason: string;
  signal: NodeJS.Signals;
}): Promise<boolean> {
  try {
    const terminated = await stopDaemonProcess(input.pid, input.signal);
    await emitDaemonLifecycleEvent({
      type: "process_stop.action",
      result:
        input.signal === "SIGTERM" && !terminated ? "timeout" : "completed",
      metadata: {
        pid: input.pid,
        reason: input.reason,
        signal: input.signal,
      },
      command: "openmeld service stop",
      intent: "stop",
    });
    return terminated;
  } catch (error) {
    await emitDaemonLifecycleEvent({
      type: "process_stop.action",
      result: "failed",
      metadata: {
        errorMessage: toErrorMessage(error),
        pid: input.pid,
        reason: input.reason,
        signal: input.signal,
      },
      command: "openmeld service stop",
      intent: "stop",
    });
    throw error;
  }
}

export async function confirmStopServiceManager(
  runtime: RuntimeContext,
  runtimeStatus: DaemonServiceRuntimeStatus
): Promise<boolean> {
  if (!canUseInteractivePrompts(runtime)) {
    return true;
  }

  const confirmed = await confirm({
    message: `Service is running in ${runtimeStatus.mode ?? "unknown"} system mode. Stop service now?`,
    initialValue: true,
  });

  return confirmed === true;
}

export async function confirmDaemonStopWithMode(
  runtimeContext: Awaited<ReturnType<typeof resolveRuntimeContext>>,
  runtimeStatus: DaemonServiceRuntimeStatus,
  force: boolean | undefined
): Promise<NodeJS.Signals | null> {
  if (!canUseInteractivePrompts(runtimeContext)) {
    return force ? "SIGKILL" : "SIGTERM";
  }

  const doStop = await confirm({
    message: `Service is running in ${runtimeStatus.mode ?? "unknown"} mode (pid=${String(runtimeStatus.pid)}). Stop it now?`,
    initialValue: true,
  });
  if (doStop !== true) {
    return null;
  }

  if (force) {
    return "SIGKILL";
  }

  const shouldForceKill = await confirm({
    message:
      "Force kill immediately? (recommended only if service does not stop cleanly)",
    initialValue: false,
  });
  return shouldForceKill ? "SIGKILL" : "SIGTERM";
}

export async function stopDaemonProcess(
  pid: number,
  signal: NodeJS.Signals
): Promise<boolean> {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (isNodeErrorCode(error, "ESRCH")) {
      return true;
    }
    throw new Error(
      `Failed to send ${signal} to pid ${String(pid)}: ${toErrorMessage(error)}`
    );
  }

  if (signal === "SIGKILL") {
    return true;
  }

  return await waitForProcessToExit(pid);
}

export async function waitForProcessToExit(pid: number): Promise<boolean> {
  const expiresAt = Date.now() + STOP_WAIT_MS;
  while (Date.now() < expiresAt) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_INTERVAL_MS));
  }
  return !isPidAlive(pid);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ESRCH")) {
      return false;
    }
    if (isNodeErrorCode(error, "EPERM")) {
      return true;
    }
    return false;
  }
}

export function isNodeErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    (error as NodeJS.ErrnoException).code === expectedCode
  );
}
