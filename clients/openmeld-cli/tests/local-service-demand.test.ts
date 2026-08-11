import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearDaemonServiceRuntimeStateMock,
  createLocalAdapterEntriesMock,
  emitDaemonLifecycleEventMock,
  getDaemonStatusMock,
  getEffectiveDaemonRuntimeStatusMock,
  hasActiveDaemonOwnersMock,
  loadDaemonRouteCatalogMock,
  readCurrentDaemonOwnerSnapshotMock,
  resolveDaemonRuntimeStateMock,
  resolveDaemonServiceManagerForRuntimeStateMock,
  runDaemonServiceManagerActionMock,
  syncDeviceRuntimeStateProjectionMock,
  waitForDaemonSystemServiceToStopMock,
  withDaemonServiceRegistrationMutationLockMock,
} = vi.hoisted(() => ({
  clearDaemonServiceRuntimeStateMock: vi.fn(),
  createLocalAdapterEntriesMock: vi.fn(),
  emitDaemonLifecycleEventMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  getEffectiveDaemonRuntimeStatusMock: vi.fn(),
  hasActiveDaemonOwnersMock: vi.fn(),
  loadDaemonRouteCatalogMock: vi.fn(),
  readCurrentDaemonOwnerSnapshotMock: vi.fn(),
  resolveDaemonRuntimeStateMock: vi.fn(),
  resolveDaemonServiceManagerForRuntimeStateMock: vi.fn(),
  runDaemonServiceManagerActionMock: vi.fn(
    async (input: { run: () => Promise<unknown> }) => await input.run()
  ),
  syncDeviceRuntimeStateProjectionMock: vi.fn(),
  waitForDaemonSystemServiceToStopMock: vi.fn(),
  withDaemonServiceRegistrationMutationLockMock: vi.fn(
    async (callback: () => Promise<unknown>) => await callback()
  ),
}));

vi.mock("../src/config/daemon-state", () => ({
  clearDaemonServiceRuntimeState: clearDaemonServiceRuntimeStateMock,
  getDaemonStatus: getDaemonStatusMock,
  withDaemonServiceRegistrationMutationLock:
    withDaemonServiceRegistrationMutationLockMock,
}));

vi.mock("@openmeld/local-service", async () => {
  const actual = await vi.importActual<
    typeof import("@openmeld/local-service")
  >("@openmeld/local-service");
  return {
    ...actual,
    createLocalAdapterEntries: createLocalAdapterEntriesMock,
  };
});

vi.mock("../src/local-service/routing/route-catalog", () => ({
  loadDaemonRouteCatalog: loadDaemonRouteCatalogMock,
}));

vi.mock("../src/local-service/reporting/device-runtime-state-sync", () => ({
  NO_LOCAL_AGENTS_NEED_OPENMELD_SERVICE_REASON:
    "No local agents on this device need OpenMeld Service right now",
  syncDeviceRuntimeStateProjection: syncDeviceRuntimeStateProjectionMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-lifecycle-journal", () => ({
  emitDaemonLifecycleEvent: emitDaemonLifecycleEventMock,
  runDaemonServiceManagerAction: runDaemonServiceManagerActionMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-owner-snapshot", () => ({
  hasActiveDaemonOwners: hasActiveDaemonOwnersMock,
  readCurrentDaemonOwnerSnapshot: readCurrentDaemonOwnerSnapshotMock,
  summarizeDaemonOwnerSnapshot: vi.fn(() => ({
    ownerSetSummary: "single_owner",
  })),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => ({
  getEffectiveDaemonRuntimeStatus: getEffectiveDaemonRuntimeStatusMock,
  resolveDaemonRuntimeState: resolveDaemonRuntimeStateMock,
  resolveDaemonServiceManagerForRuntimeState:
    resolveDaemonServiceManagerForRuntimeStateMock,
  waitForDaemonSystemServiceToStop: waitForDaemonSystemServiceToStopMock,
}));

import {
  formatLocalServiceAutoStoppedMessage,
  maybeAutoStopIdleLocalService,
  resolveLocalServiceDemand,
} from "../src/local-service/lifecycle/local-service-demand";

describe("local service demand", () => {
  beforeEach(() => {
    clearDaemonServiceRuntimeStateMock.mockReset().mockResolvedValue(undefined);
    createLocalAdapterEntriesMock.mockReset().mockReturnValue([
      {
        adapter: {},
        adapterId: "local-cli",
        transportModes: ["local-cli"],
      },
    ]);
    getDaemonStatusMock.mockReset().mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.0.1",
        installSource: "test",
        installedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
      },
    });
    getEffectiveDaemonRuntimeStatusMock.mockReset().mockReturnValue("running");
    emitDaemonLifecycleEventMock.mockReset().mockResolvedValue(undefined);
    hasActiveDaemonOwnersMock.mockReset().mockReturnValue(false);
    loadDaemonRouteCatalogMock.mockReset().mockResolvedValue({
      profileIds: ["agt-codex"],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    });
    readCurrentDaemonOwnerSnapshotMock.mockReset().mockResolvedValue({
      runtimeStatus: {
        status: "running",
        mode: "background",
        pid: 42,
        startedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      },
      serviceManager: {
        controller: "launchd",
      },
      serviceManagerStatus: {
        installed: true,
        enabled: true,
        running: true,
      },
      ownedProcesses: [],
      effectiveRuntimeStatus: "running",
      systemServiceRegistrationPresent: true,
      activeOwnerKinds: ["system_service"],
      ownerSetSummary: "single_owner",
      mustStopManagerFirst: true,
    });
    resolveDaemonRuntimeStateMock.mockReset().mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 42,
      startedAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    });
    resolveDaemonServiceManagerForRuntimeStateMock
      .mockReset()
      .mockResolvedValue({
        serviceManager: {
          controller: "launchd",
          install: vi.fn(),
          uninstall: vi.fn(),
          start: vi.fn(),
          status: vi.fn().mockResolvedValue({
            installed: true,
            enabled: true,
            running: false,
          }),
          stop: vi.fn().mockResolvedValue(undefined),
        },
        serviceManagerStatus: {
          installed: true,
          enabled: true,
          running: true,
        },
      });
    syncDeviceRuntimeStateProjectionMock.mockReset().mockResolvedValue({
      status: "ok",
      mode: "check",
      projectedControllerIds: ["codex"],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "local projection is healthy",
    });
    runDaemonServiceManagerActionMock
      .mockReset()
      .mockImplementation(
        async (input: { run: () => Promise<unknown> }) => await input.run()
      );
    waitForDaemonSystemServiceToStopMock.mockReset().mockResolvedValue(true);
  });

  it("keeps service running when at least one local execution route exists", async () => {
    const result = await resolveLocalServiceDemand({
      ownerUserId: "owner-1",
    });

    expect(result).toMatchObject({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      localExecutionRouteCount: 1,
    });
    expect(loadDaemonRouteCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowEmpty: true,
        ownerUserId: "owner-1",
        quiet: true,
      })
    );
  });

  it("uses the route catalog already accepted by the running service", async () => {
    const routeCatalog = {
      profileIds: ["agt-codex", "agt-openclaw"],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    };

    const result = await resolveLocalServiceDemand({
      ownerUserId: "owner-1",
      routeCatalog,
    });

    expect(result).toMatchObject({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      localExecutionRouteCount: 2,
    });
    expect(loadDaemonRouteCatalogMock).not.toHaveBeenCalled();
  });

  it("uses a provided projection instead of syncing it again", async () => {
    const projection = {
      status: "ok" as const,
      mode: "check" as const,
      projectedControllerIds: ["codex"],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "projection was already checked for this status read",
    };

    const result = await resolveLocalServiceDemand({
      ownerUserId: null,
      projection,
    });

    expect(syncDeviceRuntimeStateProjectionMock).not.toHaveBeenCalled();
    expect(result.projection).toBe(projection);
    expect(result.reason).toBe("owner user is unavailable");
  });

  it("allows auto-stop when there are no local execution routes left", async () => {
    loadDaemonRouteCatalogMock.mockResolvedValue({
      profileIds: [],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    });
    syncDeviceRuntimeStateProjectionMock.mockResolvedValue({
      status: "ok",
      mode: "check",
      projectedControllerIds: [],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "No local agents on this device need OpenMeld Service right now",
    });

    const result = await resolveLocalServiceDemand({
      ownerUserId: "owner-1",
    });

    expect(result).toMatchObject({
      decision: "allow_auto_stop",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      localExecutionRouteCount: 0,
    });
    expect(result.reason).toBe(
      "No local agents on this device need OpenMeld Service right now"
    );
    expect(formatLocalServiceAutoStoppedMessage(result)).toContain(
      "no projected local agent controllers"
    );
  });

  it("stays indeterminate when owner user is unavailable", async () => {
    const result = await resolveLocalServiceDemand({});

    expect(result).toEqual(
      expect.objectContaining({
        decision: "indeterminate",
        reason: "owner user is unavailable",
      })
    );
    expect(loadDaemonRouteCatalogMock).not.toHaveBeenCalled();
  });

  it("does not keep running for workspace.invalid without another repairable route", async () => {
    loadDaemonRouteCatalogMock.mockResolvedValue({
      profileIds: [],
      routeByProfileId: new Map(),
      skippedProfiles: [
        {
          profileId: "agt-codex",
          profileName: "Codex",
          skipReason: "workspace.invalid",
        },
      ],
    });

    const result = await resolveLocalServiceDemand({
      ownerUserId: "owner-1",
    });

    expect(result).toMatchObject({
      decision: "allow_auto_stop",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      localExecutionRouteCount: 0,
    });
  });

  it("auto-stops only the running system-managed background service", async () => {
    loadDaemonRouteCatalogMock.mockResolvedValue({
      profileIds: [],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    });
    syncDeviceRuntimeStateProjectionMock.mockResolvedValue({
      status: "ok",
      mode: "check",
      projectedControllerIds: [],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "No local agents on this device need OpenMeld Service right now",
    });
    const presenter = {
      view: "human" as const,
      event: vi.fn(),
      line: vi.fn(),
      data: vi.fn(),
    };

    const result = await maybeAutoStopIdleLocalService({
      codePrefix: "daemon.status.service",
      ownerUserId: "owner-1",
      presenter,
    });

    expect(result.autoStopped).toBe(true);
    expect(waitForDaemonSystemServiceToStopMock).toHaveBeenCalledTimes(1);
    expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "daemon.status.service.auto_stopped",
      })
    );
  });

  it("does not auto-stop foreground or non-system runtimes", async () => {
    loadDaemonRouteCatalogMock.mockResolvedValue({
      profileIds: [],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    });
    resolveDaemonRuntimeStateMock.mockResolvedValue({
      status: "running",
      mode: "foreground",
      pid: 77,
      startedAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "legacy-detached",
      autoStart: false,
    });
    const presenter = {
      view: "human" as const,
      event: vi.fn(),
      line: vi.fn(),
      data: vi.fn(),
    };

    const result = await maybeAutoStopIdleLocalService({
      codePrefix: "daemon.status.service",
      ownerUserId: "owner-1",
      presenter,
    });

    expect(result.autoStopped).toBe(false);
    expect(waitForDaemonSystemServiceToStopMock).not.toHaveBeenCalled();
    expect(clearDaemonServiceRuntimeStateMock).not.toHaveBeenCalled();
    expect(presenter.line).not.toHaveBeenCalled();
  });
});
