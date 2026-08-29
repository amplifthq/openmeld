import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const pruneManagedInstallVersionsMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-command-spec", () => ({
  buildDaemonSystemServiceCommandSpec: vi.fn(),
}));
vi.mock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
  clearDaemonServiceUpdateWorkerBinaryExecutable: vi.fn(),
  daemonServiceUpdateWorkerBinaryPath: vi.fn(
    () =>
      "/tmp/openmeld-home/runtime/daemon/service-manager/OpenMeld Update Worker Binary"
  ),
  ensureDaemonServiceUpdateWorkerBinaryExecutable: vi.fn(),
  readDaemonActiveBundleState: vi.fn(),
  resolveDaemonBundleEntryPathFromState: vi.fn(),
}));
vi.mock("../src/local-service/lifecycle/daemon-service-manager", () => ({
  resolveDaemonServiceManager: vi.fn(),
}));
vi.mock("../src/local-components/managed-install", () => ({
  pruneManagedInstallVersions: (...args: unknown[]) =>
    pruneManagedInstallVersionsMock(...args),
}));

import {
  ensureDaemonServiceUpdateWorkerBinaryExecutable,
  readDaemonActiveBundleState,
  resolveDaemonBundleEntryPathFromState,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { buildDaemonSystemServiceCommandSpec } from "../src/local-service/lifecycle/daemon-service-command-spec";
import { resolveDaemonServiceManager } from "../src/local-service/lifecycle/daemon-service-manager";
import type { DaemonServiceUpdateJob } from "../src/local-service/lifecycle/daemon-service-update-state";
import {
  buildDaemonServiceUpdateWorkerSpec,
  buildLaunchdServiceUpdateWorkerPlist,
  buildSystemdServiceUpdateWorkerPathUnit,
  buildSystemdServiceUpdateWorkerUnit,
  installDaemonServiceUpdateWorker,
  pruneDaemonServiceUpdateWorkerManagedVersions,
} from "../src/local-service/lifecycle/daemon-service-update-worker-manager";

const SPEC = {
  args: ["service", "update-worker"],
  env: {
    OPENMELD_ENV_PRESET: "prod",
    OPENMELD_HOME: "/tmp/openmeld-home",
  },
  executable: "/tmp/openmeld-home/versions/0.3.98/openmeld",
  pendingJobPath: "/tmp/openmeld-home/runtime/state/service-update.json",
  workingDirectory: "/tmp/openmeld-home/runtime",
};

describe("daemon service update worker manager", () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform"
  );

  afterEach(() => {
    spawnMock.mockReset();
    pruneManagedInstallVersionsMock.mockReset();
    vi.mocked(readDaemonActiveBundleState).mockReset();
    vi.mocked(ensureDaemonServiceUpdateWorkerBinaryExecutable).mockReset();
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
  });

  it("starts a binary update worker from its stable carrier instead of a prunable version path", async () => {
    const preparedExecutable = "/tmp/openmeld-home/versions/0.3.98/openmeld";
    vi.mocked(resolveDaemonServiceManager).mockResolvedValue({
      controller: "launchd",
    } as never);
    vi.mocked(buildDaemonSystemServiceCommandSpec).mockReturnValue({
      args: ["service", "run", "--mode", "foreground"],
      env: SPEC.env,
      executable:
        "/tmp/openmeld-home/runtime/daemon/service-manager/OpenMeld Service",
      workingDirectory: SPEC.workingDirectory,
    });
    vi.mocked(resolveDaemonBundleEntryPathFromState).mockResolvedValue(
      "/tmp/openmeld-home/runtime/daemon/service-manager/OpenMeld Service"
    );
    const job: DaemonServiceUpdateJob = {
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "stable-carrier-update",
      phase: "waiting_for_work",
      preparedBundle: {
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleFormat: "binary_v1",
        bundleId: "binary-0.3.98",
        createdAt: "2026-08-25T00:00:00.000Z",
        daemonVersion: "0.3.98",
        entryScriptRelativePath: "openmeld",
        sourceDistFingerprint: "abc123",
        sourceDistRootPath: "/tmp/openmeld-home/versions/0.3.98",
        sourceEntryScriptPath: preparedExecutable,
        sourceKind: "package_install",
        sourcePackageRootPath: "/tmp/openmeld-home/versions/0.3.98",
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
      requestedAt: "2026-08-25T00:00:00.000Z",
      requestSource: "cli",
      targetVersion: "0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
      urgency: "available",
    };

    await expect(
      buildDaemonServiceUpdateWorkerSpec(job)
    ).resolves.toMatchObject({
      args: ["service", "update-worker"],
      executable:
        "/tmp/openmeld-home/runtime/daemon/service-manager/OpenMeld Update Worker Binary",
    });
    expect(resolveDaemonBundleEntryPathFromState).not.toHaveBeenCalled();
  });

  it("keeps the macOS worker alive only while a durable update is pending", () => {
    const plist = buildLaunchdServiceUpdateWorkerPlist({
      label: "com.openmeld.openmeld-service-update",
      logPath: "/tmp/openmeld-home/runtime/logs/service-update.log",
      spec: SPEC,
    });

    expect(plist).toContain(
      "<string>com.openmeld.openmeld-service-update</string>"
    );
    expect(plist).toContain("<key>PathState</key>");
    expect(plist).toContain(`<key>${SPEC.pendingJobPath}</key>`);
    expect(plist).toContain(`<string>${SPEC.executable}</string>`);
    expect(plist).toContain("<string>update-worker</string>");
    expect(plist).not.toContain("<key>KeepAlive</key>\n  <true/>");
  });

  it("lets systemd restart a crashed worker and resume it after reboot", () => {
    const unit = buildSystemdServiceUpdateWorkerUnit({
      spec: SPEC,
    });

    expect(unit).toContain(
      "ExecStart=/tmp/openmeld-home/versions/0.3.98/openmeld service update-worker"
    );
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");

    const pathUnit = buildSystemdServiceUpdateWorkerPathUnit({
      pendingJobPath: SPEC.pendingJobPath,
      serviceName: "openmeld-service-update",
    });
    expect(pathUnit).toContain(`PathExists=${SPEC.pendingJobPath}`);
    expect(pathUnit).toContain("Unit=openmeld-service-update.service");
    expect(pathUnit).toContain("WantedBy=default.target");
  });

  it("registers the stable worker without pruning versioned binaries", async () => {
    const homeDir = await mkdtemp(
      `${tmpdir()}/openmeld-update-worker-registration-`
    );
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    vi.mocked(readDaemonActiveBundleState).mockResolvedValue({
      daemonVersion: "0.3.97",
    } as never);
    vi.mocked(resolveDaemonServiceManager).mockResolvedValue({
      controller: "launchd",
    } as never);
    vi.mocked(buildDaemonSystemServiceCommandSpec).mockReturnValue({
      args: ["service", "run", "--mode", "foreground"],
      env: SPEC.env,
      executable:
        "/tmp/openmeld-home/runtime/daemon/service-manager/OpenMeld Service Binary",
      workingDirectory: SPEC.workingDirectory,
    });
    pruneManagedInstallVersionsMock.mockResolvedValue(undefined);
    const job = createBinaryUpdateJob();
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "dev-local",
      },
      homeDir,
    };

    try {
      await installDaemonServiceUpdateWorker(job, pathInput);
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }

    expect(
      ensureDaemonServiceUpdateWorkerBinaryExecutable
    ).toHaveBeenCalledWith(job.preparedBundle, pathInput);
    expect(pruneManagedInstallVersionsMock).not.toHaveBeenCalled();
  });

  it("prunes managed versions only when the coordinator requests it", async () => {
    vi.mocked(readDaemonActiveBundleState).mockResolvedValue({
      daemonVersion: "0.3.97",
    } as never);
    pruneManagedInstallVersionsMock.mockResolvedValue(undefined);
    const job = createBinaryUpdateJob();
    const homeDir = await mkdtemp(
      `${tmpdir()}/openmeld-update-worker-prune-success-`
    );
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: homeDir,
      },
      homeDir,
    };

    try {
      await pruneDaemonServiceUpdateWorkerManagedVersions(job, pathInput);
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }

    expect(readDaemonActiveBundleState).toHaveBeenCalledWith(pathInput);
    expect(pruneManagedInstallVersionsMock).toHaveBeenCalledWith({
      pathInput,
      preferredRollbackVersion: "0.3.97",
    });
  });

  it("fails closed when the active rollback bundle cannot be read", async () => {
    vi.mocked(readDaemonActiveBundleState).mockRejectedValue(
      new Error("active bundle state is unreadable")
    );
    const job = createBinaryUpdateJob();
    const homeDir = await mkdtemp(
      `${tmpdir()}/openmeld-update-worker-prune-failure-`
    );
    const pathInput = {
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: homeDir,
      },
      homeDir,
    };

    try {
      await expect(
        pruneDaemonServiceUpdateWorkerManagedVersions(job, pathInput)
      ).rejects.toThrow("active bundle state is unreadable");
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }

    expect(readDaemonActiveBundleState).toHaveBeenCalledWith(pathInput);
    expect(pruneManagedInstallVersionsMock).not.toHaveBeenCalled();
  });
});

function createBinaryUpdateJob(): DaemonServiceUpdateJob {
  return {
    v: 2,
    schema: "openmeld-daemon-service-update-job-v2",
    attempts: 0,
    desiredState: "background",
    errorMessage: null,
    jobId: "stable-carrier-update",
    phase: "waiting_for_work",
    preparedBundle: {
      v: 2,
      schema: "openmeld-daemon-active-bundle-v2",
      bundleFormat: "binary_v1",
      bundleId: "binary-0.3.98",
      createdAt: "2026-08-25T00:00:00.000Z",
      daemonVersion: "0.3.98",
      entryScriptRelativePath: "openmeld",
      sourceDistFingerprint: "abc123",
      sourceDistRootPath: "/tmp/openmeld-home/versions/0.3.98",
      sourceEntryScriptPath: "/tmp/openmeld-home/versions/0.3.98/openmeld",
      sourceKind: "package_install",
      sourcePackageRootPath: "/tmp/openmeld-home/versions/0.3.98",
      updatedAt: "2026-08-25T00:00:00.000Z",
    },
    requestedAt: "2026-08-25T00:00:00.000Z",
    requestSource: "cli",
    targetVersion: "0.3.98",
    updatedAt: "2026-08-25T00:00:00.000Z",
    urgency: "available",
  };
}
