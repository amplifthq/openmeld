import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contract: vi.fn(),
  status: vi.fn(),
  policyCurrent: vi.fn(),
  requestUpdate: vi.fn(),
  pending: vi.fn(),
  schedule: vi.fn(),
  runPending: vi.fn(),
  refreshCarrier: vi.fn(),
  finishSetup: vi.fn(),
  completePending: vi.fn(),
}));

vi.mock("../src/commands/computer-setup-continuation", () => ({
  finishComputerSetupAfterBackgroundUpdate: mocks.finishSetup,
  recoverComputerSetupAfterBackgroundUpdate: async () => undefined,
}));

vi.mock("../src/config/lock", () => ({
  acquireLock: async () => ({}),
  runWithHeldLock: async ({ run }: { run: () => Promise<unknown> }) =>
    await run(),
  isOpenMeldLockError: () => false,
  isOpenMeldOrphanedLockError: () => false,
}));
vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: mocks.contract,
}));
vi.mock("../src/runtime/version", () => ({ OPENMELD_VERSION: "0.2.2" }));
vi.mock("../src/skills/maintenance", () => ({
  maintainOfficialCliSkill: async () => undefined,
}));
vi.mock(
  "../src/local-service/lifecycle/daemon-service-manager-command-match",
  () => ({
    assertDaemonMaintenanceInstallationOwnership: async () => undefined,
  })
);
vi.mock("../src/local-service/lifecycle/daemon-service-manager", () => ({
  resolveDaemonServiceManager: async () => ({
    controller: "launchd",
    status: mocks.status,
  }),
  readDaemonServiceStartupPolicyCurrent: mocks.policyCurrent,
}));
vi.mock("../src/local-service/lifecycle/daemon-service-update-state", () => ({
  readPendingDaemonServiceUpdate: mocks.pending,
  completePendingDaemonServiceUpdate: mocks.completePending,
}));
vi.mock(
  "../src/local-service/lifecycle/daemon-service-update-coordinator",
  () => ({
    runPendingDaemonServiceUpdate: mocks.runPending,
    scheduleDaemonServiceUpdate: mocks.schedule,
  })
);
vi.mock(
  "../src/local-service/lifecycle/daemon-service-update-worker-manager",
  () => ({
    prepareDaemonServiceUpdateWorkerCarrier: mocks.refreshCarrier,
  })
);
vi.mock(
  "../src/local-service/maintenance/openmeld-tools-maintenance-policy",
  () => ({
    readOpenMeldToolsMaintenancePolicy: async () => ({
      automaticUpdatesEnabled: true,
    }),
  })
);
vi.mock(
  "../src/local-service/maintenance/openmeld-tools-update-attempt-state",
  () => ({
    readPendingOpenMeldToolsUpdateAttempt: async () => null,
  })
);
vi.mock(
  "../src/local-service/maintenance/openmeld-tools-update-coordinator",
  () => ({
    createOpenMeldToolsUpdateCoordinator: () => ({
      requestUpdate: mocks.requestUpdate,
      waitForIdle: async () => undefined,
    }),
  })
);

import { runOpenMeldMaintenanceWorker } from "../src/local-service/maintenance/openmeld-maintenance-worker";

describe("maintenance of the installed Service scheduling policy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.contract.mockResolvedValue({
      desiredState: "background",
      daemonVersion: "0.2.2",
    });
    mocks.status.mockResolvedValue({ installed: true });
    mocks.policyCurrent.mockResolvedValue(false);
    mocks.requestUpdate.mockResolvedValue({
      status: "current",
      currentVersion: "0.2.2",
    });
    mocks.pending.mockResolvedValue(null);
    mocks.runPending.mockResolvedValue(null);
  });

  it("schedules same-version drift through the existing safe update worker", async () => {
    await runOpenMeldMaintenanceWorker();
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith({
      targetVersion: "0.2.2",
      urgency: "available",
      requestSource: "automatic",
    });
    expect(mocks.runPending).toHaveBeenCalledOnce();
  });

  it.each([
    true,
    null,
  ])("leaves current or inapplicable policies alone: %j", async (policyCurrent) => {
    mocks.policyCurrent.mockResolvedValue(policyCurrent);
    await runOpenMeldMaintenanceWorker();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it.each([
    { desiredState: "stopped", daemonVersion: "0.2.2" },
    { desiredState: "background", daemonVersion: "0.2.3" },
  ])("does not restart a stopped Service or apply an old worker policy: %j", async (contract) => {
    mocks.contract.mockResolvedValue(contract);
    await runOpenMeldMaintenanceWorker();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("honors disabled automatic updates", async () => {
    mocks.requestUpdate.mockResolvedValue({ status: "disabled" });
    await runOpenMeldMaintenanceWorker();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("finishes an existing update and refreshes its recovery carrier without adding another job", async () => {
    const result = {
      jobId: "already-scheduled",
      phase: "updated",
      targetVersion: "0.2.3",
    };
    mocks.pending.mockResolvedValue(result);
    mocks.runPending.mockResolvedValue(result);
    mocks.finishSetup.mockImplementation(() => {
      // The OS must still see durable work until setup has finished. Deleting
      // it earlier would strand the continuation after a worker crash.
      expect(mocks.completePending).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    await runOpenMeldMaintenanceWorker();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.refreshCarrier).toHaveBeenCalledExactlyOnceWith(result);
    expect(mocks.completePending).toHaveBeenCalledExactlyOnceWith(result);
  });
});
