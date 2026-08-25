import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  daemonServiceUpdateJobSchema,
  OPENMELD_DAEMON_SERVICE_UPDATE_JOB_SCHEMA,
  type DaemonServiceUpdateJob as SharedDaemonServiceUpdateJob,
} from "@openmeld/schemas";
import { sleep, toErrorMessage } from "@openmeld/utils";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import {
  daemonRuntimeStateRootPath,
  withDaemonServiceReconcileLock,
} from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import {
  LocalDaemonControlPlaneClientError,
  requestLocalDaemonServiceUpdateReadiness,
} from "../control-plane/client";
import type { DaemonActiveBundleState } from "./daemon-service-bundle";
import { prepareDaemonServiceBundle } from "./daemon-service-bundle";
import type { DaemonServiceLifecycleOutcome } from "./daemon-service-lifecycle";
import { runDaemonServiceLifecycle } from "./daemon-service-lifecycle";
import { readCurrentObservedDaemonRuntimeStatus } from "./daemon-service-runtime";
import {
  installDaemonServiceUpdateWorker,
  startDaemonServiceUpdateWorker,
} from "./daemon-service-update-worker-manager";

const MAX_BACKGROUND_UPDATE_ATTEMPTS = 5;

export const DAEMON_SERVICE_UPDATE_JOB_SCHEMA =
  OPENMELD_DAEMON_SERVICE_UPDATE_JOB_SCHEMA;
export type DaemonServiceUpdateJob = SharedDaemonServiceUpdateJob;

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
  }) => Promise<Pick<DaemonServiceLifecycleOutcome, "errorMessage" | "status">>;
  waitUntilSafeToSwitch: (job: DaemonServiceUpdateJob) => Promise<void>;
};

export type ScheduleDaemonServiceUpdateResult = {
  job: DaemonServiceUpdateJob;
  status: "scheduled" | "already_scheduled";
};

export async function scheduleDaemonServiceUpdate(
  input: {
    cliScriptPath?: string;
    targetVersion: string;
    urgency: "available" | "required";
  },
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
    const retained =
      input.urgency === "required" && pending.urgency === "available"
        ? {
            ...pending,
            updatedAt: deps.now(),
            urgency: "required" as const,
          }
        : pending;
    await deps.installWorker(retained);
    if (retained !== pending) {
      await deps.persistPendingJob(retained);
    }
    await deps.startWorker(retained);
    return { job: retained, status: "already_scheduled" };
  }

  const preparedBundle = await deps.prepareBundle({
    activate: false,
    daemonVersion: input.targetVersion,
    ...(input.cliScriptPath ? { cliScriptPath: input.cliScriptPath } : {}),
  });
  const now = deps.now();
  const job: DaemonServiceUpdateJob = {
    v: 1,
    schema: DAEMON_SERVICE_UPDATE_JOB_SCHEMA,
    attempts: 0,
    desiredState: await deps.resolveDesiredState(),
    errorMessage: null,
    jobId: deps.createJobId(),
    preparedBundle,
    requestedAt: now,
    status: "scheduled",
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

export async function runPendingDaemonServiceUpdate(
  overrides: Partial<RunPendingDaemonServiceUpdateDependencies> = {}
): Promise<DaemonServiceUpdateJob | null> {
  if (Object.keys(overrides).length === 0) {
    return await withDaemonServiceReconcileLock(
      async () => await runPendingDaemonServiceUpdate(defaultRunOverrides()),
      {
        command: "openmeld service update-worker",
        intent: "upgrade_reconcile",
      }
    );
  }
  const deps = resolveRunDependencies(overrides);
  const pending = await deps.readPendingJob();
  if (!pending) {
    return null;
  }

  const running: DaemonServiceUpdateJob = {
    ...pending,
    attempts: pending.attempts + 1,
    errorMessage: null,
    status: "running",
    updatedAt: deps.now(),
  };
  await deps.persistPendingJob(running);

  try {
    if (running.urgency === "available") {
      await deps.waitUntilSafeToSwitch(running);
    }
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
    if (lifecycle.status !== "aligned") {
      const failed = finishJob(running, {
        errorMessage:
          lifecycle.errorMessage ||
          "OpenMeld restored the previous Service after the replacement did not become healthy.",
        now: deps.now(),
        status: "failed",
      });
      await deps.completePendingJob(failed);
      return failed;
    }

    const completed = finishJob(running, {
      errorMessage: null,
      now: deps.now(),
      status: "completed",
    });
    await deps.completePendingJob(completed);
    return completed;
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    if (running.attempts < MAX_BACKGROUND_UPDATE_ATTEMPTS) {
      const retry: DaemonServiceUpdateJob = {
        ...running,
        errorMessage,
        status: "scheduled",
        updatedAt: deps.now(),
      };
      await deps.persistPendingJob(retry);
      throw error;
    }
    const failed = finishJob(running, {
      errorMessage,
      now: deps.now(),
      status: "failed",
    });
    await deps.completePendingJob(failed);
    return failed;
  }
}

function defaultScheduleOverrides(): Partial<ScheduleDaemonServiceUpdateDependencies> {
  return {
    createJobId: randomUUID,
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

export function daemonServicePendingUpdatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeStateRootPath(pathInput), "service-update.json");
}

export function daemonServiceLastUpdatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeStateRootPath(pathInput),
    "service-update-last.json"
  );
}

export async function readPendingDaemonServiceUpdate(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceUpdateJob | null> {
  const raw = await readFile(
    daemonServicePendingUpdatePath(pathInput),
    "utf8"
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }
  return parseDaemonServiceUpdateJob(JSON.parse(raw) as unknown);
}

export async function persistPendingDaemonServiceUpdate(
  job: DaemonServiceUpdateJob,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeUpdateJobAtomically({
    job,
    path: daemonServicePendingUpdatePath(pathInput),
  });
}

export async function completePendingDaemonServiceUpdate(
  job: DaemonServiceUpdateJob,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeUpdateJobAtomically({
    job,
    path: daemonServiceLastUpdatePath(pathInput),
  });
  await rm(daemonServicePendingUpdatePath(pathInput), { force: true });
}

function resolveScheduleDependencies(
  overrides: Partial<ScheduleDaemonServiceUpdateDependencies>
): ScheduleDaemonServiceUpdateDependencies {
  return {
    createJobId: overrides.createJobId ?? randomUUID,
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

async function waitUntilDaemonServiceSafeSwitch(): Promise<void> {
  while (true) {
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
    status: "completed" | "failed";
  }
): DaemonServiceUpdateJob {
  return {
    ...job,
    errorMessage: input.errorMessage,
    status: input.status,
    updatedAt: input.now,
  };
}

async function writeUpdateJobAtomically(input: {
  job: DaemonServiceUpdateJob;
  path: string;
}): Promise<void> {
  const temporaryPath = `${input.path}.${String(process.pid)}.tmp`;
  await mkdir(dirname(input.path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(input.job, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, input.path);
}

function parseDaemonServiceUpdateJob(value: unknown): DaemonServiceUpdateJob {
  const parsed = daemonServiceUpdateJobSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("OpenMeld Service update state is invalid.");
  }
  return parsed.data;
}
