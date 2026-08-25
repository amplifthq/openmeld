import { randomUUID } from "node:crypto";
import type { OpenMeldToolsUpdateRequestSource } from "@openmeld/schemas/types";
import { sleep, toErrorMessage } from "@openmeld/utils";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import { withDaemonServiceReconcileLock } from "../../config/daemon-state";
import { compareSemver } from "../../config/version-state";
import {
  LocalDaemonControlPlaneClientError,
  requestLocalDaemonServiceUpdateReadiness,
} from "../control-plane/client";
import type { DaemonActiveBundleState } from "./daemon-service-bundle";
import {
  discardPreparedDaemonServiceBundle,
  prepareDaemonServiceBundle,
} from "./daemon-service-bundle";
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
  startDaemonServiceUpdateWorker,
} from "./daemon-service-update-worker-manager";

const MAX_BACKGROUND_UPDATE_ATTEMPTS = 5;

type ScheduleDaemonServiceUpdateInput = {
  cliScriptPath?: string;
  requestSource?: OpenMeldToolsUpdateRequestSource;
  targetVersion: string;
  urgency: "available" | "required";
};

type ScheduleDaemonServiceUpdateDependencies = {
  createJobId: () => string;
  discardBundle: (bundle: DaemonActiveBundleState) => Promise<void>;
  installWorker: (job: DaemonServiceUpdateJob) => Promise<void>;
  now: () => string;
  persistPendingJob: (job: DaemonServiceUpdateJob) => Promise<void>;
  prepareBundle: (input: {
    activate: false;
    daemonVersion: string;
    cliScriptPath?: string;
  }) => Promise<DaemonActiveBundleState>;
  readPendingJob: () => Promise<DaemonServiceUpdateJob | null>;
  resolveDesiredState: () => Promise<"background" | "stopped">;
  startWorker: (job: DaemonServiceUpdateJob) => Promise<void>;
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
};

export type ScheduleDaemonServiceUpdateResult = {
  job: DaemonServiceUpdateJob;
  status: "scheduled" | "already_scheduled";
};

export async function scheduleDaemonServiceUpdate(
  input: ScheduleDaemonServiceUpdateInput,
  overrides: Partial<ScheduleDaemonServiceUpdateDependencies> = {}
): Promise<ScheduleDaemonServiceUpdateResult> {
  if (Object.keys(overrides).length === 0) {
    return await withDaemonServiceReconcileLock(
      async () =>
        await scheduleDaemonServiceUpdate(input, defaultScheduleOverrides()),
      {
        command: "openmeld service update",
        intent: "upgrade_reconcile",
      }
    );
  }
  const deps = resolveScheduleDependencies(overrides);
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
    jobId: deps.createJobId(),
    preparedBundle,
    requestedAt: now,
    phase: "waiting_for_work",
    requestSource: input.requestSource ?? "cli",
    targetVersion: input.targetVersion,
    updatedAt: now,
    urgency: input.urgency,
  };

  // Register the OS-owned worker before publishing the pending job. After the
  // atomic write, the initiating Terminal or browser is no longer responsible
  // for completing the update.
  await deps.installWorker(job);
  await deps.persistPendingJob(job);
  await deps.startWorker(job);
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
  await input.dependencies.installWorker(retained);
  if (retained !== input.pending) {
    await input.dependencies.persistPendingJob(retained);
  }
  await input.dependencies.startWorker(retained);
  if (replaceTarget) {
    await discardReplacedBundleBestEffort({
      dependencies: input.dependencies,
      pending: input.pending,
    });
  }
  return { job: retained, status: "already_scheduled" };
}

async function discardReplacedBundleBestEffort(input: {
  dependencies: ScheduleDaemonServiceUpdateDependencies;
  pending: DaemonServiceUpdateJob;
}): Promise<void> {
  await input.dependencies
    .discardBundle(input.pending.preparedBundle)
    .catch((error) => {
      console.warn("[openmeld.daemon_service.update_bundle_cleanup_failed]", {
        bundleId: input.pending.preparedBundle.bundleId,
        errorMessage: toErrorMessage(error),
        operationId: input.pending.jobId,
      });
    });
}

export async function runPendingDaemonServiceUpdate(
  overrides: Partial<RunPendingDaemonServiceUpdateDependencies> = {}
): Promise<DaemonServiceUpdateJob | null> {
  if (Object.keys(overrides).length === 0) {
    const deps = resolveRunDependencies(defaultRunOverrides());
    const pending = await preparePendingUpdateForSwitch(deps);
    if (!pending) {
      return null;
    }
    return await withDaemonServiceReconcileLock(
      async () => await runPreparedPendingUpdate(deps),
      {
        command: "openmeld service update-worker",
        intent: "upgrade_reconcile",
      }
    );
  }
  const deps = resolveRunDependencies(overrides);
  const pending = await preparePendingUpdateForSwitch(deps);
  if (!pending) {
    return null;
  }
  return await runPreparedPendingUpdate(deps);
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
    try {
      await deps.waitUntilSafeToSwitch(waiting);
    } catch (error) {
      await deps.persistPendingJob({
        ...waiting,
        errorMessage: toErrorMessage(error),
        updatedAt: deps.now(),
      });
      throw error;
    }
    return waiting;
  }
  return pending;
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

function defaultScheduleOverrides(): Partial<ScheduleDaemonServiceUpdateDependencies> {
  return {
    createJobId: randomUUID,
    discardBundle: discardPreparedDaemonServiceBundle,
    installWorker: installDaemonServiceUpdateWorker,
    now: () => new Date().toISOString(),
    persistPendingJob: persistPendingDaemonServiceUpdate,
    prepareBundle: prepareDaemonServiceBundle,
    readPendingJob: readPendingDaemonServiceUpdate,
    resolveDesiredState: resolveCurrentDaemonDesiredState,
    startWorker: startDaemonServiceUpdateWorker,
  };
}

function defaultRunOverrides(): Partial<RunPendingDaemonServiceUpdateDependencies> {
  return {
    completePendingJob: completePendingDaemonServiceUpdate,
    now: () => new Date().toISOString(),
    persistPendingJob: persistPendingDaemonServiceUpdate,
    readPendingJob: readPendingDaemonServiceUpdate,
    runLifecycle: runDaemonServiceLifecycle,
    waitUntilSafeToSwitch: waitUntilDaemonServiceSafeSwitch,
  };
}

function resolveScheduleDependencies(
  overrides: Partial<ScheduleDaemonServiceUpdateDependencies>
): ScheduleDaemonServiceUpdateDependencies {
  return {
    createJobId: overrides.createJobId ?? randomUUID,
    discardBundle:
      overrides.discardBundle ?? discardPreparedDaemonServiceBundle,
    installWorker: overrides.installWorker ?? installDaemonServiceUpdateWorker,
    now: overrides.now ?? (() => new Date().toISOString()),
    persistPendingJob:
      overrides.persistPendingJob ?? persistPendingDaemonServiceUpdate,
    prepareBundle: overrides.prepareBundle ?? prepareDaemonServiceBundle,
    readPendingJob: overrides.readPendingJob ?? readPendingDaemonServiceUpdate,
    resolveDesiredState:
      overrides.resolveDesiredState ?? resolveCurrentDaemonDesiredState,
    startWorker: overrides.startWorker ?? startDaemonServiceUpdateWorker,
  };
}

function resolveRunDependencies(
  overrides: Partial<RunPendingDaemonServiceUpdateDependencies>
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
  };
}

async function waitUntilDaemonServiceSafeSwitch(
  job: DaemonServiceUpdateJob
): Promise<void> {
  while (true) {
    const pending = await readPendingDaemonServiceUpdate();
    if (
      pending === null ||
      pending.jobId !== job.jobId ||
      pending.urgency === "required"
    ) {
      return;
    }
    try {
      const readiness = await requestLocalDaemonServiceUpdateReadiness();
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
      const runtime = await readCurrentObservedDaemonRuntimeStatus().catch(
        () => null
      );
      if (!runtime || runtime.status !== "running") {
        return;
      }
    }
    await sleep(2000);
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
