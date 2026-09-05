import { randomUUID } from "node:crypto";
import type {
  DaemonServiceUpdateJob,
  OpenMeldToolsUpdateAttempt,
  OpenMeldToolsUpdateOperation,
  OpenMeldToolsUpdateRequestSource,
} from "@openmeld/schemas/types";
import { toErrorMessage } from "@openmeld/utils";
import {
  assessCliUpdate,
  type CliUpdateAssessment,
} from "../../command-entry-checks/cli-update-assessment";
import { resolveServiceUpdateUrgency } from "../../command-entry-checks/service-update-urgency";
import { withDaemonServiceReconcileLock } from "../../config/daemon-state";
import { resolveOpenMeldEnvironmentTarget } from "../../config/openmeld-environment-target";
import { readPendingDaemonServiceUpdate } from "../lifecycle/daemon-service-update-state";
import { startDaemonServiceUpdateWorker } from "../lifecycle/daemon-service-update-worker-manager";
import {
  type OpenMeldToolsMaintenancePolicy,
  readOpenMeldToolsMaintenancePolicy,
} from "./openmeld-tools-maintenance-policy";
import {
  completeOpenMeldToolsUpdateAttempt,
  discardPendingOpenMeldToolsUpdateAttempt,
  persistOpenMeldToolsUpdateAttempt,
  readPendingOpenMeldToolsUpdateAttempt,
} from "./openmeld-tools-update-attempt-state";
import type { OpenMeldToolsUpdateContext } from "./openmeld-tools-update-context";
import {
  type OpenMeldToolsUpgradeProcessResult,
  runOpenMeldToolsUpgradeProcess,
} from "./openmeld-tools-upgrade-process";

type OpenMeldToolsUpdateCoordinatorDependencies = {
  withCoordinationLock: <T>(run: () => Promise<T>) => Promise<T>;
  wakeWorker: () => Promise<void>;
  assessUpdate: (input: {
    forceRefresh: boolean;
  }) => Promise<CliUpdateAssessment>;
  completeAttempt: (attempt: OpenMeldToolsUpdateAttempt) => Promise<void>;
  createOperationId: () => string;
  discardPendingAttempt: () => Promise<void>;
  now: () => string;
  persistAttempt: (attempt: OpenMeldToolsUpdateAttempt) => Promise<void>;
  readPendingAttempt: () => Promise<OpenMeldToolsUpdateAttempt | null>;
  readPendingServiceJob: () => Promise<DaemonServiceUpdateJob | null>;
  readPolicy: () => Promise<OpenMeldToolsMaintenancePolicy>;
  reportBackgroundError: (error: unknown) => void;
  resolveUrgency: () => Promise<"available" | "required">;
  runUpgrade: (
    context: OpenMeldToolsUpdateContext
  ) => Promise<OpenMeldToolsUpgradeProcessResult>;
};

export type OpenMeldToolsUpdateRequestResult =
  | { status: "disabled" }
  | { status: "unavailable" }
  | { status: "current"; currentVersion: string }
  | {
      status: "started" | "already_running";
      operation: OpenMeldToolsUpdateOperation;
    };

export type OpenMeldToolsUpdateCoordinator = {
  requestUpdate: (input: {
    requestSource: OpenMeldToolsUpdateRequestSource;
  }) => Promise<OpenMeldToolsUpdateRequestResult>;
  resumePendingUpdate: () => Promise<boolean>;
  waitForIdle: () => Promise<void>;
};

export function createOpenMeldToolsUpdateCoordinator(
  overrides: Partial<OpenMeldToolsUpdateCoordinatorDependencies> = {},
  options: { executeUpdates?: boolean } = {}
): OpenMeldToolsUpdateCoordinator {
  const deps = resolveDependencies(overrides);
  let inFlight: Promise<void> | null = null;
  let coordination: Promise<void> = Promise.resolve();

  const runSerialized = <T>(run: () => Promise<T>): Promise<T> => {
    const result = coordination.then(run, run);
    coordination = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const startAttempt = (attempt: OpenMeldToolsUpdateAttempt): void => {
    if (options.executeUpdates === false) {
      deps.wakeWorker().catch(deps.reportBackgroundError);
      return;
    }
    if (inFlight) {
      return;
    }
    const running = runAttempt(attempt, deps);
    const tracked = running.finally(() => {
      if (inFlight === tracked) {
        inFlight = null;
      }
    });
    inFlight = tracked;
    inFlight.catch(deps.reportBackgroundError);
  };

  const resumePendingUpdate = async (): Promise<boolean> => {
    const serviceJob = await deps.readPendingServiceJob();
    const pendingAttempt = await deps.readPendingAttempt();
    if (serviceJob) {
      if (pendingAttempt) {
        await deps.discardPendingAttempt();
      }
      return true;
    }
    if (!pendingAttempt) {
      return false;
    }
    startAttempt(pendingAttempt);
    return true;
  };

  const requestUpdate = async ({
    requestSource,
  }: {
    requestSource: OpenMeldToolsUpdateRequestSource;
  }): Promise<OpenMeldToolsUpdateRequestResult> => {
    if (requestSource === "automatic") {
      const policy = await deps.readPolicy();
      if (!policy.automaticUpdatesEnabled) {
        return { status: "disabled" };
      }
    }

    const serviceJob = await deps.readPendingServiceJob();
    if (serviceJob) {
      return {
        status: "already_running",
        operation: projectServiceJob(serviceJob),
      };
    }
    const existingAttempt = await deps.readPendingAttempt();
    if (existingAttempt) {
      startAttempt(existingAttempt);
      return {
        status: "already_running",
        operation: existingAttempt.operation,
      };
    }

    const assessment = await deps.assessUpdate({ forceRefresh: true });
    if (!(assessment.checked && assessment.latestVersion)) {
      return { status: "unavailable" };
    }
    if (!assessment.updateAvailable) {
      return {
        currentVersion: assessment.currentVersion,
        status: "current",
      };
    }

    const now = deps.now();
    const attempt: OpenMeldToolsUpdateAttempt = {
      v: 1,
      attempts: 0,
      errorMessage: null,
      operation: {
        operationId: deps.createOperationId(),
        phase: "updating",
        requestSource,
        requestedAt: now,
        targetVersion: assessment.latestVersion,
        updatedAt: now,
        urgency: assessment.floorBreached
          ? "required"
          : await deps.resolveUrgency(),
      },
    };
    await deps.persistAttempt(attempt);
    startAttempt(attempt);
    return { status: "started", operation: attempt.operation };
  };

  return {
    requestUpdate: async (input) =>
      await runSerialized(
        async () => await deps.withCoordinationLock(() => requestUpdate(input))
      ),
    resumePendingUpdate: async () =>
      await runSerialized(() => deps.withCoordinationLock(resumePendingUpdate)),
    waitForIdle: async () => {
      await coordination;
      while (inFlight) {
        await inFlight;
      }
    },
  };
}

async function runAttempt(
  attempt: OpenMeldToolsUpdateAttempt,
  deps: OpenMeldToolsUpdateCoordinatorDependencies
): Promise<void> {
  const running: OpenMeldToolsUpdateAttempt = {
    ...attempt,
    attempts: attempt.attempts + 1,
    errorMessage: null,
    operation: {
      ...attempt.operation,
      phase: "updating",
      updatedAt: deps.now(),
    },
  };
  await deps.persistAttempt(running);
  try {
    const result = await deps.runUpgrade({
      operationId: running.operation.operationId,
      requestedAt: running.operation.requestedAt,
      requestSource: running.operation.requestSource,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `OpenMeld update process exited with status ${String(result.exitCode)}.`
      );
    }
    const serviceJob = await deps.readPendingServiceJob();
    if (serviceJob) {
      await deps.discardPendingAttempt();
      return;
    }
    await deps.completeAttempt({
      ...running,
      errorMessage: null,
      operation: {
        ...running.operation,
        phase: "updated",
        updatedAt: deps.now(),
      },
    });
  } catch (error) {
    await deps.completeAttempt({
      ...running,
      errorMessage: toErrorMessage(error),
      operation: {
        ...running.operation,
        phase: "needs_help",
        updatedAt: deps.now(),
      },
    });
  }
}

function resolveDependencies(
  overrides: Partial<OpenMeldToolsUpdateCoordinatorDependencies>
): OpenMeldToolsUpdateCoordinatorDependencies {
  return {
    withCoordinationLock:
      overrides.withCoordinationLock ?? withDaemonServiceReconcileLock,
    wakeWorker:
      overrides.wakeWorker ?? (() => startDaemonServiceUpdateWorker()),
    assessUpdate:
      overrides.assessUpdate ??
      (async () =>
        await assessCliUpdate({
          environmentTarget: await resolveOpenMeldEnvironmentTarget(),
          forceRefresh: true,
        })),
    completeAttempt:
      overrides.completeAttempt ?? completeOpenMeldToolsUpdateAttempt,
    createOperationId: overrides.createOperationId ?? randomUUID,
    discardPendingAttempt:
      overrides.discardPendingAttempt ??
      discardPendingOpenMeldToolsUpdateAttempt,
    now: overrides.now ?? (() => new Date().toISOString()),
    persistAttempt:
      overrides.persistAttempt ?? persistOpenMeldToolsUpdateAttempt,
    readPendingAttempt:
      overrides.readPendingAttempt ?? readPendingOpenMeldToolsUpdateAttempt,
    readPendingServiceJob:
      overrides.readPendingServiceJob ?? readPendingDaemonServiceUpdate,
    readPolicy: overrides.readPolicy ?? readOpenMeldToolsMaintenancePolicy,
    reportBackgroundError:
      overrides.reportBackgroundError ??
      ((error) => {
        console.error("[openmeld.tools.update_failed]", error);
      }),
    resolveUrgency: overrides.resolveUrgency ?? resolveServiceUpdateUrgency,
    runUpgrade: overrides.runUpgrade ?? runOpenMeldToolsUpgradeProcess,
  };
}

function projectServiceJob(
  job: DaemonServiceUpdateJob
): OpenMeldToolsUpdateOperation {
  return {
    operationId: job.jobId,
    phase: job.phase,
    requestSource: job.requestSource,
    requestedAt: job.requestedAt,
    targetVersion: job.targetVersion,
    updatedAt: job.updatedAt,
    urgency: job.urgency,
  };
}
