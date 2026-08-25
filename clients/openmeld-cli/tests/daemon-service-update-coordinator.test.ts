import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
  prepareDaemonServiceBundle: vi.fn(),
}));
vi.mock("../src/local-service/lifecycle/daemon-service-lifecycle", () => ({
  runDaemonServiceLifecycle: vi.fn(),
}));

import {
  completePendingDaemonServiceUpdate,
  type DaemonServiceUpdateJob,
  daemonServiceLastUpdatePath,
  persistPendingDaemonServiceUpdate,
  readPendingDaemonServiceUpdate,
  runPendingDaemonServiceUpdate,
  scheduleDaemonServiceUpdate,
} from "../src/local-service/lifecycle/daemon-service-update-coordinator";

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
      v: 1,
      schema: "openmeld-daemon-service-update-job-v1",
      jobId: "update-persisted",
      requestedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      targetVersion: "0.3.98",
      urgency: "available",
      status: "scheduled",
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
        status: "completed" as const,
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
        status: "scheduled",
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

  it("keeps the pending job until the replacement is healthy, then completes it", async () => {
    const job: DaemonServiceUpdateJob = {
      v: 1,
      schema: "openmeld-daemon-service-update-job-v1",
      jobId: "update-1",
      requestedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      targetVersion: "0.3.98",
      urgency: "available",
      status: "scheduled",
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

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ status: "running", attempts: 1 });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ status: "completed" });
    expect(result).toMatchObject({ status: "completed" });
  });

  it("records a failed update only after the lifecycle restores a safe state", async () => {
    const job: DaemonServiceUpdateJob = {
      v: 1,
      schema: "openmeld-daemon-service-update-job-v1",
      jobId: "update-1",
      requestedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      targetVersion: "0.3.98",
      urgency: "required",
      status: "scheduled",
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
      status: "failed",
      errorMessage: "replacement failed to start",
    });
    expect(result).toMatchObject({ status: "failed" });
    expect(waitUntilSafeToSwitch).not.toHaveBeenCalled();
  });

  it("keeps a transient failure pending so the OS worker can retry it", async () => {
    const job: DaemonServiceUpdateJob = {
      v: 1,
      schema: "openmeld-daemon-service-update-job-v1",
      jobId: "update-1",
      requestedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      targetVersion: "0.3.98",
      urgency: "available",
      status: "scheduled",
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
      attempts: 1,
      errorMessage: "temporary control-plane error",
      status: "scheduled",
    });
    expect(completed).toHaveLength(0);
  });
});
