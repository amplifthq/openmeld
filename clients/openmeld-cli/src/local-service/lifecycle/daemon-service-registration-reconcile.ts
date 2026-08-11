import {
  resolveDaemonServiceRuntimeMetadata,
  withDaemonServiceRegistrationMutationLock,
} from "../../config/daemon-state";
import { emitDaemonLifecycleEvent } from "./daemon-lifecycle-journal";
import {
  buildDaemonSystemServiceCommandSpec,
  ensureDaemonSystemServiceCommandFiles,
} from "./daemon-service-command-spec";
import type { DaemonServiceManager } from "./daemon-service-manager";
import { resolveDaemonServiceManager } from "./daemon-service-manager";
import {
  clearDaemonServiceRegistrationRepairPending,
  markDaemonServiceRegistrationRepairPending,
  readDaemonServiceRegistrationRepairState,
} from "./daemon-service-registration-repair-state";

const DEFAULT_RECONCILE_INTERVAL_MS = 10 * 60_000;
const STATUS_PROBE_TIMEOUT_MS = 10_000;
const STOP_SIGNAL_PROBE_TIMEOUT_MS = 2500;
const MAX_CONSECUTIVE_REPAIR_FAILURES = 3;

export type SupervisorRegistrationObservation = {
  installed: boolean;
  running: boolean;
  enabled: boolean;
};

export type SupervisorRegistrationReconcileDecision =
  | {
      action: "repair";
      reason: "registration_missing" | "repair_incomplete";
    }
  | {
      action: "none";
      reason:
        | "registration_present"
        | "not_supervised"
        | "status_unavailable"
        | "repair_exhausted";
    };

/**
 * The OS supervisor registration (launchd plist / systemd unit / Windows
 * service) is the only thing that restarts OpenMeld Service after a crash or
 * an external kill. A supervised daemon therefore treats a missing
 * registration as recoverable drift and re-installs the registration files.
 * It never boots or starts the job — this process already is the job, and a
 * second spawn would race it.
 */
export function resolveSupervisorRegistrationReconcileDecision(input: {
  consecutiveRepairFailures: number;
  managedBySystemService: boolean;
  observation: SupervisorRegistrationObservation | null;
  repairPending: boolean;
}): SupervisorRegistrationReconcileDecision {
  if (!input.managedBySystemService) {
    return { action: "none", reason: "not_supervised" };
  }
  if (!input.observation) {
    return { action: "none", reason: "status_unavailable" };
  }
  if (input.observation.installed && input.observation.enabled) {
    return { action: "none", reason: "registration_present" };
  }
  if (
    input.observation.installed &&
    !(input.repairPending && !input.observation.enabled)
  ) {
    return { action: "none", reason: "registration_present" };
  }
  if (input.consecutiveRepairFailures >= MAX_CONSECUTIVE_REPAIR_FAILURES) {
    return { action: "none", reason: "repair_exhausted" };
  }
  if (input.observation.installed) {
    return { action: "repair", reason: "repair_incomplete" };
  }
  return { action: "repair", reason: "registration_missing" };
}

export function startDaemonServiceRegistrationReconcileLoop(input: {
  intervalMs?: number;
  isStopRequested: () => boolean;
  onWarn?: (message: string, payload?: Record<string, unknown>) => void;
}): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let consecutiveRepairFailures = 0;
  let exhaustionJournaled = false;

  const run = () => {
    if (stopped || inFlight || input.isStopRequested()) {
      return;
    }
    inFlight = withDaemonServiceRegistrationMutationLock(
      async () =>
        await reconcileSupervisorRegistrationOnce({
          consecutiveRepairFailures,
          isStopRequested: input.isStopRequested,
          exhaustionJournaled,
          onWarn: input.onWarn,
        }),
      {
        intent: "upgrade_reconcile",
        command: "OpenMeld Service registration reconcile",
      }
    )
      .then((outcome) => {
        consecutiveRepairFailures = outcome.consecutiveRepairFailures;
        exhaustionJournaled = outcome.exhaustionJournaled;
      })
      .catch((error) => {
        input.onWarn?.(
          `supervisor registration reconcile failed: ${toErrorMessage(error)}`
        );
      })
      .finally(() => {
        inFlight = null;
      });
  };

  const timer = setInterval(
    run,
    input.intervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS
  );
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}

async function reconcileSupervisorRegistrationOnce(input: {
  consecutiveRepairFailures: number;
  exhaustionJournaled: boolean;
  isStopRequested: () => boolean;
  onWarn?: (message: string, payload?: Record<string, unknown>) => void;
}): Promise<{
  consecutiveRepairFailures: number;
  exhaustionJournaled: boolean;
}> {
  const unchanged = {
    consecutiveRepairFailures: input.consecutiveRepairFailures,
    exhaustionJournaled: input.exhaustionJournaled,
  };
  const runtimeMetadata = resolveDaemonServiceRuntimeMetadata();
  if (!runtimeMetadata.managedBySystemService) {
    return unchanged;
  }
  const manager = await resolveDaemonServiceManager(
    runtimeMetadata.serviceController ?? undefined
  );
  if (!manager) {
    input.onWarn?.(
      "supervisor registration manager was unavailable; skipping this reconcile pass",
      {
        controller: runtimeMetadata.serviceController,
      }
    );
    return unchanged;
  }
  let observationErrorMessage: string | null = null;
  const observation = await observeSupervisorRegistration(
    manager,
    STATUS_PROBE_TIMEOUT_MS,
    (error) => {
      observationErrorMessage = toErrorMessage(error);
    }
  );
  const repairState = await readDaemonServiceRegistrationRepairState();
  if (repairState && repairState.controller !== manager.controller) {
    throw new Error(
      `service registration repair state belongs to ${repairState.controller}, not ${manager.controller}`
    );
  }
  const decision = resolveSupervisorRegistrationReconcileDecision({
    consecutiveRepairFailures: input.consecutiveRepairFailures,
    managedBySystemService: runtimeMetadata.managedBySystemService,
    observation,
    repairPending: repairState !== null,
  });

  if (decision.action === "none") {
    if (decision.reason === "registration_present") {
      if (repairState) {
        await clearDaemonServiceRegistrationRepairPending();
      }
      return {
        consecutiveRepairFailures: 0,
        exhaustionJournaled: false,
      };
    }
    if (decision.reason === "status_unavailable") {
      input.onWarn?.(
        "supervisor registration status probe was unavailable; skipping this reconcile pass",
        {
          controller: manager.controller,
          errorMessage: observationErrorMessage,
        }
      );
      return unchanged;
    }
    if (decision.reason === "repair_exhausted" && !input.exhaustionJournaled) {
      await emitDaemonLifecycleEvent({
        type: "service_manager.registration_reconcile",
        result: "repair_exhausted",
        metadata: {
          consecutiveRepairFailures: input.consecutiveRepairFailures,
          controller: manager.controller,
        },
      });
      return { ...unchanged, exhaustionJournaled: true };
    }
    return unchanged;
  }

  await emitDaemonLifecycleEvent({
    type: "service_manager.registration_reconcile",
    result: "drift_detected",
    metadata: {
      controller: manager.controller,
      observation: observation
        ? {
            enabled: observation.enabled,
            installed: observation.installed,
            running: observation.running,
          }
        : null,
    },
  });

  if (input.isStopRequested()) {
    return unchanged;
  }

  try {
    await markDaemonServiceRegistrationRepairPending(manager.controller);
    await ensureDaemonSystemServiceCommandFiles({
      controller: manager.controller,
    });
    await manager.install(
      buildDaemonSystemServiceCommandSpec({ controller: manager.controller })
    );
    await clearDaemonServiceRegistrationRepairPending();
    await emitDaemonLifecycleEvent({
      type: "service_manager.registration_reconcile",
      result: "repaired",
      metadata: { controller: manager.controller },
    });
    return {
      consecutiveRepairFailures: 0,
      exhaustionJournaled: false,
    };
  } catch (error) {
    const nextFailures = input.consecutiveRepairFailures + 1;
    await emitDaemonLifecycleEvent({
      type: "service_manager.registration_reconcile",
      result: "repair_failed",
      metadata: {
        consecutiveRepairFailures: nextFailures,
        controller: manager.controller,
        errorMessage: toErrorMessage(error),
        errorMessages: collectErrorMessages(error),
      },
    });
    return {
      consecutiveRepairFailures: nextFailures,
      exhaustionJournaled: false,
    };
  }
}

export async function observeSupervisorRegistration(
  manager: DaemonServiceManager,
  timeoutMs: number = STATUS_PROBE_TIMEOUT_MS,
  onError?: (error: unknown) => void
): Promise<SupervisorRegistrationObservation | null> {
  try {
    const status = await withProbeTimeout(manager.status(), timeoutMs);
    return {
      enabled: status.enabled,
      installed: status.installed,
      running: status.running,
    };
  } catch (error) {
    onError?.(error);
    return null;
  }
}

/**
 * Fire-and-forget stop-signal evidence. An external `launchctl bootout` or
 * uninstall delivers a plain SIGTERM and leaves no trace in this lane's
 * journal, so the daemon snapshots its own supervisor registration while
 * shutting down: a missing registration in this event is the durable proof
 * that the supervisor was torn down externally. Never blocks shutdown.
 */
export function journalDaemonStopSignalEvidence(
  signal: "SIGINT" | "SIGTERM",
  input: {
    onWarn?: (message: string, payload?: Record<string, unknown>) => void;
  } = {}
): void {
  collectDaemonStopSignalEvidence(signal).catch((error) => {
    input.onWarn?.("stop-signal supervisor evidence collection failed", {
      errorMessage: toErrorMessage(error),
      signal,
    });
  });
}

async function collectDaemonStopSignalEvidence(
  signal: "SIGINT" | "SIGTERM"
): Promise<void> {
  const runtimeMetadata = resolveDaemonServiceRuntimeMetadata();
  let supervisorRegistrationError: string | null = null;
  let manager: DaemonServiceManager | null = null;
  if (runtimeMetadata.managedBySystemService) {
    try {
      manager = await resolveDaemonServiceManager(
        runtimeMetadata.serviceController ?? undefined
      );
    } catch (error) {
      supervisorRegistrationError = toErrorMessage(error);
    }
  }
  const observation = manager
    ? await observeSupervisorRegistration(
        manager,
        STOP_SIGNAL_PROBE_TIMEOUT_MS,
        (error) => {
          supervisorRegistrationError = toErrorMessage(error);
        }
      )
    : null;
  await emitDaemonLifecycleEvent({
    type: "stop.signal.observed",
    result: "observed",
    metadata: {
      controller: manager?.controller ?? null,
      managedBySystemService: runtimeMetadata.managedBySystemService,
      signal,
      supervisorRegistration: observation
        ? {
            enabled: observation.enabled,
            installed: observation.installed,
            running: observation.running,
          }
        : null,
      supervisorRegistrationError,
    },
  });
}

async function withProbeTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("supervisor registration status probe timed out"));
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (visited.has(value)) {
      return;
    }
    visited.add(value);
    messages.push(toErrorMessage(value));
    if (value instanceof AggregateError) {
      for (const nestedError of value.errors) {
        visit(nestedError);
      }
    }
    if (value instanceof Error && value.cause !== undefined) {
      visit(value.cause);
    }
  };
  visit(error);
  return [...new Set(messages)];
}
