import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { daemonServiceUpdateJobSchema } from "@openmeld/schemas";
import { describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
  discardPreparedDaemonServiceBundle: vi.fn(),
  prepareDaemonServiceBundle: vi.fn(),
}));
vi.mock(
  "../src/local-service/lifecycle/daemon-service-lifecycle",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/lifecycle/daemon-service-lifecycle")
    >()),
    runDaemonServiceLifecycle: vi.fn(),
  })
);

import { LocalDaemonControlPlaneClientError } from "../src/local-service/control-plane/client";
import { DaemonServiceUpdateDeferredError } from "../src/local-service/lifecycle/daemon-service-lifecycle";
import {
  runPendingDaemonServiceUpdate,
  scheduleDaemonServiceUpdate,
  waitUntilDaemonServiceSafeSwitch,
} from "../src/local-service/lifecycle/daemon-service-update-coordinator";
import {
  completePendingDaemonServiceUpdate,
  type DaemonServiceUpdateJob,
  daemonServiceLastUpdatePath,
  daemonServicePendingUpdatePath,
  persistPendingDaemonServiceUpdate,
  readPendingDaemonServiceUpdate,
  resolveDaemonServiceUpdateOperation,
} from "../src/local-service/lifecycle/daemon-service-update-state";

const PREPARED_BUNDLE = {
  v: 2 as const,
  schema: "openmeld-daemon-active-bundle-v2" as const,
  bundleId: "0.3.98-abc123",
  daemonVersion: "0.3.98",
  entryScriptRelativePath: "openmeld",
  bundleFormat: "binary_v1" as const,
  sourceEntryScriptPath: "/tmp/openmeld/versions/0.3.98/openmeld",
  sourcePackageRootPath: "/tmp/openmeld/versions/0.3.98",
  sourceDistRootPath: "/tmp/openmeld/versions/0.3.98",
  sourceDistFingerprint: "abc123",
  sourceKind: "package_install" as const,
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
};

describe("daemon service background update coordinator", () => {
  it("does not reinstall a completed update retained for setup continuation", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 1,
      desiredState: "background",
      errorMessage: null,
      jobId: "completed-update",
      phase: "updated",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-09-12T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: PREPARED_BUNDLE.daemonVersion,
      updatedAt: "2026-09-12T00:00:10.000Z",
      urgency: "available",
    };
    const runLifecycle = vi.fn();
    const persistPendingJob = vi.fn();
    await expect(
      runPendingDaemonServiceUpdate({
        readPendingJob: async () => pending,
        runLifecycle,
        persistPendingJob,
      })
    ).resolves.toEqual(pending);
    expect(runLifecycle).not.toHaveBeenCalled();
    expect(persistPendingJob).not.toHaveBeenCalled();
  });
  it.each([
    "daemon.control.contract_mismatch",
    "daemon.control.endpoint_missing",
    "host.previous_work_unconfirmed",
  ])("keeps accepted work safe when readiness fails with %s", async (code) => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-from-0.3.153",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-09-05T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: PREPARED_BUNDLE.daemonVersion,
      updatedAt: "2026-09-05T00:00:00.000Z",
      urgency: "available",
    };
    let durableJob = pending;
    const runLifecycle = vi.fn(async () => ({
      errorMessage: null,
      status: "aligned" as const,
    }));
    const requestReadiness = vi.fn(() =>
      Promise.reject(
        new LocalDaemonControlPlaneClientError(
          code,
          "Service cannot answer readiness"
        )
      )
    );

    const update = runPendingDaemonServiceUpdate({
      completePendingJob: (job) => {
        durableJob = job;
        return Promise.resolve();
      },
      now: () => "2026-09-05T00:00:02.000Z",
      persistPendingJob: (job) => {
        durableJob = job;
        return Promise.resolve();
      },
      readPendingJob: async () => durableJob,
      runLifecycle,
      waitUntilSafeToSwitch: async (job) =>
        await waitUntilDaemonServiceSafeSwitch(job, {
          readPendingJob: async () => durableJob,
          requestReadiness,
          sleep: vi.fn(),
        }),
      withReconcileLock: async (run) => await run(),
    });

    if (code === "host.previous_work_unconfirmed") {
      await expect(update).rejects.toThrow("Service cannot answer readiness");
      expect(durableJob).toMatchObject({
        phase: "needs_help",
        jobId: pending.jobId,
      });
      expect(durableJob.errorMessage).toContain(code);
      expect(runLifecycle).not.toHaveBeenCalled();
      return;
    }
    const result = await update;

    expect(requestReadiness).toHaveBeenCalledOnce();
    expect(runLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: PREPARED_BUNDLE.daemonVersion,
        forceKillAfterDrainTimeout: false,
      })
    );
    expect(result).toMatchObject({
      phase: "updated",
      targetVersion: PREPARED_BUNDLE.daemonVersion,
    });
  });

  it("yields a raced automatic update without consuming attempts or holding the lifecycle lock", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const initial: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 4,
      desiredState: "background",
      errorMessage: null,
      jobId: "idle-switch",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-09-05T00:00:00.000Z",
      requestSource: "automatic",
      targetVersion: PREPARED_BUNDLE.daemonVersion,
      updatedAt: "2026-09-05T00:00:00.000Z",
      urgency: "available",
    };
    let job = initial;
    let locked = false;
    const waiting = Promise.withResolvers<void>();
    const idle = Promise.withResolvers<void>();
    const phases: string[] = [];
    let calls = 0;
    const result = runPendingDaemonServiceUpdate({
      readPendingJob: async () => job,
      now: () => initial.updatedAt,
      persistPendingJob: (next) => {
        job = next;
        phases.push(next.phase);
        return Promise.resolve();
      },
      completePendingJob: (next) => {
        job = next;
        return Promise.resolve();
      },
      withReconcileLock: async (run) => {
        expect(locked).toBe(false);
        locked = true;
        try {
          return await run();
        } finally {
          locked = false;
        }
      },
      waitUntilSafeToSwitch: async () => {
        expect(locked).toBe(false);
        if (calls === 1) {
          waiting.resolve();
          await idle.promise;
        }
      },
      runLifecycle: async (input) => {
        expect(input.onlyIfIdle).toBe(true);
        calls += 1;
        if (calls === 1) {
          throw new DaemonServiceUpdateDeferredError();
        }
        await input.onPhase?.("wait_stopped");
        return { status: "aligned", errorMessage: null };
      },
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toBe(1);
    expect(locked).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting.promise;
    expect(locked).toBe(false);
    expect(job).toMatchObject({
      phase: "waiting_for_work",
      attempts: 4,
      errorMessage: null,
      jobId: initial.jobId,
    });
    expect(phases).not.toContain("updating");
    idle.resolve();
    expect(await result).toMatchObject({
      phase: "updated",
      attempts: 5,
      jobId: initial.jobId,
    });
    expect(phases).toContain("updating");
  });

  it("keeps waiting when the readiness fact is unavailable", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-after-readiness-error",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-09-05T00:00:00.000Z",
      requestSource: "automatic",
      targetVersion: PREPARED_BUNDLE.daemonVersion,
      updatedAt: "2026-09-05T00:00:00.000Z",
      urgency: "available",
    };
    const readPendingJob = vi
      .fn<() => Promise<DaemonServiceUpdateJob | null>>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);
    const sleep = vi.fn(() => Promise.resolve());

    await waitUntilDaemonServiceSafeSwitch(pending, {
      readPendingJob,
      requestReadiness: () =>
        Promise.reject(
          new LocalDaemonControlPlaneClientError(
            "daemon.control.invalid_response",
            "unexpected readiness response"
          )
        ),
      sleep,
    });

    expect(readPendingJob).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("survives the initiating process and closes the persisted job after completion", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "openmeld-update-state-"));
    const pathInput = {
      env: {
        OPENMELD_ENV_PRESET: "dev-local",
      },
      homeDir,
    };
    const job: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      jobId: "update-persisted",
      requestedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      targetVersion: "0.3.98",
      urgency: "available",
      phase: "waiting_for_work",
      requestSource: "cli",
      desiredState: "background",
      preparedBundle: PREPARED_BUNDLE,
      attempts: 0,
      errorMessage: null,
    };

    try {
      await persistPendingDaemonServiceUpdate(job, pathInput);
      await expect(readPendingDaemonServiceUpdate(pathInput)).resolves.toEqual(
        job
      );

      const completed = {
        ...job,
        phase: "updated" as const,
        updatedAt: "2026-08-25T00:02:00.000Z",
      };
      await completePendingDaemonServiceUpdate(completed, pathInput);

      await expect(
        readPendingDaemonServiceUpdate(pathInput)
      ).resolves.toBeNull();
      await expect(
        readFile(daemonServiceLastUpdatePath(pathInput), "utf8").then(
          JSON.parse
        )
      ).resolves.toEqual(completed);
      await expect(
        resolveDaemonServiceUpdateOperation(
          pathInput,
          Date.parse("2026-08-25T00:02:01.000Z")
        )
      ).resolves.toMatchObject({
        operationId: "update-persisted",
        phase: "updated",
      });
      await expect(
        resolveDaemonServiceUpdateOperation(
          pathInput,
          Date.parse("2026-08-26T00:02:01.000Z")
        )
      ).resolves.toBeNull();
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }
  });

  it("keeps the persisted job readable by an older strict worker while retaining split targets", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "openmeld-update-targets-"));
    const pathInput = {
      env: { OPENMELD_ENV_PRESET: "dev-local" },
      homeDir,
    };
    const job: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "legacy-worker-handoff",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-09-17T00:00:00.000Z",
      requestSource: "automatic",
      targetCliVersion: "0.3.214-staging.cli",
      targetServiceVersion: "0.3.213-staging.service",
      targetVersion: "0.3.213-staging.service",
      updatedAt: "2026-09-17T00:00:01.000Z",
      urgency: "available",
    };

    try {
      await persistPendingDaemonServiceUpdate(job, pathInput);
      const persisted = JSON.parse(
        await readFile(daemonServicePendingUpdatePath(pathInput), "utf8")
      ) as Record<string, unknown>;
      expect(persisted).not.toHaveProperty("targetCliVersion");
      expect(persisted).not.toHaveProperty("targetServiceVersion");
      expect(
        daemonServiceUpdateJobSchema
          .omit({ targetCliVersion: true, targetServiceVersion: true })
          .safeParse(persisted).success
      ).toBe(true);
      await expect(readPendingDaemonServiceUpdate(pathInput)).resolves.toEqual(
        job
      );
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }
  });

  it("durably schedules a prepared update and returns without running the lifecycle", async () => {
    const calls: string[] = [];
    const result = await scheduleDaemonServiceUpdate(
      {
        targetVersion: "0.3.98",
        urgency: "available",
      },
      {
        createJobId: () => "update-1",
        prepareWorkerCarrier: () => {
          calls.push("prepare_worker_carrier");
          return Promise.resolve();
        },
        now: () => "2026-08-25T00:00:00.000Z",
        prepareBundle: () => {
          calls.push("prepare");
          return Promise.resolve(PREPARED_BUNDLE);
        },
        readPendingJob: () => Promise.resolve(null),
        resolveDesiredState: () => Promise.resolve("background"),
        persistPendingJob: () => {
          calls.push("persist");
          return Promise.resolve();
        },
        installWorker: () => {
          calls.push("install_worker");
          return Promise.resolve();
        },
        pruneWorkerVersions: () => {
          calls.push("prune_worker_versions");
          return Promise.resolve();
        },
        startWorker: () => {
          calls.push("start_worker");
          return Promise.resolve();
        },
        withManagedInstallTransaction: async (run) => {
          calls.push("managed_install_transaction_start");
          const result = await run();
          calls.push("managed_install_transaction_end");
          return result;
        },
      }
    );

    expect(result).toMatchObject({
      status: "scheduled",
      job: {
        jobId: "update-1",
        phase: "waiting_for_work",
        requestSource: "cli",
        targetVersion: "0.3.98",
        urgency: "available",
      },
    });
    expect(calls).toEqual([
      "prepare",
      "managed_install_transaction_start",
      "prepare_worker_carrier",
      "install_worker",
      "persist",
      "managed_install_transaction_end",
      "start_worker",
      "prune_worker_versions",
    ]);
  });

  it("keeps a durable update scheduled when post-handoff pruning fails", async () => {
    const calls: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await scheduleDaemonServiceUpdate(
      {
        targetVersion: "0.3.98",
        urgency: "required",
      },
      {
        createJobId: () => "update-prune-warning",
        installWorker: () => {
          calls.push("install_worker");
          return Promise.resolve();
        },
        now: () => "2026-08-25T00:00:00.000Z",
        persistPendingJob: () => {
          calls.push("persist");
          return Promise.resolve();
        },
        prepareBundle: async () => PREPARED_BUNDLE,
        pruneWorkerVersions: () => {
          calls.push("prune_worker_versions");
          return Promise.reject(new Error("managed version cleanup failed"));
        },
        readPendingJob: async () => null,
        resolveDesiredState: async () => "background",
        startWorker: () => {
          calls.push("start_worker");
          return Promise.resolve();
        },
      }
    );

    expect(result).toMatchObject({
      job: { jobId: "update-prune-warning" },
      status: "scheduled",
    });
    expect(calls).toEqual([
      "install_worker",
      "persist",
      "start_worker",
      "prune_worker_versions",
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[openmeld.daemon_service.update_worker_prune_failed]",
      expect.objectContaining({
        errorMessage: "managed version cleanup failed",
        operationId: "update-prune-warning",
        targetVersion: "0.3.98",
      })
    );
    warn.mockRestore();
  });

  it("keeps the same operation identity when the CLI hands off to the Service", async () => {
    const result = await scheduleDaemonServiceUpdate(
      {
        operationId: "tools-update-1",
        requestedAt: "2026-08-25T00:00:00.000Z",
        requestSource: "automatic",
        targetVersion: "0.3.98",
        urgency: "available",
      },
      {
        now: () => "2026-08-25T00:02:00.000Z",
        prepareBundle: async () => PREPARED_BUNDLE,
        readPendingJob: async () => null,
        resolveDesiredState: async () => "background",
        persistPendingJob: async () => undefined,
        installWorker: async () => undefined,
        pruneWorkerVersions: async () => undefined,
        startWorker: async () => undefined,
      }
    );

    expect(result.job).toMatchObject({
      jobId: "tools-update-1",
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "automatic",
      updatedAt: "2026-08-25T00:02:00.000Z",
    });
  });

  it("keeps the pending job until the replacement is healthy, then completes it", async () => {
    const job: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      jobId: "update-1",
      requestedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      targetVersion: "0.3.98",
      urgency: "available",
      phase: "waiting_for_work",
      requestSource: "cli",
      desiredState: "background",
      preparedBundle: PREPARED_BUNDLE,
      attempts: 0,
      errorMessage: null,
    };
    const persisted: DaemonServiceUpdateJob[] = [];
    const completed: DaemonServiceUpdateJob[] = [];

    const result = await runPendingDaemonServiceUpdate({
      now: () => "2026-08-25T00:01:00.000Z",
      readPendingJob: async () => job,
      persistPendingJob: (next) => {
        persisted.push(next);
        return Promise.resolve();
      },
      completePendingJob: (next) => {
        completed.push(next);
        return Promise.resolve();
      },
      waitUntilSafeToSwitch: async () => undefined,
      runLifecycle: (input) => {
        expect(input.onlyIfIdle).toBeUndefined();
        return Promise.resolve({
          status: "aligned",
          targetVersion: "0.3.98",
          inventoryBefore: null,
          inventoryAfter: null,
          reasonCodes: [],
          completedPhases: ["inspect", "prepare_bundle"],
          desiredState: "background",
          shouldStartAfterLifecycle: true,
          backupDataPath: null,
          errorMessage: null,
        });
      },
    });

    expect(persisted).toHaveLength(2);
    expect(persisted[0]).toMatchObject({
      phase: "waiting_for_work",
      attempts: 0,
    });
    expect(persisted[1]).toMatchObject({ phase: "updating", attempts: 1 });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ phase: "updated" });
    expect(result).toMatchObject({ phase: "updated" });
  });

  it("records a failed update only after the lifecycle restores a safe state", async () => {
    const job: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      jobId: "update-1",
      requestedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      targetVersion: "0.3.98",
      urgency: "required",
      phase: "waiting_for_work",
      requestSource: "automatic",
      desiredState: "background",
      preparedBundle: PREPARED_BUNDLE,
      attempts: 0,
      errorMessage: null,
    };
    const completed: DaemonServiceUpdateJob[] = [];

    const waitUntilSafeToSwitch = vi.fn();
    const result = await runPendingDaemonServiceUpdate({
      now: () => "2026-08-25T00:01:00.000Z",
      readPendingJob: async () => job,
      persistPendingJob: async () => undefined,
      completePendingJob: (next) => {
        completed.push(next);
        return Promise.resolve();
      },
      waitUntilSafeToSwitch,
      runLifecycle: (input) => {
        expect(input.onlyIfIdle).toBeUndefined();
        return Promise.resolve({
          status: "failed",
          targetVersion: "0.3.98",
          inventoryBefore: null,
          inventoryAfter: null,
          reasonCodes: ["replacement_start_failed"],
          completedPhases: ["inspect", "stop_or_drain"],
          desiredState: "background",
          shouldStartAfterLifecycle: true,
          backupDataPath: null,
          failureStage: "verify_final_inventory",
          evidencePath: "/tmp/evidence.jsonl",
          recoveryStatus: "restored_verified_previous_state",
          errorCode: "replacement_start_failed",
          errorMessage: "replacement failed to start",
        });
      },
    });

    expect(completed[0]).toMatchObject({
      phase: "restored",
      errorMessage: "replacement failed to start",
    });
    expect(result).toMatchObject({ phase: "restored" });
    expect(waitUntilSafeToSwitch).not.toHaveBeenCalled();
  });

  it("keeps a transient failure pending so the OS worker can retry it", async () => {
    const job: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      jobId: "update-1",
      requestedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      targetVersion: "0.3.98",
      urgency: "available",
      phase: "waiting_for_work",
      requestSource: "cli",
      desiredState: "background",
      preparedBundle: PREPARED_BUNDLE,
      attempts: 0,
      errorMessage: null,
    };
    const persisted: DaemonServiceUpdateJob[] = [];
    const completed: DaemonServiceUpdateJob[] = [];

    await expect(
      runPendingDaemonServiceUpdate({
        now: () => "2026-08-25T00:01:00.000Z",
        readPendingJob: () => Promise.resolve(job),
        persistPendingJob: (next) => {
          persisted.push(next);
          return Promise.resolve();
        },
        completePendingJob: (next) => {
          completed.push(next);
          return Promise.resolve();
        },
        waitUntilSafeToSwitch: () =>
          Promise.reject(new Error("temporary control-plane error")),
        runLifecycle: vi.fn(),
      })
    ).rejects.toThrow("temporary control-plane error");

    expect(persisted.at(-1)).toMatchObject({
      attempts: 0,
      errorMessage: "temporary control-plane error",
      phase: "waiting_for_work",
    });
    expect(completed).toHaveLength(0);
  });

  it("replaces a pending older bundle with the newest requested version", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-1",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "available",
    };
    const nextBundle = {
      ...PREPARED_BUNDLE,
      bundleId: "0.3.99-def456",
      daemonVersion: "0.3.99",
    };
    const persisted: DaemonServiceUpdateJob[] = [];
    let durableJob = pending;
    const installWorker = vi.fn();
    const prepareWorkerCarrier = vi.fn();
    const pruneWorkerVersions = vi.fn((job: DaemonServiceUpdateJob) => {
      expect(durableJob).toEqual(job);
      return Promise.resolve();
    });

    const result = await scheduleDaemonServiceUpdate(
      {
        requestSource: "web",
        targetCliVersion: "0.3.105",
        targetServiceVersion: "0.3.99",
        targetVersion: "0.3.99",
        urgency: "required",
      },
      {
        installWorker,
        now: () => "2026-08-25T00:02:00.000Z",
        persistPendingJob: (job) => {
          durableJob = job;
          persisted.push(job);
          return Promise.resolve();
        },
        prepareBundle: async () => nextBundle,
        prepareWorkerCarrier,
        pruneWorkerVersions,
        readPendingJob: async () => pending,
        startWorker: async () => undefined,
      }
    );

    expect(result.status).toBe("already_scheduled");
    expect(result.job).toMatchObject({
      jobId: "update-1",
      phase: "waiting_for_work",
      preparedBundle: { bundleId: "0.3.99-def456" },
      requestSource: "web",
      targetVersion: "0.3.99",
      urgency: "required",
    });
    expect(persisted).toEqual([result.job]);
    expect(installWorker).not.toHaveBeenCalled();
    expect(prepareWorkerCarrier).toHaveBeenCalledWith(result.job);
    expect(pruneWorkerVersions).toHaveBeenCalledWith(result.job);
  });

  it("keeps the old durable update recoverable when replacement persistence fails", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-1",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "required",
    };
    const nextBundle = {
      ...PREPARED_BUNDLE,
      bundleId: "0.3.99-def456",
      daemonVersion: "0.3.99",
    };
    const recoverableBundleIds = new Set([
      pending.preparedBundle.bundleId,
      nextBundle.bundleId,
    ]);
    const installWorker = vi.fn(async () => undefined);
    const pruneWorkerVersions = vi.fn(() => {
      recoverableBundleIds.delete(pending.preparedBundle.bundleId);
      return Promise.resolve();
    });
    const startWorker = vi.fn();

    await expect(
      scheduleDaemonServiceUpdate(
        {
          requestSource: "web",
          targetVersion: "0.3.99",
          urgency: "required",
        },
        {
          installWorker,
          now: () => "2026-08-25T00:02:00.000Z",
          persistPendingJob: () =>
            Promise.reject(new Error("replacement job write failed")),
          prepareBundle: async () => nextBundle,
          pruneWorkerVersions,
          readPendingJob: async () => pending,
          startWorker,
        }
      )
    ).rejects.toThrow("replacement job write failed");

    expect(installWorker).not.toHaveBeenCalled();
    expect(pruneWorkerVersions).not.toHaveBeenCalled();
    expect(startWorker).not.toHaveBeenCalled();
    expect(recoverableBundleIds).toContain(pending.preparedBundle.bundleId);

    const recovered = await runPendingDaemonServiceUpdate({
      completePendingJob: async () => undefined,
      now: () => "2026-08-25T00:03:00.000Z",
      persistPendingJob: async () => undefined,
      readPendingJob: async () => pending,
      runLifecycle: async ({ preparedBundle }) =>
        recoverableBundleIds.has(preparedBundle.bundleId)
          ? { errorMessage: null, status: "aligned" }
          : {
              errorMessage: "The prepared Service bundle is missing.",
              recoveryStatus: "failed_before_safe_state",
              status: "failed",
            },
      waitUntilSafeToSwitch: async () => undefined,
    });

    expect(recovered).toMatchObject({
      phase: "updated",
      targetVersion: "0.3.98",
    });
  });

  it("does not let a waiting worker restore a target replaced concurrently", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-1",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "available",
    };
    const nextBundle = {
      ...PREPARED_BUNDLE,
      bundleId: "0.3.99-def456",
      daemonVersion: "0.3.99",
    };
    const workerPersistStarted = Promise.withResolvers<void>();
    const releaseWorkerPersist = Promise.withResolvers<void>();
    const safeSwitchWaitStarted = Promise.withResolvers<void>();
    const releaseSafeSwitchWait = Promise.withResolvers<void>();
    const replacementInstallStarted = Promise.withResolvers<void>();
    const lockContended = Promise.withResolvers<void>();
    let durableJob = pending;
    let blockedWorkerPersist = false;
    let lockTail = Promise.resolve();
    let lockHeld = false;
    const withReconcileLock = async <T>(run: () => Promise<T>): Promise<T> => {
      const previous = lockTail;
      let releaseLock: () => void = () => undefined;
      lockTail = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      if (lockHeld) {
        lockContended.resolve();
      }
      await previous;
      lockHeld = true;
      try {
        return await run();
      } finally {
        lockHeld = false;
        releaseLock();
      }
    };
    const persistPendingJob = async (
      job: DaemonServiceUpdateJob
    ): Promise<void> => {
      if (
        !blockedWorkerPersist &&
        job.targetVersion === pending.targetVersion &&
        job.phase === "waiting_for_work"
      ) {
        blockedWorkerPersist = true;
        workerPersistStarted.resolve();
        await releaseWorkerPersist.promise;
      }
      durableJob = job;
    };
    const lifecycleTargets: string[] = [];

    const workerRun = runPendingDaemonServiceUpdate({
      completePendingJob: async () => undefined,
      now: () => "2026-08-25T00:03:00.000Z",
      persistPendingJob,
      readPendingJob: async () => durableJob,
      runLifecycle: ({ expectedVersion }) => {
        lifecycleTargets.push(expectedVersion);
        return Promise.resolve({ errorMessage: null, status: "aligned" });
      },
      waitUntilSafeToSwitch: async () => {
        safeSwitchWaitStarted.resolve();
        await releaseSafeSwitchWait.promise;
      },
      withReconcileLock,
    });
    await workerPersistStarted.promise;

    const replacement = scheduleDaemonServiceUpdate(
      {
        requestSource: "web",
        targetVersion: "0.3.99",
        urgency: "required",
      },
      {
        installWorker: () => {
          replacementInstallStarted.resolve();
          return Promise.resolve();
        },
        now: () => "2026-08-25T00:02:00.000Z",
        persistPendingJob,
        prepareBundle: async () => nextBundle,
        pruneWorkerVersions: async () => undefined,
        readPendingJob: async () => durableJob,
        startWorker: async () => undefined,
        withReconcileLock,
      }
    );
    const firstBoundary = await Promise.race([
      replacementInstallStarted.promise.then(() => "replacement_started"),
      lockContended.promise.then(() => "lock_contended"),
    ]);
    if (firstBoundary === "replacement_started") {
      await replacement;
    }

    releaseWorkerPersist.resolve();
    await safeSwitchWaitStarted.promise;
    await replacement;
    releaseSafeSwitchWait.resolve();

    const result = await workerRun;

    expect(lifecycleTargets).toEqual(["0.3.99"]);
    expect(result).toMatchObject({
      phase: "updated",
      targetVersion: "0.3.99",
      urgency: "required",
    });
  });

  it("keeps a replacement when the superseded worker fails while waiting", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-1",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "available",
    };
    const nextBundle = {
      ...PREPARED_BUNDLE,
      bundleId: "0.3.99-def456",
      daemonVersion: "0.3.99",
    };
    let durableJob = pending;
    const withReconcileLock = createSerialReconcileLock();
    const persistPendingJob = (job: DaemonServiceUpdateJob): Promise<void> => {
      durableJob = job;
      return Promise.resolve();
    };

    await expect(
      runPendingDaemonServiceUpdate({
        completePendingJob: async () => undefined,
        now: () => "2026-08-25T00:03:00.000Z",
        persistPendingJob,
        readPendingJob: async () => durableJob,
        runLifecycle: vi.fn(),
        waitUntilSafeToSwitch: async () => {
          await scheduleDaemonServiceUpdate(
            {
              requestSource: "web",
              targetVersion: "0.3.99",
              urgency: "required",
            },
            {
              installWorker: async () => undefined,
              now: () => "2026-08-25T00:02:00.000Z",
              persistPendingJob,
              prepareBundle: async () => nextBundle,
              pruneWorkerVersions: async () => undefined,
              readPendingJob: async () => durableJob,
              startWorker: async () => undefined,
              withReconcileLock,
            }
          );
          throw new Error("safe-switch check failed");
        },
        withReconcileLock,
      })
    ).rejects.toThrow("safe-switch check failed");

    expect(durableJob).toMatchObject({
      errorMessage: null,
      preparedBundle: { bundleId: "0.3.99-def456" },
      targetVersion: "0.3.99",
      urgency: "required",
    });
  });

  it("preserves both the safe-switch failure and a failure to record it", async () => {
    const job: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-double-failure",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "available",
    };
    let persistCount = 0;

    const failure = await runPendingDaemonServiceUpdate({
      completePendingJob: async () => undefined,
      now: () => "2026-08-25T00:01:00.000Z",
      persistPendingJob: () => {
        persistCount += 1;
        if (persistCount === 2) {
          return Promise.reject(new Error("failed to record wait error"));
        }
        return Promise.resolve();
      },
      readPendingJob: async () => job,
      runLifecycle: vi.fn(),
      waitUntilSafeToSwitch: () =>
        Promise.reject(new Error("safe switch unavailable")),
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "safe switch unavailable" }),
      expect.objectContaining({ message: "failed to record wait error" }),
    ]);
  });

  it("runs one lifecycle when multiple workers resume the same durable job", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-1",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "required",
    };
    let durableJob: DaemonServiceUpdateJob | null = pending;
    const withReconcileLock = createSerialReconcileLock();
    const runLifecycle = vi.fn(() =>
      Promise.resolve({
        errorMessage: null,
        status: "aligned" as const,
      })
    );
    const dependencies = {
      completePendingJob: (): Promise<void> => {
        durableJob = null;
        return Promise.resolve();
      },
      now: () => "2026-08-25T00:03:00.000Z",
      persistPendingJob: (job: DaemonServiceUpdateJob): Promise<void> => {
        durableJob = job;
        return Promise.resolve();
      },
      readPendingJob: async () => durableJob,
      runLifecycle,
      waitUntilSafeToSwitch: vi.fn(),
      withReconcileLock,
    };

    const results = await Promise.all([
      runPendingDaemonServiceUpdate(dependencies),
      runPendingDaemonServiceUpdate(dependencies),
    ]);

    expect(runLifecycle).toHaveBeenCalledOnce();
    expect(results).toContain(null);
    expect(results).toContainEqual(
      expect.objectContaining({ phase: "updated" })
    );
    expect(durableJob).toBeNull();
  });

  it("keeps a newer pending target when an older request arrives later", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-1",
      phase: "waiting_for_work",
      preparedBundle: {
        ...PREPARED_BUNDLE,
        bundleId: "0.3.99-def456",
        daemonVersion: "0.3.99",
      },
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "automatic",
      targetVersion: "0.3.99",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "available",
    };
    const prepareBundle = vi.fn();
    const persistPendingJob = vi.fn();
    const installWorker = vi.fn();

    const result = await scheduleDaemonServiceUpdate(
      {
        requestSource: "web",
        targetVersion: "0.3.98",
        urgency: "available",
      },
      {
        installWorker,
        persistPendingJob,
        prepareBundle,
        readPendingJob: async () => pending,
        startWorker: async () => undefined,
      }
    );

    expect(result).toEqual({ job: pending, status: "already_scheduled" });
    expect(prepareBundle).not.toHaveBeenCalled();
    expect(persistPendingJob).not.toHaveBeenCalled();
    expect(installWorker).not.toHaveBeenCalled();
  });

  it("keeps a superseded bundle while the existing OS worker may still reference it", async () => {
    const pending: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "update-1",
      phase: "waiting_for_work",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "available",
    };
    const nextBundle = {
      ...PREPARED_BUNDLE,
      bundleId: "0.3.99-def456",
      daemonVersion: "0.3.99",
    };
    const result = await scheduleDaemonServiceUpdate(
      {
        requestSource: "web",
        targetCliVersion: "0.3.105",
        targetServiceVersion: "0.3.99",
        targetVersion: "0.3.99",
        urgency: "available",
      },
      {
        installWorker: async () => undefined,
        persistPendingJob: async () => undefined,
        prepareBundle: async () => nextBundle,
        pruneWorkerVersions: async () => undefined,
        readPendingJob: async () => pending,
        startWorker: async () => undefined,
      }
    );

    expect(result.job.targetVersion).toBe("0.3.99");
    expect(result.job).toMatchObject({
      targetCliVersion: "0.3.105",
      targetServiceVersion: "0.3.99",
    });
  });

  it("migrates the previous persisted job and exposes one safe public operation", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "openmeld-update-migrate-"));
    const pathInput = {
      env: { OPENMELD_ENV_PRESET: "dev-local" },
      homeDir,
    };
    const legacyJob = {
      v: 1,
      schema: "openmeld-daemon-service-update-job-v1",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "legacy-update",
      preparedBundle: PREPARED_BUNDLE,
      requestedAt: "2026-08-25T00:00:00.000Z",
      status: "scheduled",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:30.000Z",
      urgency: "available",
    };

    try {
      const pendingPath = join(
        homeDir,
        ".openmeld-dev",
        "runtime",
        "daemon",
        "state",
        "service-update.json"
      );
      await mkdir(dirname(pendingPath), { recursive: true });
      await writeFile(pendingPath, JSON.stringify(legacyJob), "utf8");

      await expect(
        readPendingDaemonServiceUpdate(pathInput)
      ).resolves.toMatchObject({
        v: 2,
        phase: "waiting_for_work",
        requestSource: "cli",
      });
      await expect(
        resolveDaemonServiceUpdateOperation(pathInput)
      ).resolves.toEqual({
        operationId: "legacy-update",
        phase: "waiting_for_work",
        requestSource: "cli",
        requestedAt: "2026-08-25T00:00:00.000Z",
        targetVersion: "0.3.98",
        updatedAt: "2026-08-25T00:00:30.000Z",
        urgency: "available",
      });
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }
  });
});

function createSerialReconcileLock() {
  let lockTail = Promise.resolve();
  return async <T>(run: () => Promise<T>): Promise<T> => {
    const previous = lockTail;
    let releaseLock: () => void = () => undefined;
    lockTail = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      releaseLock();
    }
  };
}
