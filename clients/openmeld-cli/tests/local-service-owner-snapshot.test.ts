import { describe, expect, it } from "vitest";
import {
  buildDaemonOwnerSnapshot,
  resolveDaemonStopStrategy,
  resolveStoppedContractWriteBlockedReason,
} from "../src/local-service/lifecycle/daemon-service-owner-snapshot";

describe("local service owner snapshot", () => {
  const baseContext = {
    status: {
      installed: true as const,
      state: {
        v: 1 as const,
        schema: "openmeld-daemon-install-v1" as const,
        daemonVersion: "1.0.0",
        installSource: "daemon.command.install" as const,
        installedAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z",
      },
    },
    serviceManager: null,
    serviceManagerStatus: null,
    legacySharedService: null,
  };

  it("classifies a direct CLI runtime as a single cli_direct owner", () => {
    const snapshot = buildDaemonOwnerSnapshot({
      context: {
        ...baseContext,
        effectiveRuntimeStatus: "running",
        runtimeStatus: {
          status: "running",
          mode: "foreground",
          pid: 101,
          startedAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
      },
      ownedProcesses: [
        {
          pid: 101,
          parentPid: 100,
          command: "openmeld service run --mode foreground",
          mode: "foreground",
          ownership: "cli_direct",
        },
      ],
    });

    expect(snapshot.activeOwnerKinds).toEqual(["cli_direct"]);
    expect(snapshot.ownerSetSummary).toBe("single_owner");
    expect(resolveDaemonStopStrategy(snapshot)).toMatchObject({
      kind: "process_only",
    });
  });

  it("stops the direct process before manager cleanup when only registration remains", () => {
    const snapshot = buildDaemonOwnerSnapshot({
      context: {
        ...baseContext,
        effectiveRuntimeStatus: "running",
        serviceManager: {
          controller: "launchd",
          install: async () => undefined,
          uninstall: async () => undefined,
          enableAutostart: async () => undefined,
          disableAutostart: async () => undefined,
          start: async () => undefined,
          stop: async () => undefined,
          deactivate: async () => undefined,
          status: async () => ({
            installed: true,
            running: false,
            enabled: true,
          }),
          waitUntilAbsent: async () => undefined,
          waitUntilStopped: async () => undefined,
          waitUntilRunning: async () => undefined,
        },
        serviceManagerStatus: {
          installed: true,
          running: false,
          enabled: true,
        },
        runtimeStatus: {
          status: "running",
          mode: "foreground",
          pid: 151,
          startedAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
      },
      ownedProcesses: [
        {
          pid: 151,
          parentPid: 150,
          command: "openmeld service run --mode foreground",
          mode: "foreground",
          ownership: "cli_direct",
        },
      ],
    });

    expect(snapshot.activeOwnerKinds).toEqual(["cli_direct"]);
    expect(snapshot.ownerSetSummary).toBe("single_owner");
    expect(resolveDaemonStopStrategy(snapshot)).toMatchObject({
      kind: "process_then_manager_cleanup",
    });
  });

  it("explains stopped-contract writes blocked by enabled service manager state", () => {
    const snapshot = buildDaemonOwnerSnapshot({
      context: {
        ...baseContext,
        effectiveRuntimeStatus: "not_running",
        serviceManager: {
          controller: "launchd",
          install: async () => undefined,
          uninstall: async () => undefined,
          enableAutostart: async () => undefined,
          disableAutostart: async () => undefined,
          start: async () => undefined,
          stop: async () => undefined,
          deactivate: async () => undefined,
          status: async () => ({
            installed: true,
            running: false,
            enabled: true,
          }),
          waitUntilAbsent: async () => undefined,
          waitUntilStopped: async () => undefined,
          waitUntilRunning: async () => undefined,
        },
        serviceManagerStatus: {
          installed: true,
          running: false,
          enabled: true,
        },
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "launchd",
          autoStart: true,
        },
      },
      ownedProcesses: [],
    });

    expect(resolveStoppedContractWriteBlockedReason(snapshot)).toBe(
      "service_manager_still_enabled"
    );
  });

  it("explains stopped-contract writes blocked by residual local service processes", () => {
    const snapshot = buildDaemonOwnerSnapshot({
      context: {
        ...baseContext,
        effectiveRuntimeStatus: "not_running",
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
      },
      ownedProcesses: [
        {
          pid: 301,
          parentPid: 1,
          command: "openmeld service run --mode background",
          mode: "background",
          ownership: "cli_direct",
        },
      ],
    });

    expect(resolveStoppedContractWriteBlockedReason(snapshot)).toBe(
      "owned_processes_still_active"
    );
  });

  it("classifies a system-managed local service as a single system_service owner", () => {
    const snapshot = buildDaemonOwnerSnapshot({
      context: {
        ...baseContext,
        effectiveRuntimeStatus: "running",
        serviceManager: {
          controller: "launchd",
          install: async () => undefined,
          uninstall: async () => undefined,
          enableAutostart: async () => undefined,
          disableAutostart: async () => undefined,
          start: async () => undefined,
          stop: async () => undefined,
          deactivate: async () => undefined,
          status: async () => ({
            installed: true,
            running: true,
            enabled: true,
          }),
          waitUntilAbsent: async () => undefined,
          waitUntilStopped: async () => undefined,
          waitUntilRunning: async () => undefined,
        },
        serviceManagerStatus: {
          installed: true,
          running: true,
          enabled: true,
        },
        runtimeStatus: {
          status: "running",
          mode: "background",
          pid: 201,
          startedAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        },
      },
      ownedProcesses: [
        {
          pid: 201,
          parentPid: 1,
          command: "daemon-service-launcher.mjs service run --mode background",
          mode: "background",
          ownership: "stable_launcher",
        },
      ],
    });

    expect(snapshot.activeOwnerKinds).toEqual(["system_service"]);
    expect(snapshot.ownerSetSummary).toBe("single_owner");
    expect(resolveDaemonStopStrategy(snapshot)).toMatchObject({
      kind: "manager_first",
    });
  });

  it("detects multiple owners when system_service and cli_direct are both active", () => {
    const snapshot = buildDaemonOwnerSnapshot({
      context: {
        ...baseContext,
        effectiveRuntimeStatus: "running",
        serviceManager: {
          controller: "launchd",
          install: async () => undefined,
          uninstall: async () => undefined,
          enableAutostart: async () => undefined,
          disableAutostart: async () => undefined,
          start: async () => undefined,
          stop: async () => undefined,
          deactivate: async () => undefined,
          status: async () => ({
            installed: true,
            running: true,
            enabled: true,
          }),
          waitUntilAbsent: async () => undefined,
          waitUntilStopped: async () => undefined,
          waitUntilRunning: async () => undefined,
        },
        serviceManagerStatus: {
          installed: true,
          running: true,
          enabled: true,
        },
        runtimeStatus: {
          status: "running",
          mode: "background",
          pid: 301,
          startedAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
      },
      ownedProcesses: [
        {
          pid: 301,
          parentPid: 1,
          command: "daemon-service-launcher.mjs service run --mode background",
          mode: "background",
          ownership: "stable_launcher",
        },
        {
          pid: 302,
          parentPid: 300,
          command: "openmeld service run --mode foreground",
          mode: "foreground",
          ownership: "cli_direct",
        },
      ],
    });

    expect(snapshot.activeOwnerKinds).toEqual(["cli_direct", "system_service"]);
    expect(snapshot.ownerSetSummary).toBe("multiple_owners");
    expect(resolveDaemonStopStrategy(snapshot)).toMatchObject({
      kind: "manager_first",
    });
  });

  it("classifies a legacy detached runtime separately", () => {
    const snapshot = buildDaemonOwnerSnapshot({
      context: {
        ...baseContext,
        effectiveRuntimeStatus: "running",
        runtimeStatus: {
          status: "running",
          mode: "background",
          pid: 401,
          startedAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "legacy-detached",
          autoStart: false,
        },
      },
      ownedProcesses: [
        {
          pid: 401,
          parentPid: 1,
          command: "openmeld service run legacy-detached",
          mode: "background",
          ownership: "legacy_detached",
        },
      ],
    });

    expect(snapshot.activeOwnerKinds).toEqual(["legacy_detached"]);
    expect(snapshot.ownerSetSummary).toBe("single_owner");
    expect(resolveDaemonStopStrategy(snapshot)).toMatchObject({
      kind: "process_only",
    });
  });

  it("reports not_running when no active owner remains", () => {
    const snapshot = buildDaemonOwnerSnapshot({
      context: {
        ...baseContext,
        effectiveRuntimeStatus: "not_running",
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
      },
      ownedProcesses: [],
    });

    expect(snapshot.activeOwnerKinds).toEqual([]);
    expect(snapshot.ownerSetSummary).toBe("no_owner");
    expect(resolveDaemonStopStrategy(snapshot)).toMatchObject({
      kind: "not_running",
    });
  });
});
