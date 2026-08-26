import type {
  DaemonServiceUpdateJob,
  OpenMeldToolsUpdateAttempt,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { startOpenMeldToolsAutomaticUpdateLoop } from "../src/local-service/maintenance/openmeld-tools-automatic-update-loop";
import { createOpenMeldToolsUpdateCoordinator } from "../src/local-service/maintenance/openmeld-tools-update-coordinator";
import { resolveOpenMeldToolsUpgradeProgram } from "../src/local-service/maintenance/openmeld-tools-upgrade-process";

const NOW = "2026-08-25T08:00:00.000Z";

function createDependencies(input?: {
  automaticUpdatesEnabled?: boolean;
  updateAvailable?: boolean;
  upgradeExitCode?: number;
  serviceJobAfterUpgrade?: DaemonServiceUpdateJob | null;
}) {
  let pendingAttempt: OpenMeldToolsUpdateAttempt | null = null;
  let lastAttempt: OpenMeldToolsUpdateAttempt | null = null;
  let pendingServiceJob: DaemonServiceUpdateJob | null = null;
  const runUpgrade = vi.fn(() => {
    pendingServiceJob = input?.serviceJobAfterUpgrade ?? null;
    return Promise.resolve({ exitCode: input?.upgradeExitCode ?? 0 });
  });
  const assessUpdate = vi.fn(async () => ({
    checked: true,
    currentVersion: "0.3.104",
    latestVersion: input?.updateAvailable === false ? "0.3.104" : "0.3.105",
    requiredFloor: null,
    updateAvailable: input?.updateAvailable !== false,
    floorBreached: false,
  }));

  return {
    assessUpdate,
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

  it("resumes saved work as soon as the Service starts", async () => {
    const resumePendingUpdate = vi.fn(async () => false);
    const stop = startOpenMeldToolsAutomaticUpdateLoop({
      coordinator: {
        requestUpdate: vi.fn(),
        resumePendingUpdate,
        waitForIdle: vi.fn(),
      },
      initialDelayMs: 60_000,
    });

    await vi.waitFor(() => {
      expect(resumePendingUpdate).toHaveBeenCalledTimes(1);
    });
    await stop();
  });

  it("checks for new releases every hour", async () => {
    vi.useFakeTimers();
    const requestUpdate = vi.fn(async () => ({ status: "disabled" as const }));
    const stop = startOpenMeldToolsAutomaticUpdateLoop({
      coordinator: {
        requestUpdate,
        resumePendingUpdate: vi.fn(async () => false),
        waitForIdle: vi.fn(),
      },
      initialDelayMs: 0,
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(requestUpdate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1);
      expect(requestUpdate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(requestUpdate).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("does not keep Service shutdown waiting for an update process", () => {
    const waitForIdle = vi.fn(
      async () => await new Promise<void>(() => undefined)
    );
    const stop = startOpenMeldToolsAutomaticUpdateLoop({
      coordinator: {
        requestUpdate: vi.fn(),
        resumePendingUpdate: vi.fn(async () => false),
        waitForIdle,
      },
      initialDelayMs: 60_000,
    });

    expect(stop()).toBeUndefined();
    expect(waitForIdle).not.toHaveBeenCalled();
  });

  it("updates the npm installation that created the active Service", () => {
    expect(
      resolveOpenMeldToolsUpgradeProgram({
        activeBundle: {
          bundleFormat: "self_contained_v1",
          sourceEntryScriptPath:
            "/Users/member/.nvm/versions/node/v24/lib/node_modules/openmeld/dist/openmeld.js",
        },
        binaryDistribution: false,
        processEntryScriptPath: "/tmp/service-bundle/openmeld.js",
        processExecutablePath: "/Users/member/.nvm/versions/node/v24/bin/node",
      })
    ).toEqual({
      argsPrefix: [
        "/Users/member/.nvm/versions/node/v24/lib/node_modules/openmeld/dist/openmeld.js",
      ],
      command: "/Users/member/.nvm/versions/node/v24/bin/node",
    });
  });

  it("updates the managed binary that created the active Service", () => {
    expect(
      resolveOpenMeldToolsUpgradeProgram({
        activeBundle: {
          bundleFormat: "binary_v1",
          sourceEntryScriptPath:
            "/Users/member/.openmeld/bin/versions/0.3.104/openmeld",
        },
        binaryDistribution: true,
        processExecutablePath: "/tmp/service-bundle/openmeld",
      })
    ).toEqual({
      argsPrefix: [],
      command: "/Users/member/.openmeld/bin/versions/0.3.104/openmeld",
    });
  });
});
