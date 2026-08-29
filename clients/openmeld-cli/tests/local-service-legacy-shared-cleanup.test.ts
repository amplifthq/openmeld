import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDaemonStatusMock,
  getDaemonRuntimeStatusMock,
  listDaemonOwnedProcessesMock,
  resolveDaemonServiceManagerMock,
  uninstallDaemonMock,
} = vi.hoisted(() => ({
  getDaemonStatusMock: vi.fn(),
  getDaemonRuntimeStatusMock: vi.fn(),
  listDaemonOwnedProcessesMock: vi.fn(),
  resolveDaemonServiceManagerMock: vi.fn(),
  uninstallDaemonMock: vi.fn(),
}));

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    getDaemonStatus: (...args: Parameters<typeof getDaemonStatusMock>) =>
      getDaemonStatusMock(...args),
    getDaemonRuntimeStatus: (
      ...args: Parameters<typeof getDaemonRuntimeStatusMock>
    ) => getDaemonRuntimeStatusMock(...args),
    uninstallDaemon: (...args: Parameters<typeof uninstallDaemonMock>) =>
      uninstallDaemonMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-manager", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-manager")
  >("../src/local-service/lifecycle/daemon-service-manager");
  return {
    ...actual,
    resolveDaemonServiceManager: (
      ...args: Parameters<typeof resolveDaemonServiceManagerMock>
    ) => resolveDaemonServiceManagerMock(...args),
  };
});

vi.mock(
  "../src/local-service/lifecycle/daemon-service-process-inventory",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-process-inventory")
    >("../src/local-service/lifecycle/daemon-service-process-inventory");
    return {
      ...actual,
      listDaemonOwnedProcesses: (
        ...args: Parameters<typeof listDaemonOwnedProcessesMock>
      ) => listDaemonOwnedProcessesMock(...args),
    };
  }
);

import { cleanupLegacySharedDaemonServiceState } from "../src/local-service/lifecycle/daemon-service-legacy-shared";

describe("legacy shared local service cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDaemonStatusMock.mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.3.2",
        installSource: "daemon.command.install",
        installedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    });
    getDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    });
    listDaemonOwnedProcessesMock.mockResolvedValue([]);
    uninstallDaemonMock.mockResolvedValue({ removed: true });
  });

  it("lets production remove its own legacy service state", async () => {
    const uninstall = vi.fn().mockResolvedValue(undefined);
    const waitUntilAbsent = vi.fn().mockResolvedValue(undefined);

    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: vi.fn(),
      uninstall,
      start: vi.fn(),
      stop: vi.fn(),
      deactivate: vi.fn(),
      status: vi.fn().mockResolvedValue({
        installed: true,
        running: false,
        enabled: true,
        definitionPath:
          "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
        commandSummary:
          "/usr/local/bin/node /tmp/old-openmeld-home/.openmeld/runtime/daemon/service-manager/daemon-service-launcher.mjs service run --mode foreground",
      }),
      waitUntilAbsent,
      waitUntilStopped: vi.fn(),
      waitUntilRunning: vi.fn(),
    });

    const result = await cleanupLegacySharedDaemonServiceState({
      env: {
        OPENMELD_ENV_PRESET: "prod",
      },
    });

    expect(uninstall).toHaveBeenCalledTimes(1);
    expect(waitUntilAbsent).toHaveBeenCalledTimes(1);
    expect(uninstallDaemonMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ removed: true });
  });

  it.each([
    "dev-local",
    "canary",
  ])("never uninstalls the production service from %s", async (envPreset) => {
    const result = await cleanupLegacySharedDaemonServiceState({
      env: {
        OPENMELD_ENV_PRESET: envPreset,
      },
    });

    expect(resolveDaemonServiceManagerMock).not.toHaveBeenCalled();
    expect(uninstallDaemonMock).not.toHaveBeenCalled();
    expect(result).toEqual({ removed: false });
  });
});
