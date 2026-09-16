import type {
  DaemonServiceUpdateJob,
  OpenMeldToolsUpdateAttempt,
  OpenMeldToolsUpdateFailureCode,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { createOpenMeldToolsUpdateCoordinator } from "../src/local-service/maintenance/openmeld-tools-update-coordinator";
import { resolveOpenMeldToolsUpgradeProgram } from "../src/local-service/maintenance/openmeld-tools-upgrade-process";

const NOW = "2026-08-25T08:00:00.000Z";

function createDependencies(input?: {
  automaticUpdatesEnabled?: boolean;
  updateAvailable?: boolean;
  serviceNeedsAlignment?: boolean;
  serviceVersion?: string;
  upgradeExitCode?: number;
  upgradeFailure?: {
    detail: string;
    failureCode: OpenMeldToolsUpdateFailureCode;
  };
  serviceJobAfterUpgrade?: DaemonServiceUpdateJob | null;
}) {
  let pendingAttempt: OpenMeldToolsUpdateAttempt | null = null;
  let lastAttempt: OpenMeldToolsUpdateAttempt | null = null;
  let pendingServiceJob: DaemonServiceUpdateJob | null = null;
  const runUpgrade = vi.fn(() => {
    pendingServiceJob = input?.serviceJobAfterUpgrade ?? null;
    return Promise.resolve({
      exitCode: input?.upgradeExitCode ?? 0,
      ...(input?.upgradeFailure
        ? { processFailure: input.upgradeFailure }
        : {}),
    });
  });
  const assessUpdate = vi.fn(async () => ({
    checked: true,
    currentVersion: "0.3.104",
    latestVersion: input?.updateAvailable === false ? "0.3.104" : "0.3.105",
    requiredFloor: null,
    updateAvailable: input?.updateAvailable !== false,
    floorBreached: false,
    ...(input?.serviceVersion ? { serviceVersion: input.serviceVersion } : {}),
  }));

  return {
    withCoordinationLock: async <T>(run: () => Promise<T>) => await run(),
    wakeWorker: vi.fn(async () => undefined),
    assessUpdate,
    serviceNeedsAlignment: vi.fn(
      async () => input?.serviceNeedsAlignment ?? false
    ),
    completeAttempt: vi.fn((attempt: OpenMeldToolsUpdateAttempt) => {
      lastAttempt = attempt;
      pendingAttempt = null;
      return Promise.resolve();
    }),
    createOperationId: () => "update-1",
    discardPendingAttempt: vi.fn(() => {
      pendingAttempt = null;
      return Promise.resolve();
    }),
    now: () => NOW,
    persistAttempt: vi.fn((attempt: OpenMeldToolsUpdateAttempt) => {
      pendingAttempt = attempt;
      return Promise.resolve();
    }),
    readPendingAttempt: vi.fn(async () => pendingAttempt),
    readPendingServiceJob: vi.fn(async () => pendingServiceJob),
    readPolicy: vi.fn(async () => ({
      v: 1 as const,
      automaticUpdatesEnabled: input?.automaticUpdatesEnabled ?? true,
      updatedAt: NOW,
    })),
    resolveUrgency: vi.fn(async () => "available" as const),
    runUpgrade,
    state: {
      get lastAttempt() {
        return lastAttempt;
      },
      get pendingAttempt() {
        return pendingAttempt;
      },
    },
  };
}

describe("OpenMeld Tools update coordinator", () => {
  it("hands Service requests to the worker without running an updater in the Service", async () => {
    const dependencies = createDependencies();
    const service = createOpenMeldToolsUpdateCoordinator(dependencies, {
      executeUpdates: false,
    });
    const requested = await service.requestUpdate({ requestSource: "web" });
    expect(requested.status).toBe("started");
    expect(dependencies.state.pendingAttempt?.operation.operationId).toBe(
      "update-1"
    );
    expect(dependencies.wakeWorker).toHaveBeenCalledOnce();
    expect(dependencies.runUpgrade).not.toHaveBeenCalled();
    await service.waitForIdle();
    const worker = createOpenMeldToolsUpdateCoordinator(dependencies);
    await worker.resumePendingUpdate();
    await worker.waitForIdle();
    expect(dependencies.runUpgrade).toHaveBeenCalledOnce();
    expect(dependencies.state.lastAttempt?.operation.operationId).toBe(
      "update-1"
    );
  });
  it("does nothing automatically after the user turns updates off", async () => {
    const dependencies = createDependencies({
      automaticUpdatesEnabled: false,
    });
    const coordinator = createOpenMeldToolsUpdateCoordinator(dependencies);

    await expect(
      coordinator.requestUpdate({ requestSource: "automatic" })
    ).resolves.toEqual({ status: "disabled" });
    expect(dependencies.assessUpdate).not.toHaveBeenCalled();
    expect(dependencies.runUpgrade).not.toHaveBeenCalled();
  });

  it("still honors a direct update request when automatic updates are off", async () => {
    const dependencies = createDependencies({
      automaticUpdatesEnabled: false,
    });
    const coordinator = createOpenMeldToolsUpdateCoordinator(dependencies);

    await expect(
      coordinator.requestUpdate({ requestSource: "web" })
    ).resolves.toMatchObject({
      status: "started",
      operation: {
        operationId: "update-1",
        phase: "updating",
        requestSource: "web",
        targetVersion: "0.3.105",
      },
    });

    await coordinator.waitForIdle();
    expect(dependencies.assessUpdate).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(dependencies.runUpgrade).toHaveBeenCalledTimes(1);
    expect(dependencies.state.lastAttempt?.operation).toMatchObject({
      phase: "updated",
    });
  });

  it("hands one operation to the existing Service update worker", async () => {
    const serviceJob = {
      v: 2 as const,
      schema: "openmeld-daemon-service-update-job-v2" as const,
      attempts: 0,
      desiredState: "background" as const,
      errorMessage: null,
      jobId: "update-1",
      phase: "waiting_for_work" as const,
      preparedBundle: {
        v: 2 as const,
        schema: "openmeld-daemon-active-bundle-v2" as const,
        bundleId: "0.3.105-bundle",
        daemonVersion: "0.3.105",
        entryScriptRelativePath: "openmeld",
        bundleFormat: "binary_v1" as const,
        sourceEntryScriptPath: "/tmp/openmeld",
        sourcePackageRootPath: "/tmp",
        sourceDistRootPath: "/tmp",
        sourceDistFingerprint: "abc123",
        sourceKind: "package_install" as const,
        createdAt: NOW,
        updatedAt: NOW,
      },
      requestedAt: NOW,
      requestSource: "automatic" as const,
      targetVersion: "0.3.105",
      updatedAt: NOW,
      urgency: "available" as const,
    };
    const dependencies = createDependencies({
      serviceJobAfterUpgrade: serviceJob,
    });
    const coordinator = createOpenMeldToolsUpdateCoordinator(dependencies);

    await coordinator.requestUpdate({ requestSource: "automatic" });
    await coordinator.waitForIdle();

    expect(dependencies.discardPendingAttempt).toHaveBeenCalledTimes(1);
    expect(dependencies.state.pendingAttempt).toBeNull();
    expect(dependencies.state.lastAttempt).toBeNull();
    expect(dependencies.runUpgrade).toHaveBeenCalledWith({
      operationId: "update-1",
      requestedAt: NOW,
      requestSource: "automatic",
    });
  });

  it("coalesces simultaneous automatic and direct requests", async () => {
    const dependencies = createDependencies();
    let finishUpgrade!: (result: { exitCode: number }) => void;
    const upgradeResult = new Promise<{ exitCode: number }>((resolve) => {
      finishUpgrade = resolve;
    });
    dependencies.runUpgrade.mockImplementation(async () => await upgradeResult);
    const coordinator = createOpenMeldToolsUpdateCoordinator(dependencies);

    const [automatic, direct] = await Promise.all([
      coordinator.requestUpdate({ requestSource: "automatic" }),
      coordinator.requestUpdate({ requestSource: "web" }),
    ]);
    finishUpgrade({ exitCode: 0 });
    await coordinator.waitForIdle();

    expect(automatic).toMatchObject({
      status: "started",
      operation: { operationId: "update-1" },
    });
    expect(direct).toMatchObject({
      status: "already_running",
      operation: { operationId: "update-1" },
    });
    expect(dependencies.assessUpdate).toHaveBeenCalledTimes(1);
    expect(dependencies.runUpgrade).toHaveBeenCalledTimes(1);
  });

  it("keeps the old tools running and records a failed automatic update", async () => {
    const dependencies = createDependencies({ upgradeExitCode: 1 });
    const coordinator = createOpenMeldToolsUpdateCoordinator(dependencies);

    await coordinator.requestUpdate({ requestSource: "automatic" });
    await coordinator.waitForIdle();

    expect(dependencies.state.lastAttempt?.operation).toMatchObject({
      phase: "needs_help",
      targetVersion: "0.3.105",
    });
  });

  it("persists the typed process failure without adding it to attempt v1", async () => {
    const dependencies = createDependencies({
      upgradeExitCode: 1,
      upgradeFailure: {
        detail: "binary download stopped after /private/local/path",
        failureCode: "cli.update.download_stalled",
      },
    });
    const coordinator = createOpenMeldToolsUpdateCoordinator(dependencies);

    await coordinator.requestUpdate({ requestSource: "web" });
    await coordinator.waitForIdle();

    expect(dependencies.state.lastAttempt?.errorMessage).toBe(
      "openmeld.tools.update.failure=cli.update.download_stalled\nbinary download stopped after /private/local/path"
    );
    expect(dependencies.state.lastAttempt?.operation).not.toHaveProperty(
      "failure"
    );
  });

  it.each([
    undefined,
    "0.3.100",
  ])("aligns the selected Service through the same operation when the CLI is current (target=%s)", async (serviceVersion) => {
    const dependencies = createDependencies({
      updateAvailable: false,
      serviceNeedsAlignment: true,
      serviceVersion,
    });
    const coordinator = createOpenMeldToolsUpdateCoordinator(dependencies, {
      executeUpdates: false,
    });
    const first = await coordinator.requestUpdate({ requestSource: "cli" });
    const second = await coordinator.requestUpdate({ requestSource: "web" });
    expect(first).toMatchObject({
      status: "started",
      operation: {
        operationId: "update-1",
        targetVersion: serviceVersion ?? "0.3.104",
      },
    });
    expect(second).toMatchObject({
      status: "already_running",
      operation: { operationId: "update-1" },
    });
    expect(dependencies.persistAttempt).toHaveBeenCalledOnce();
    expect(dependencies.serviceNeedsAlignment).toHaveBeenCalledWith(
      serviceVersion ?? "0.3.104"
    );
    expect(dependencies.runUpgrade).not.toHaveBeenCalled();
  });

  it("stays quiet when this computer already has the latest version", async () => {
    const dependencies = createDependencies({ updateAvailable: false });
    const coordinator = createOpenMeldToolsUpdateCoordinator(dependencies);

    await expect(
      coordinator.requestUpdate({ requestSource: "automatic" })
    ).resolves.toEqual({
      currentVersion: "0.3.104",
      status: "current",
    });
    expect(dependencies.assessUpdate).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(dependencies.persistAttempt).not.toHaveBeenCalled();
    expect(dependencies.runUpgrade).not.toHaveBeenCalled();
  });

  it("executes the protected npm carrier without loading business bundle state", () => {
    expect(
      resolveOpenMeldToolsUpgradeProgram({
        binaryDistribution: false,
        processEntryScriptPath: "/tmp/maintenance/service-update-worker.mjs",
        processExecutablePath: "/Users/member/.nvm/versions/node/v24/bin/node",
      })
    ).toEqual({
      argsPrefix: ["/tmp/maintenance/service-update-worker.mjs"],
      command: "/Users/member/.nvm/versions/node/v24/bin/node",
    });
  });

  it("executes the protected binary carrier", () => {
    expect(
      resolveOpenMeldToolsUpgradeProgram({
        binaryDistribution: true,
        processExecutablePath: "/tmp/maintenance/openmeld",
      })
    ).toEqual({ argsPrefix: [], command: "/tmp/maintenance/openmeld" });
  });
});
