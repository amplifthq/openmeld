import { afterEach, describe, expect, it, vi } from "vitest";
import { stopManagedCurrentLaneDaemonService } from "../src/commands/service-stop-command";
import type { DaemonServiceRuntimeStatus } from "../src/config/daemon-state";
import { LocalDaemonControlPlaneClientError } from "../src/local-service/control-plane/client";
import type { DaemonServiceManager } from "../src/local-service/lifecycle/daemon-service-manager";
import type { DaemonOwnerSnapshot } from "../src/local-service/lifecycle/daemon-service-owner-snapshot";
import type { RuntimeContext } from "../src/runtime/types";
import { withTempHome } from "./helpers/fs";

const { requestLocalDaemonShutdownMock } = vi.hoisted(() => ({
  requestLocalDaemonShutdownMock: vi.fn(),
}));

vi.mock(
  "../src/local-service/control-plane/client",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/control-plane/client")
    >()),
    requestLocalDaemonShutdown: requestLocalDaemonShutdownMock,
  })
);

const runtime = {
  interactive: false,
  resolvedView: "agent",
  viewMode: "agent",
} satisfies RuntimeContext;

describe("managed OpenMeld Service stop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops a crash-looping manager when the daemon control socket is absent", async () => {
    await withTempHome(async () => {
      const calls: string[] = [];
      const managerStatus = {
        commandSummary: "openmeld service run",
        controller: "launchd" as const,
        definitionPath: "/tmp/com.openmeld.test.plist",
        enabled: true,
        installed: true,
        running: true,
      };
      const serviceManager = createServiceManager(managerStatus, calls);
      const runtimeStatus: DaemonServiceRuntimeStatus = {
        autoStart: true,
        managedBySystemService: true,
        mode: null,
        pid: null,
        serviceController: "launchd",
        startedAt: null,
        status: "stale",
        updatedAt: null,
      };
      const ownerSnapshot: DaemonOwnerSnapshot = {
        activeOwnerKinds: ["system_service"],
        effectiveRuntimeStatus: "stale",
        mustStopManagerFirst: true,
        ownedProcesses: [],
        ownerSetSummary: "single_owner",
        runtimeStatus,
        serviceManager,
        serviceManagerStatus: { ...managerStatus },
        systemServiceRegistrationPresent: true,
      };
      requestLocalDaemonShutdownMock.mockRejectedValueOnce(
        new LocalDaemonControlPlaneClientError(
          "daemon.control.endpoint_missing",
          "connect ENOENT /tmp/openmeld-daemon-control.sock"
        )
      );

      await expect(
        stopManagedCurrentLaneDaemonService({
          mode: "best_effort",
          ownerSnapshot,
          runtime,
        })
      ).resolves.toMatchObject({ status: "stopped", signal: "system" });

      expect(calls).toEqual(["disableAutostart", "stop", "status"]);
    });
  });

  it("keeps fail-closed drain behavior when a Service process is still active", async () => {
    await withTempHome(async () => {
      const calls: string[] = [];
      const managerStatus = {
        commandSummary: "openmeld service run",
        controller: "launchd" as const,
        definitionPath: "/tmp/com.openmeld.test.plist",
        enabled: true,
        installed: true,
        running: true,
      };
      const serviceManager = createServiceManager(managerStatus, calls);
      const ownerSnapshot: DaemonOwnerSnapshot = {
        activeOwnerKinds: ["system_service"],
        effectiveRuntimeStatus: "running",
        mustStopManagerFirst: true,
        ownedProcesses: [
          {
            command: "openmeld service run --mode foreground",
            mode: "foreground",
            ownership: "stable_launcher",
            parentPid: 1,
            pid: 2468,
          },
        ],
        ownerSetSummary: "single_owner",
        runtimeStatus: {
          autoStart: true,
          managedBySystemService: true,
          mode: "foreground",
          pid: 2468,
          serviceController: "launchd",
          startedAt: "2026-08-29T00:00:00.000Z",
          status: "running",
          updatedAt: "2026-08-29T00:00:01.000Z",
        },
        serviceManager,
        serviceManagerStatus: { ...managerStatus },
        systemServiceRegistrationPresent: true,
      };
      requestLocalDaemonShutdownMock.mockRejectedValueOnce(
        new LocalDaemonControlPlaneClientError(
          "daemon.control.endpoint_missing",
          "connect ENOENT /tmp/openmeld-daemon-control.sock"
        )
      );

      await expect(
        stopManagedCurrentLaneDaemonService({
          mode: "best_effort",
          ownerSnapshot,
          runtime,
        })
      ).resolves.toMatchObject({
        reason: "stop_failed",
        status: "warning",
      });

      expect(calls).toEqual(["disableAutostart", "enableAutostart"]);
    });
  });
});

function createServiceManager(
  status: {
    commandSummary: string;
    controller: "launchd";
    definitionPath: string;
    enabled: boolean;
    installed: boolean;
    running: boolean;
  },
  calls: string[]
): DaemonServiceManager {
  const record = (call: string): Promise<void> => {
    calls.push(call);
    return Promise.resolve();
  };

  return {
    controller: "launchd",
    deactivate: () => record("deactivate"),
    disableAutostart: () => {
      calls.push("disableAutostart");
      status.enabled = false;
      return Promise.resolve();
    },
    enableAutostart: () => {
      calls.push("enableAutostart");
      status.enabled = true;
      return Promise.resolve();
    },
    install: () => record("install"),
    start: () => {
      calls.push("start");
      status.enabled = true;
      status.running = true;
      return Promise.resolve();
    },
    status: () => {
      calls.push("status");
      return Promise.resolve({ ...status });
    },
    stop: () => {
      calls.push("stop");
      status.enabled = false;
      status.running = false;
      return Promise.resolve();
    },
    uninstall: () => record("uninstall"),
    waitUntilAbsent: () => record("waitUntilAbsent"),
    waitUntilRunning: () => record("waitUntilRunning"),
    waitUntilStopped: () => record("waitUntilStopped"),
  };
}
