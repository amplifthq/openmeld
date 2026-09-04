import { randomUUID } from "node:crypto";
import type { OpenMeldToolsUpdateRequestSource } from "@openmeld/schemas/types";
import { sleep, toErrorMessage } from "@openmeld/utils";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import { withDaemonServiceReconcileLock } from "../../config/daemon-state";
import { compareSemver } from "../../config/version-state";
import { withManagedInstallTransaction } from "../../local-components/managed-install";
import {
  LocalDaemonControlPlaneClientError,
  requestLocalDaemonServiceUpdateReadiness,
} from "../control-plane/client";
import type { DaemonActiveBundleState } from "./daemon-service-bundle";
import { prepareDaemonServiceBundle } from "./daemon-service-bundle";
import type {
  DaemonServiceLifecycleOutcome,
  DaemonServiceLifecycleRecoveryStatus,
} from "./daemon-service-lifecycle";
import { runDaemonServiceLifecycle } from "./daemon-service-lifecycle";
import { readCurrentObservedDaemonRuntimeStatus } from "./daemon-service-runtime";
import {
  completePendingDaemonServiceUpdate,
  DAEMON_SERVICE_UPDATE_JOB_SCHEMA,
  type DaemonServiceUpdateJob,
  persistPendingDaemonServiceUpdate,
  readPendingDaemonServiceUpdate,
} from "./daemon-service-update-state";
import {
  installDaemonServiceUpdateWorker,
  prepareDaemonServiceUpdateWorkerCarrier,
  pruneDaemonServiceUpdateWorkerManagedVersions,
  registerDaemonServiceUpdateWorker,
  startDaemonServiceUpdateWorker,
} from "./daemon-service-update-worker-manager";

const MAX_BACKGROUND_UPDATE_ATTEMPTS = 5;

type DaemonServiceUpdateReconcileLock = <T>(
  run: () => Promise<T>
) => Promise<T>;

type ManagedInstallTransaction = <T>(run: () => Promise<T>) => Promise<T>;

type ScheduleDaemonServiceUpdateInput = {
  cliScriptPath?: string;
  operationId?: string;
  requestedAt?: string;
  requestSource?: OpenMeldToolsUpdateRequestSource;
  targetVersion: string;
  urgency: "available" | "required";
};

type ScheduleDaemonServiceUpdateDependencies = {
  createJobId: () => string;
  installWorker: (job: DaemonServiceUpdateJob) => Promise<void>;
  now: () => string;
  persistPendingJob: (job: DaemonServiceUpdateJob) => Promise<void>;
  prepareBundle: (input: {
    activate: false;
    daemonVersion: string;
    cliScriptPath?: string;
  }) => Promise<DaemonActiveBundleState>;
  prepareWorkerCarrier: (job: DaemonServiceUpdateJob) => Promise<void>;
  pruneWorkerVersions: (job: DaemonServiceUpdateJob) => Promise<void>;
  readPendingJob: () => Promise<DaemonServiceUpdateJob | null>;
  resolveDesiredState: () => Promise<"background" | "stopped">;
  startWorker: (job: DaemonServiceUpdateJob) => Promise<void>;
  withReconcileLock: DaemonServiceUpdateReconcileLock;
  withManagedInstallTransaction: ManagedInstallTransaction;
};

type RunPendingDaemonServiceUpdateDependencies = {
  completePendingJob: (job: DaemonServiceUpdateJob) => Promise<void>;
  now: () => string;
  persistPendingJob: (job: DaemonServiceUpdateJob) => Promise<void>;
  readPendingJob: () => Promise<DaemonServiceUpdateJob | null>;
  runLifecycle: (input: {
    expectedVersion: string;
    operation: "upgrade_reconcile";
    installSource: "cli.auto_check";
    desiredState: "background" | "stopped";
    shouldStartAfterLifecycle: boolean;
    forceReinstall: true;
    forceKillAfterDrainTimeout: false;
    preparedBundle: DaemonActiveBundleState;
  }) => Promise<
    Pick<DaemonServiceLifecycleOutcome, "errorMessage" | "status"> & {
      recoveryStatus?: DaemonServiceLifecycleRecoveryStatus;
    }
  >;
  waitUntilSafeToSwitch: (job: DaemonServiceUpdateJob) => Promise<void>;
  withReconcileLock: DaemonServiceUpdateReconcileLock;
};

export type ScheduleDaemonServiceUpdateResult = {
  job: DaemonServiceUpdateJob;
  status: "scheduled" | "already_scheduled";
};

export async function scheduleDaemonServiceUpdate(
  input: ScheduleDaemonServiceUpdateInput,
  overrides: Partial<ScheduleDaemonServiceUpdateDependencies> = {}
): Promise<ScheduleDaemonServiceUpdateResult> {
  const deps = resolveScheduleDependencies(overrides, {
    useDefaultLock: Object.keys(overrides).length === 0,
  });
  return await deps.withReconcileLock(
    async () => await scheduleDaemonServiceUpdateLocked(input, deps)
  );
}

async function scheduleDaemonServiceUpdateLocked(
  input: ScheduleDaemonServiceUpdateInput,
  deps: ScheduleDaemonServiceUpdateDependencies
): Promise<ScheduleDaemonServiceUpdateResult> {
  const pending = await deps.readPendingJob();
  if (pending) {
    return await reschedulePendingDaemonServiceUpdate({
      dependencies: deps,
      pending,
      request: input,
    });
  }

  const preparedBundle = await deps.prepareBundle({
    activate: false,
    daemonVersion: input.targetVersion,
    ...(input.cliScriptPath ? { cliScriptPath: input.cliScriptPath } : {}),
  });
  const now = deps.now();
  const job: DaemonServiceUpdateJob = {
    v: 2,
    schema: DAEMON_SERVICE_UPDATE_JOB_SCHEMA,
    attempts: 0,
    desiredState: await deps.resolveDesiredState(),
    errorMessage: null,
    jobId: input.operationId ?? deps.createJobId(),
    preparedBundle,
    requestedAt: input.requestedAt ?? now,
    phase: "waiting_for_work",
    requestSource: input.requestSource ?? "cli",
    targetVersion: input.targetVersion,
    updatedAt: now,
    urgency: input.urgency,
  };

  // Register the OS-owned worker before publishing the pending job. After the
  // atomic write, the initiating Terminal or browser is no longer responsible
  // for completing the update.
  await deps.withManagedInstallTransaction(async () => {
    await deps.prepareWorkerCarrier(job);
    await deps.installWorker(job);
    await deps.persistPendingJob(job);
  });
  await deps.startWorker(job);
  await pruneWorkerVersionsBestEffort({ dependencies: deps, job });
  return { job, status: "scheduled" };
}

async function reschedulePendingDaemonServiceUpdate(input: {
  dependencies: ScheduleDaemonServiceUpdateDependencies;
  pending: DaemonServiceUpdateJob;
  request: ScheduleDaemonServiceUpdateInput;
}): Promise<ScheduleDaemonServiceUpdateResult> {
  const replaceTarget = isNewerTargetVersion(
    input.request.targetVersion,
    input.pending.targetVersion
  );
  const escalateUrgency =
    input.request.urgency === "required" &&
    input.pending.urgency === "available";
  const retained: DaemonServiceUpdateJob =
    replaceTarget || escalateUrgency
      ? {
          ...input.pending,
          ...(replaceTarget
            ? {
                attempts: 0,
                errorMessage: null,
                phase: "waiting_for_work" as const,
                preparedBundle: await input.dependencies.prepareBundle({
                  activate: false,
                  daemonVersion: input.request.targetVersion,
                  ...(input.request.cliScriptPath
                    ? { cliScriptPath: input.request.cliScriptPath }
                    : {}),
                }),
                requestSource: input.request.requestSource ?? "cli",
                targetVersion: input.request.targetVersion,
              }
            : {}),
          updatedAt: input.dependencies.now(),
          urgency: escalateUrgency ? "required" : input.pending.urgency,
        }
      : input.pending;
  if (retained !== input.pending) {
    await input.dependencies.withManagedInstallTransaction(async () => {
      await input.dependencies.prepareWorkerCarrier(retained);
      await input.dependencies.persistPendingJob(retained);
    });
  }
  // A pending job proves the OS worker is already registered. Keep that
  // recovery carrier untouched until replacement state is durable, then wake
  // the existing worker against the same stable job path.
  await input.dependencies.startWorker(retained);
  if (retained !== input.pending) {
    await pruneWorkerVersionsBestEffort({
      dependencies: input.dependencies,
      job: retained,
    });
  }
  return { job: retained, status: "already_scheduled" };
}

async function pruneWorkerVersionsBestEffort(input: {
  dependencies: ScheduleDaemonServiceUpdateDependencies;
  job: DaemonServiceUpdateJob;
}): Promise<void> {
  await input.dependencies.pruneWorkerVersions(input.job).catch((error) => {
    console.warn("[openmeld.daemon_service.update_worker_prune_failed]", {
      errorMessage: toErrorMessage(error),
      operationId: input.job.jobId,
      targetVersion: input.job.targetVersion,
    });
  });
}

export async function runPendingDaemonServiceUpdate(
  overrides: Partial<RunPendingDaemonServiceUpdateDependencies> = {}
): Promise<DaemonServiceUpdateJob | null> {
  const deps = resolveRunDependencies(overrides, {
    useDefaultLock: Object.keys(overrides).length === 0,
  });
  const pending = await deps.withReconcileLock(
    async () => await preparePendingUpdateForSwitch(deps)
  );
  if (!pending) {
    return null;
  }
  if (pending.urgency === "available") {
    try {
      await deps.waitUntilSafeToSwitch(pending);
    } catch (waitError) {
      try {
        await deps.withReconcileLock(
          async () =>
            await recordSafeSwitchWaitFailure(deps, pending, waitError)
        );
      } catch (recordError) {
        throw new AggregateError(
          [waitError, recordError],
          "OpenMeld could not safely switch the Service or record the failure."
        );
      }
      throw waitError;
    }
  }
  return await deps.withReconcileLock(
    async () => await runPreparedPendingUpdate(deps)
  );
}

async function preparePendingUpdateForSwitch(
  deps: RunPendingDaemonServiceUpdateDependencies
): Promise<DaemonServiceUpdateJob | null> {
  const pending = await deps.readPendingJob();
  if (!pending) {
    return null;
  }
  if (pending.urgency === "available") {
    const waiting: DaemonServiceUpdateJob = {
      ...pending,
      errorMessage: null,
      phase: "waiting_for_work",
      updatedAt: deps.now(),
    };
    await deps.persistPendingJob(waiting);
    return waiting;
  }
  return pending;
}

async function recordSafeSwitchWaitFailure(
  deps: RunPendingDaemonServiceUpdateDependencies,
  waiting: DaemonServiceUpdateJob,
  error: unknown
): Promise<void> {
  const current = await deps.readPendingJob();
  if (!(current && isSameWaitingUpdate(current, waiting))) {
    return;
  }
  await deps.persistPendingJob({
    ...current,
    errorMessage: toErrorMessage(error),
    updatedAt: deps.now(),
  });
}

function isSameWaitingUpdate(
  current: DaemonServiceUpdateJob,
  waiting: DaemonServiceUpdateJob
): boolean {
  return (
    current.jobId === waiting.jobId &&
    current.targetVersion === waiting.targetVersion &&
    current.preparedBundle.bundleId === waiting.preparedBundle.bundleId &&
    current.urgency === waiting.urgency &&
    current.phase === "waiting_for_work" &&
    current.attempts === waiting.attempts
  );
}

async function runPreparedPendingUpdate(
  deps: RunPendingDaemonServiceUpdateDependencies
): Promise<DaemonServiceUpdateJob | null> {
  const pending = await deps.readPendingJob();
  if (!pending) {
    return null;
  }

  const running: DaemonServiceUpdateJob = {
    ...pending,
    attempts: pending.attempts + 1,
    errorMessage: null,
    phase: "updating",
    updatedAt: deps.now(),
  };
  await deps.persistPendingJob(running);

  try {
    const lifecycle = await deps.runLifecycle({
      desiredState: running.desiredState,
      expectedVersion: running.targetVersion,
      forceKillAfterDrainTimeout: false,
      forceReinstall: true,
      installSource: "cli.auto_check",
      operation: "upgrade_reconcile",
      preparedBundle: running.preparedBundle,
      shouldStartAfterLifecycle: running.desiredState === "background",
    });
    if (
      lifecycle.status !== "aligned" &&
      lifecycle.status !== "already_aligned"
    ) {
      const failed = finishJob(running, {
        errorMessage:
          lifecycle.errorMessage ||
          "OpenMeld restored the previous Service after the replacement did not become healthy.",
        now: deps.now(),
        phase:
          lifecycle.recoveryStatus === "restored_verified_previous_state"
            ? "restored"
            : "needs_help",
      });
      await deps.completePendingJob(failed);
      return failed;
    }

    const completed = finishJob(running, {
      errorMessage: null,
      now: deps.now(),
      phase: "updated",
    });
    await deps.completePendingJob(completed);
    return completed;
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    if (running.attempts < MAX_BACKGROUND_UPDATE_ATTEMPTS) {
      const retry: DaemonServiceUpdateJob = {
        ...running,
        errorMessage,
        phase: "waiting_for_work",
        updatedAt: deps.now(),
      };
      await deps.persistPendingJob(retry);
      throw error;
    }
    const failed = finishJob(running, {
      errorMessage,
      now: deps.now(),
      phase: "needs_help",
    });
    await deps.completePendingJob(failed);
    return failed;
  }
}

function resolveScheduleDependencies(
  overrides: Partial<ScheduleDaemonServiceUpdateDependencies>,
  options: { useDefaultLock: boolean }
): ScheduleDaemonServiceUpdateDependencies {
  return {
    createJobId: overrides.createJobId ?? randomUUID,
    installWorker:
      overrides.installWorker ??
      (options.useDefaultLock
        ? registerDaemonServiceUpdateWorker
        : installDaemonServiceUpdateWorker),
    now: overrides.now ?? (() => new Date().toISOString()),
    persistPendingJob:
      overrides.persistPendingJob ?? persistPendingDaemonServiceUpdate,
    prepareBundle: overrides.prepareBundle ?? prepareDaemonServiceBundle,
    prepareWorkerCarrier:
      overrides.prepareWorkerCarrier ??
      (options.useDefaultLock
        ? prepareDaemonServiceUpdateWorkerCarrier
        : async () => undefined),
    pruneWorkerVersions:
      overrides.pruneWorkerVersions ??
      pruneDaemonServiceUpdateWorkerManagedVersions,
    readPendingJob: overrides.readPendingJob ?? readPendingDaemonServiceUpdate,
    resolveDesiredState:
      overrides.resolveDesiredState ?? resolveCurrentDaemonDesiredState,
    startWorker: overrides.startWorker ?? startDaemonServiceUpdateWorker,
    withReconcileLock:
      overrides.withReconcileLock ??
      (options.useDefaultLock
        ? withDaemonServiceUpdateScheduleLock
        : runWithoutReconcileLock),
    withManagedInstallTransaction:
      overrides.withManagedInstallTransaction ??
      (options.useDefaultLock
        ? withManagedInstallTransaction
        : runWithoutReconcileLock),
  };
}

function resolveRunDependencies(
  overrides: Partial<RunPendingDaemonServiceUpdateDependencies>,
  options: { useDefaultLock: boolean }
): RunPendingDaemonServiceUpdateDependencies {
  return {
    completePendingJob:
      overrides.completePendingJob ?? completePendingDaemonServiceUpdate,
    now: overrides.now ?? (() => new Date().toISOString()),
    persistPendingJob:
      overrides.persistPendingJob ?? persistPendingDaemonServiceUpdate,
    readPendingJob: overrides.readPendingJob ?? readPendingDaemonServiceUpdate,
    runLifecycle: overrides.runLifecycle ?? runDaemonServiceLifecycle,
    waitUntilSafeToSwitch:
      overrides.waitUntilSafeToSwitch ?? waitUntilDaemonServiceSafeSwitch,
    withReconcileLock:
      overrides.withReconcileLock ??
      (options.useDefaultLock
        ? withDaemonServiceUpdateWorkerLock
        : runWithoutReconcileLock),
  };
}

async function withDaemonServiceUpdateScheduleLock<T>(
  run: () => Promise<T>
): Promise<T> {
  return await withDaemonServiceReconcileLock(run, {
    command: "openmeld service update",
    intent: "upgrade_reconcile",
  });
}

async function withDaemonServiceUpdateWorkerLock<T>(
  run: () => Promise<T>
): Promise<T> {
  return await withDaemonServiceReconcileLock(run, {
    command: "openmeld service update-worker",
    intent: "upgrade_reconcile",
  });
}

async function runWithoutReconcileLock<T>(run: () => Promise<T>): Promise<T> {
  return await run();
}

export async function waitUntilDaemonServiceSafeSwitch(
  job: DaemonServiceUpdateJob,
  overrides: {
    readPendingJob?: () => Promise<DaemonServiceUpdateJob | null>;
    readRuntimeStatus?: typeof readCurrentObservedDaemonRuntimeStatus;
    requestReadiness?: typeof requestLocalDaemonServiceUpdateReadiness;
    sleep?: typeof sleep;
  } = {}
): Promise<void> {
  const readPendingJob =
    overrides.readPendingJob ?? readPendingDaemonServiceUpdate;
  const readRuntimeStatus =
    overrides.readRuntimeStatus ?? readCurrentObservedDaemonRuntimeStatus;
  const requestReadiness =
    overrides.requestReadiness ?? requestLocalDaemonServiceUpdateReadiness;
  const wait = overrides.sleep ?? sleep;
  while (true) {
    const pending = await readPendingJob();
    if (
      pending === null ||
      pending.jobId !== job.jobId ||
      pending.urgency === "required"
    ) {
      return;
    }
    try {
      const readiness = await requestReadiness();
      if (readiness.safeToSwitch) {
        return;
      }
    } catch (error) {
      if (
        error instanceof LocalDaemonControlPlaneClientError &&
        error.code === "daemon.control.contract_mismatch"
      ) {
        // Compatibility bridge for the one update from a Service that predates
        // this read-only readiness command. The existing controlled drain is
        // still authoritative and still waits for accepted work plus durable
        // result acknowledgement before allowing the switch.
        return;
      }
      const runtime = await readRuntimeStatus().catch(() => null);
      if (!runtime || runtime.status !== "running") {
        return;
      }
    }
    await wait(2000);
  }
}

async function resolveCurrentDaemonDesiredState(): Promise<
  "background" | "stopped"
> {
  const contract = await readDaemonServiceContract().catch(() => null);
  if (contract) {
    return contract.desiredState;
  }
  const runtime = await readCurrentObservedDaemonRuntimeStatus();
  return runtime.status === "running" && runtime.mode === "background"
    ? "background"
    : "stopped";
}

function finishJob(
  job: DaemonServiceUpdateJob,
  input: {
    errorMessage: string | null;
    now: string;
    phase: "updated" | "restored" | "needs_help";
  }
): DaemonServiceUpdateJob {
  return {
    ...job,
    errorMessage: input.errorMessage,
    phase: input.phase,
    updatedAt: input.now,
  };
}

function isNewerTargetVersion(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}
