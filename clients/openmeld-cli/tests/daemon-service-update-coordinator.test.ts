import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DaemonActiveBundleState } from "../src/local-service/lifecycle/daemon-service-bundle";

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
  discardPreparedDaemonServiceBundle: vi.fn(),
  prepareDaemonServiceBundle: vi.fn(),
}));
vi.mock("../src/local-service/lifecycle/daemon-service-lifecycle", () => ({
  runDaemonServiceLifecycle: vi.fn(),
}));

import {
  runPendingDaemonServiceUpdate,
  scheduleDaemonServiceUpdate,
} from "../src/local-service/lifecycle/daemon-service-update-coordinator";
import {
  completePendingDaemonServiceUpdate,
  type DaemonServiceUpdateJob,
  daemonServiceLastUpdatePath,
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

  it("durably schedules a prepared update and returns without running the lifecycle", async () => {
    const calls: string[] = [];
    const result = await scheduleDaemonServiceUpdate(
      {
        targetVersion: "0.3.98",
        urgency: "available",
      },
      {
        createJobId: () => "update-1",
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
        startWorker: () => {
          calls.push("start_worker");
          return Promise.resolve();
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
      "install_worker",
      "persist",
      "start_worker",
    ]);
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
      runLifecycle: async () => ({
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
      }),
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
      requestSource: "cli",
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
      runLifecycle: async () => ({
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
      }),
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
    const discarded: DaemonActiveBundleState[] = [];

    const result = await scheduleDaemonServiceUpdate(
      {
        requestSource: "web",
        targetVersion: "0.3.99",
        urgency: "required",
      },
      {
        discardBundle: (bundle) => {
          discarded.push(bundle);
          return Promise.resolve();
        },
        installWorker: async () => undefined,
        now: () => "2026-08-25T00:02:00.000Z",
        persistPendingJob: (job) => {
          persisted.push(job);
          return Promise.resolve();
        },
        prepareBundle: async () => nextBundle,
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
    expect(discarded).toEqual([PREPARED_BUNDLE]);
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
    const discardBundle = vi.fn();

    const result = await scheduleDaemonServiceUpdate(
      {
        requestSource: "web",
        targetVersion: "0.3.98",
        urgency: "available",
      },
      {
        discardBundle,
        installWorker: async () => undefined,
        persistPendingJob,
        prepareBundle,
        readPendingJob: async () => pending,
        startWorker: async () => undefined,
      }
    );

    expect(result).toEqual({ job: pending, status: "already_scheduled" });
    expect(prepareBundle).not.toHaveBeenCalled();
    expect(persistPendingJob).not.toHaveBeenCalled();
    expect(discardBundle).not.toHaveBeenCalled();
  });

  it("keeps the replacement scheduled when old bundle cleanup fails", async () => {
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await scheduleDaemonServiceUpdate(
      {
        requestSource: "web",
        targetVersion: "0.3.99",
        urgency: "available",
      },
      {
        discardBundle: () => Promise.reject(new Error("cleanup failed")),
        installWorker: async () => undefined,
        persistPendingJob: async () => undefined,
        prepareBundle: async () => nextBundle,
        readPendingJob: async () => pending,
        startWorker: async () => undefined,
      }
    );

    expect(result.job.targetVersion).toBe("0.3.99");
    expect(warn).toHaveBeenCalledWith(
      "[openmeld.daemon_service.update_bundle_cleanup_failed]",
      expect.objectContaining({
        bundleId: PREPARED_BUNDLE.bundleId,
        errorMessage: "cleanup failed",
        operationId: "update-1",
      })
    );
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
