import { describe, expect, it, vi } from "vitest";
import { runDaemonTeardownStrict } from "../src/commands/service";

describe("openmeld service strict teardown legacy shared cleanup", () => {
  it("cleans up a detected legacy shared service during strict teardown", async () => {
    const cleanupLegacySharedDaemonServiceState = vi.fn().mockResolvedValue({
      removed: true,
    });

    const result = await runDaemonTeardownStrict(
      {
        reason: "reset",
      },
      {
        withRegistrationMutationLock: async (callback) => await callback(),
        getDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        readCurrentObservedDaemonRuntimeStatus: vi
          .fn()
          .mockResolvedValueOnce({
            status: "not_running",
            mode: null,
            pid: null,
            startedAt: null,
            updatedAt: null,
            managedBySystemService: false,
            serviceController: "unknown",
            autoStart: false,
          })
          .mockResolvedValueOnce({
            status: "not_running",
            mode: null,
            pid: null,
            startedAt: null,
            updatedAt: null,
            managedBySystemService: false,
            serviceController: "unknown",
            autoStart: false,
          })
          .mockResolvedValueOnce({
            status: "not_running",
            mode: null,
            pid: null,
            startedAt: null,
            updatedAt: null,
            managedBySystemService: false,
            serviceController: "unknown",
            autoStart: false,
          }),
        resolveDaemonServiceManagerForRuntimeState: vi.fn().mockResolvedValue({
          serviceManager: null,
          serviceManagerStatus: null,
          legacySharedService: {
            present: true,
            pathInput: {
              env: {
                OPENMELD_ENV_PRESET: "prod",
              },
            },
            installStatus: {
              installed: true,
              state: {
                v: 1,
                schema: "openmeld-daemon-install-v1",
                daemonVersion: "0.1.9",
                installSource: "daemon.command.install",
                installedAt: "2026-03-08T00:00:00.000Z",
                updatedAt: "2026-03-08T00:00:00.000Z",
              },
            },
            runtimeStatus: {
              status: "not_running",
              mode: null,
              pid: null,
              startedAt: null,
              updatedAt: null,
              managedBySystemService: false,
              serviceController: "unknown",
              autoStart: false,
            },
            serviceManager: null,
            serviceManagerStatus: null,
            ownedProcesses: [],
          },
        }),
        clearDaemonServiceRuntimeState: vi.fn().mockResolvedValue(undefined),
        cleanupLegacySharedDaemonServiceState,
        listDaemonOwnedProcesses: vi.fn().mockResolvedValue([]),
        stopDaemonProcess: vi.fn().mockResolvedValue(true),
        waitForSystemServiceToStop: vi.fn().mockResolvedValue(true),
        uninstallDaemon: vi.fn().mockResolvedValue({
          removed: false,
        }),
      }
    );

    expect(cleanupLegacySharedDaemonServiceState).toHaveBeenCalledTimes(1);
    expect(result.removed).toBe(true);
  });
});
