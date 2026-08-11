import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";

const {
  fetchDaemonRouteObservationMock,
  getDaemonStatusMock,
  inspectDaemonServiceInventoryMock,
  resolveOpenClawLocalDiagnosticsMock,
  resolveAgentReplyReadinessStatusMock,
  resolveAgentProfilePrimaryAgentControllerReportMock,
  resolveLocalServiceDemandMock,
  resolveProfileWorkspaceRuntimeMock,
  resolveDaemonRuntimeStateMock,
  resolveDaemonServiceManagerForRuntimeStateMock,
  resolveDeviceReplyReadinessStatusMock,
  resolveGatewayChainReadinessMock,
  readDaemonRouteCatalogCacheMock,
  syncDeviceRuntimeStateProjectionMock,
} = vi.hoisted(() => ({
  fetchDaemonRouteObservationMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  resolveOpenClawLocalDiagnosticsMock: vi.fn(),
  resolveAgentReplyReadinessStatusMock: vi.fn(),
  resolveAgentProfilePrimaryAgentControllerReportMock: vi.fn(),
  resolveLocalServiceDemandMock: vi.fn(),
  resolveProfileWorkspaceRuntimeMock: vi.fn(),
  resolveDaemonRuntimeStateMock: vi.fn(),
  resolveDaemonServiceManagerForRuntimeStateMock: vi.fn(),
  resolveDeviceReplyReadinessStatusMock: vi.fn(),
  resolveGatewayChainReadinessMock: vi.fn(),
  readDaemonRouteCatalogCacheMock: vi.fn(),
  syncDeviceRuntimeStateProjectionMock: vi.fn(),
}));

vi.mock("../src/config/daemon-route-observation-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-route-observation-api")
  >("../src/config/daemon-route-observation-api");
  return {
    ...actual,
    fetchDaemonRouteObservation: (
      ...args: Parameters<typeof fetchDaemonRouteObservationMock>
    ) => fetchDaemonRouteObservationMock(...args),
  };
});

vi.mock("../src/config/daemon-state", () => ({
  getDaemonStatus: (...args: Parameters<typeof getDaemonStatusMock>) =>
    getDaemonStatusMock(...args),
}));

vi.mock("../src/local-service/lifecycle/current-daemon-version", () => ({
  resolveCurrentDaemonExpectedVersion: () => "1.0.0",
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: (
    ...args: Parameters<typeof inspectDaemonServiceInventoryMock>
  ) => inspectDaemonServiceInventoryMock(...args),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => ({
  resolveDaemonRuntimeState: (
    ...args: Parameters<typeof resolveDaemonRuntimeStateMock>
  ) => resolveDaemonRuntimeStateMock(...args),
  resolveDaemonServiceManagerForRuntimeState: (
    ...args: Parameters<typeof resolveDaemonServiceManagerForRuntimeStateMock>
  ) => resolveDaemonServiceManagerForRuntimeStateMock(...args),
}));

vi.mock("../src/local-service/reporting/device-runtime-state-sync", () => ({
  syncDeviceRuntimeStateProjection: (
    ...args: Parameters<typeof syncDeviceRuntimeStateProjectionMock>
  ) => syncDeviceRuntimeStateProjectionMock(...args),
}));

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  resolveLocalServiceDemand: (
    ...args: Parameters<typeof resolveLocalServiceDemandMock>
  ) => resolveLocalServiceDemandMock(...args),
}));

vi.mock("../src/local-service/state/route-catalog-cache", () => ({
  readDaemonRouteCatalogCache: (
    ...args: Parameters<typeof readDaemonRouteCatalogCacheMock>
  ) => readDaemonRouteCatalogCacheMock(...args),
}));

vi.mock("../src/system/gateway-chain-readiness", () => ({
  resolveGatewayChainReadiness: (
    ...args: Parameters<typeof resolveGatewayChainReadinessMock>
  ) => resolveGatewayChainReadinessMock(...args),
}));

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport:
    resolveAgentProfilePrimaryAgentControllerReportMock,
}));

vi.mock("../src/provider-hosts/openclaw/diagnostics", async () => {
  const actual = await vi.importActual<
    typeof import("../src/provider-hosts/openclaw/diagnostics")
  >("../src/provider-hosts/openclaw/diagnostics");
  return {
    ...actual,
    resolveOpenClawLocalDiagnostics: (
      ...args: Parameters<typeof resolveOpenClawLocalDiagnosticsMock>
    ) => resolveOpenClawLocalDiagnosticsMock(...args),
  };
});

vi.mock("../src/profile-workspace/runtime-resolution", async () => {
  const actual = await vi.importActual<
    typeof import("../src/profile-workspace/runtime-resolution")
  >("../src/profile-workspace/runtime-resolution");
  return {
    ...actual,
    resolveProfileWorkspaceRuntime: (
      ...args: Parameters<typeof resolveProfileWorkspaceRuntimeMock>
    ) => resolveProfileWorkspaceRuntimeMock(...args),
  };
});

vi.mock("../src/system/reply-readiness", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/reply-readiness")
  >("../src/system/reply-readiness");
  return {
    ...actual,
    resolveAgentReplyReadinessStatus: (
      ...args: Parameters<typeof resolveAgentReplyReadinessStatusMock>
    ) => resolveAgentReplyReadinessStatusMock(...args),
    resolveDeviceReplyReadinessStatus: (
      ...args: Parameters<typeof resolveDeviceReplyReadinessStatusMock>
    ) => resolveDeviceReplyReadinessStatusMock(...args),
  };
});

import { DaemonRouteObservationFetchError } from "../src/config/daemon-route-observation-api";
import {
  type CurrentReplyReadinessLocalServiceObservation,
  resolveCurrentReplyReadinessSnapshot,
} from "../src/system/current-reply-readiness-snapshot";

function createDeviceReadiness(
  overrides: Partial<{
    reasonCodes: string[];
    reasonText: string;
    replyReadiness: "blocked" | "degraded" | "ready" | "unknown";
    updatedAt: string;
    wakeableRouteCount: number;
  }> = {}
) {
  return {
    reasonCodes: [],
    reasonText:
      "This device is ready for Space replies from local agent profiles",
    replyReadiness: "ready" as const,
    updatedAt: "2026-03-24T00:00:00.000Z",
    wakeableRouteCount: 1,
    ...overrides,
  };
}

function createAgentReadiness(
  overrides: Partial<{
    deviceReplyReadiness: ReturnType<typeof createDeviceReadiness>;
    profileId: string;
    reasonCodes: string[];
    reasonText: string;
    replyReadiness: "blocked" | "degraded" | "ready" | "unknown";
    transportMode: string | null;
    updatedAt: string;
  }> = {}
) {
  return {
    deviceReplyReadiness: createDeviceReadiness(),
    profileId: "agt-openclaw",
    reasonCodes: [],
    reasonText: "This profile can reply from Space when mentioned",
    replyReadiness: "ready" as const,
    transportMode: "local-cli",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides,
  };
}

function createReadyWorkspaceResolution(
  workspacePath = "/tmp/openclaw-workspace"
) {
  return {
    configPath: "/tmp/local-meta.json",
    configuredWorkspacePath: workspacePath,
    effectiveRuntimeWorkingDirectory: workspacePath,
    runtimeContext: {
      providerRuntimeWorkingDirectory: workspacePath,
    },
    status: "ready" as const,
    workspaceMode: "custom" as const,
  };
}

describe("current reply readiness snapshot", () => {
  beforeEach(() => {
    fetchDaemonRouteObservationMock.mockReset().mockResolvedValue({
      observedAt: "2026-03-24T00:00:10.000Z",
      profileId: "agt-openclaw",
      route: {
        online: false,
        reasonCode: "daemon.profile.offline",
      },
    });
    getDaemonStatusMock.mockReset().mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "1.0.0",
        installSource: "daemon.command.install",
        installedAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    });
    inspectDaemonServiceInventoryMock.mockReset().mockResolvedValue(null);
    resolveAgentReplyReadinessStatusMock.mockReset().mockResolvedValue(null);
    resolveAgentProfilePrimaryAgentControllerReportMock
      .mockReset()
      .mockImplementation(({ profile }) => {
        const capabilityId = String(profile?.openMeldProfileId ?? "").includes(
          "openclaw"
        )
          ? "openclaw"
          : "codex";
        return Promise.resolve({
          bindingState: "enabled_primary",
          capabilityId,
          capabilityKind: "builtin",
          agentControllerRef: `builtin:${capabilityId}`,
          localAgentId: capabilityId,
          reasonCodes: ["agent_profile_binding.enabled_primary"],
          routable: true,
        });
      });
    resolveProfileWorkspaceRuntimeMock
      .mockReset()
      .mockResolvedValue(createReadyWorkspaceResolution());
    resolveDaemonRuntimeStateMock.mockReset().mockResolvedValue({
      status: "running",
      pid: 1,
      mode: "background",
      startedAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "unknown",
    });
    resolveDaemonServiceManagerForRuntimeStateMock
      .mockReset()
      .mockResolvedValue({
        legacySharedService: null,
        serviceManager: null,
        serviceManagerStatus: null,
      });
    resolveLocalServiceDemandMock.mockReset().mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
      projection: null,
    });
    resolveDeviceReplyReadinessStatusMock.mockReset();
    resolveGatewayChainReadinessMock.mockReset().mockResolvedValue({
      applicable: true,
      details: "ok",
      failureKind: null,
      ready: true,
      summary: "Gateway auth chain is available",
    });
    resolveOpenClawLocalDiagnosticsMock.mockReset();
    readDaemonRouteCatalogCacheMock.mockReset().mockResolvedValue(null);
    syncDeviceRuntimeStateProjectionMock.mockReset().mockResolvedValue(null);
  });

  it("uses a provided runtime projection instead of syncing it again", async () => {
    const runtimeProjection = {
      status: "ok" as const,
      mode: "check" as const,
      projectedControllerIds: ["codex"],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "projection was already checked for this command",
    };
    const readiness = createDeviceReadiness();
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(readiness);

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      runtimeProjection,
    });

    expect(syncDeviceRuntimeStateProjectionMock).not.toHaveBeenCalled();
    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeProjection,
      })
    );
    expect(snapshot.runtimeProjection).toBe(runtimeProjection);
  });

  it("uses the active service route catalog instead of refetching it for status", async () => {
    const cachedRouteCatalog = {
      profileIds: ["agt-codex"],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    };
    readDaemonRouteCatalogCacheMock.mockResolvedValueOnce(cachedRouteCatalog);
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(
      createDeviceReadiness()
    );
    const localServiceObservation = createLocalServiceObservation();

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      localServiceObservation,
      ownerUserId: "user-1",
      preferActiveServiceRouteCatalog: true,
    });

    expect(readDaemonRouteCatalogCacheMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        serviceBundleId: "bundle-1",
      })
    );
    expect(syncDeviceRuntimeStateProjectionMock).not.toHaveBeenCalled();
    expect(snapshot.runtimeProjection).toMatchObject({
      status: "skipped",
      reason: "active service route catalog already exists",
    });
    expect(resolveLocalServiceDemandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        routeCatalog: cachedRouteCatalog,
      })
    );
  });

  it("passes online Core Wake route evidence into agent reply readiness", async () => {
    const codexProfile = createAgentProfile("codex");
    const localBlocked = createDeviceReadiness({
      reasonCodes: ["service.not_running"],
      reasonText: "OpenMeld Service is reconnecting on this device",
      replyReadiness: "degraded",
      wakeableRouteCount: 0,
    });
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(localBlocked);
    fetchDaemonRouteObservationMock.mockResolvedValueOnce({
      observedAt: "2026-03-24T00:00:10.000Z",
      profileId: codexProfile.openMeldProfileId,
      route: {
        online: true,
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "prod",
        connectionGeneration: 1,
        leaseEpoch: 1,
        lastHeartbeatMs: 1,
        capabilities: {},
      },
    });
    resolveAgentReplyReadinessStatusMock.mockResolvedValueOnce(
      createAgentReadiness({
        deviceReplyReadiness: localBlocked,
        profileId: codexProfile.openMeldProfileId,
      })
    );

    await resolveCurrentReplyReadinessSnapshot({
      includeDaemonRouteObservation: true,
      profile: codexProfile,
    });

    expect(resolveAgentReplyReadinessStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coreWakeRouteOnline: true,
        deviceReplyReadiness: localBlocked,
        openClawLocalDiagnostics: null,
        profile: codexProfile,
        profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(),
      })
    );
  });

  it("starts independent Core status reads while local readiness is still resolving", async () => {
    const codexProfile = createAgentProfile("codex");
    let resolveLocalDemand: (value: unknown) => void = () => undefined;
    resolveLocalServiceDemandMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLocalDemand = resolve;
      })
    );
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(
      createDeviceReadiness()
    );
    resolveAgentReplyReadinessStatusMock.mockResolvedValueOnce(
      createAgentReadiness({ profileId: codexProfile.openMeldProfileId })
    );

    const snapshotPromise = resolveCurrentReplyReadinessSnapshot({
      includeDaemonRouteObservation: true,
      profile: codexProfile,
    });

    await vi.waitFor(() => {
      expect(fetchDaemonRouteObservationMock).toHaveBeenCalledTimes(1);
      expect(
        resolveAgentProfilePrimaryAgentControllerReportMock
      ).toHaveBeenCalledTimes(1);
    });
    resolveLocalDemand({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
      projection: null,
    });

    await snapshotPromise;
  });

  it("skips the gateway chain probe when local service state is not installed", async () => {
    getDaemonStatusMock.mockResolvedValueOnce({
      installed: false,
      state: null,
    });
    const blocked = createDeviceReadiness({
      reasonCodes: ["service.not_installed"],
      reasonText: "OpenMeld Service is not installed on this device",
      replyReadiness: "blocked",
      wakeableRouteCount: 0,
    });
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(blocked);

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      checkGatewayChain: true,
    });

    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledTimes(1);
    expect(resolveGatewayChainReadinessMock).not.toHaveBeenCalled();
    expect(snapshot.gatewayChainReadiness).toBeNull();
    expect(snapshot.deviceReplyReadiness).toEqual(blocked);
  });

  it("skips the gateway chain probe when local service state is not running", async () => {
    const blocked = createDeviceReadiness({
      reasonCodes: ["service.not_running"],
      reasonText: "OpenMeld Service is reconnecting on this device",
      replyReadiness: "degraded",
      wakeableRouteCount: 0,
    });
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(blocked);

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      checkGatewayChain: true,
    });

    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledTimes(1);
    expect(resolveGatewayChainReadinessMock).not.toHaveBeenCalled();
    expect(snapshot.gatewayChainReadiness).toBeNull();
    expect(snapshot.deviceReplyReadiness).toEqual(blocked);
  });

  it("skips gateway chain diagnostics when a wakeable local route is already ready", async () => {
    const localReady = createDeviceReadiness();
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(localReady);

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      checkGatewayChain: true,
    });

    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledTimes(1);
    expect(resolveGatewayChainReadinessMock).not.toHaveBeenCalled();
    expect(snapshot.gatewayChainReadiness).toBeNull();
    expect(snapshot.deviceReplyReadiness).toEqual(localReady);
  });

  it("records gateway chain diagnostics when local reply readiness is not ready yet", async () => {
    const localBlocked = createDeviceReadiness({
      reasonCodes: ["route.not_registered"],
      reasonText: "OpenMeld is still setting up replies on this device",
      replyReadiness: "blocked",
      wakeableRouteCount: 0,
    });
    const gatewayReadiness = {
      applicable: true,
      details: "ok",
      failureKind: null,
      ready: true,
      summary: "Gateway auth chain is available",
    };
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(localBlocked);
    resolveGatewayChainReadinessMock.mockResolvedValueOnce(gatewayReadiness);

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      checkGatewayChain: true,
    });

    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledTimes(1);
    expect(resolveGatewayChainReadinessMock).toHaveBeenCalledTimes(1);
    expect(snapshot.gatewayChainReadiness).toEqual(gatewayReadiness);
    expect(snapshot.deviceReplyReadiness).toEqual(localBlocked);
  });

  it("forwards a bounded gateway chain timeout to the diagnostics probe", async () => {
    const localBlocked = createDeviceReadiness({
      reasonCodes: ["route.not_registered"],
      reasonText: "OpenMeld is still setting up replies on this device",
      replyReadiness: "blocked",
      wakeableRouteCount: 0,
    });
    const gatewayReadiness = {
      applicable: true,
      details: "ok",
      failureKind: null,
      ready: true,
      summary: "Gateway auth chain is available",
    };
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(localBlocked);
    resolveGatewayChainReadinessMock.mockResolvedValueOnce(gatewayReadiness);

    await resolveCurrentReplyReadinessSnapshot({
      checkGatewayChain: true,
      gatewayChainProfile: {
        openMeldProfileId: "agt-codex",
        profileName: "Codex",
      },
      gatewayChainTimeoutMs: 5000,
    });

    expect(resolveGatewayChainReadinessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 5000,
      })
    );
    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a wakeable local route ready when the gateway chain probe times out", async () => {
    const localReady = createDeviceReadiness({
      reasonText:
        "This device is ready for Space replies from local agent profiles",
      replyReadiness: "ready",
      wakeableRouteCount: 1,
    });
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(localReady);

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      checkGatewayChain: true,
    });

    expect(resolveGatewayChainReadinessMock).not.toHaveBeenCalled();
    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledTimes(1);
    expect(snapshot.gatewayChainReadiness).toBeNull();
    expect(snapshot.deviceReplyReadiness).toEqual(localReady);
  });

  it("reuses local demand across local and gateway readiness checks", async () => {
    const localDemand = {
      decision: "keep_running" as const,
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
      projection: null,
    };
    const localReady = createDeviceReadiness();
    const finalReady = localReady;
    resolveLocalServiceDemandMock.mockResolvedValueOnce(localDemand);
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(localReady);
    resolveGatewayChainReadinessMock.mockResolvedValueOnce({
      applicable: true,
      details: "ok",
      failureKind: null,
      ready: true,
      summary: "Gateway auth chain is available",
    });

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      checkGatewayChain: true,
    });

    expect(resolveLocalServiceDemandMock).toHaveBeenCalledTimes(1);
    expect(resolveGatewayChainReadinessMock).not.toHaveBeenCalled();
    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        localDemand,
      })
    );
    expect(snapshot.deviceReplyReadiness).toEqual(finalReady);
  });

  it("keeps daemon route observation diagnostic-only when the server sees its daemon route offline", async () => {
    const profile = createAgentProfile("codex");
    const deviceReadiness = createDeviceReadiness();
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(deviceReadiness);
    resolveAgentReplyReadinessStatusMock.mockResolvedValue(
      createAgentReadiness({
        deviceReplyReadiness: deviceReadiness,
        profileId: profile.openMeldProfileId,
      })
    );
    fetchDaemonRouteObservationMock.mockResolvedValueOnce({
      observedAt: "2026-03-24T00:00:10.000Z",
      profileId: profile.openMeldProfileId,
      route: {
        online: false,
        reasonCode: "daemon.profile.offline",
      },
    });

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      includeDaemonRouteObservation: true,
      profile,
    });

    expect(snapshot.daemonRouteObservation).toEqual({
      detail:
        "Server can't currently see an active reply route for this agent profile (server reported daemon.profile.offline).",
      observedAt: "2026-03-24T00:00:10.000Z",
      profileId: profile.openMeldProfileId,
      reasonCode: "route.not_registered",
      route: {
        online: false,
        reasonCode: "daemon.profile.offline",
      },
      status: "offline",
    });
    expect(snapshot.agentReplyReadiness).toMatchObject({
      reasonCodes: [],
      replyReadiness: "ready",
    });
    expect(snapshot.agentReplyReadiness?.reasonText).not.toContain(
      "Server can't currently see an active reply route"
    );
  });

  it("does not request server daemon route truth unless diagnostics ask for it", async () => {
    const openClawProfile = createAgentProfile("openclaw");
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(
      createDeviceReadiness()
    );

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      profile: openClawProfile,
    });

    expect(fetchDaemonRouteObservationMock).not.toHaveBeenCalled();
    expect(snapshot.daemonRouteObservation).toEqual({
      detail: "OpenMeld did not ask for reply route status.",
      observedAt: expect.any(String),
      profileId: openClawProfile.openMeldProfileId,
      reasonCode: "not_requested",
      route: null,
      status: "unavailable",
    });
  });

  it("captures server daemon route truth for agent profiles", async () => {
    const openClawProfile = createAgentProfile("openclaw");
    const localReady = createDeviceReadiness();
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(localReady);
    resolveAgentReplyReadinessStatusMock.mockResolvedValue(null);
    fetchDaemonRouteObservationMock.mockResolvedValueOnce({
      observedAt: "2026-03-24T00:00:11.000Z",
      profileId: openClawProfile.openMeldProfileId,
      route: {
        online: true,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        connectionGeneration: 3,
        leaseEpoch: 5,
        lastHeartbeatMs: 2500,
        capabilities: {},
      },
    });

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      includeDaemonRouteObservation: true,
      profile: openClawProfile,
    });

    expect(fetchDaemonRouteObservationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: undefined,
        profileId: openClawProfile.openMeldProfileId,
        requestContext: {
          actorContext: expect.objectContaining({
            requestId: expect.any(String),
            openMeldProfileId: openClawProfile.openMeldProfileId,
            profileKind: "agent",
            profileName: openClawProfile.profileName,
            profileHandle: openClawProfile.profileHandle,
            ownerUserId: openClawProfile.ownerUserId,
          }),
        },
      })
    );
    expect(snapshot.daemonRouteObservation).toEqual({
      detail: null,
      observedAt: "2026-03-24T00:00:11.000Z",
      profileId: openClawProfile.openMeldProfileId,
      reasonCode: "online",
      route: {
        online: true,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        connectionGeneration: 3,
        leaseEpoch: 5,
        lastHeartbeatMs: 2500,
        capabilities: {},
      },
      status: "online",
    });
  });

  it("marks daemon route observation unavailable when no agent profile is selected", async () => {
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(
      createDeviceReadiness()
    );

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      includeDaemonRouteObservation: true,
    });

    expect(fetchDaemonRouteObservationMock).not.toHaveBeenCalled();
    expect(snapshot.daemonRouteObservation).toEqual({
      detail: "Choose an Agent Profile to check reply route status.",
      observedAt: expect.any(String),
      profileId: null,
      reasonCode: "profile_not_selected",
      route: null,
      status: "unavailable",
    });
  });

  it("uses the shared unavailable copy when the selected profile is human", async () => {
    const humanProfile = {
      ...createAgentProfile("openclaw"),
      profileKind: "human" as const,
    };
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(
      createDeviceReadiness()
    );

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      includeDaemonRouteObservation: true,
      profile: humanProfile,
    });

    expect(fetchDaemonRouteObservationMock).not.toHaveBeenCalled();
    expect(snapshot.daemonRouteObservation).toEqual({
      detail: "Only agent profiles have a reply route.",
      observedAt: expect.any(String),
      profileId: humanProfile.openMeldProfileId,
      reasonCode: "profile_not_agent",
      route: null,
      status: "unavailable",
    });
  });

  it("marks daemon route observation as server unsupported when the OpenMeld server does not expose it yet", async () => {
    const openClawProfile = createAgentProfile("openclaw");
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(
      createDeviceReadiness()
    );
    fetchDaemonRouteObservationMock.mockRejectedValueOnce(
      new DaemonRouteObservationFetchError({
        code: "server_unsupported",
        message: "HTTP 404: 404 Not Found",
        status: 404,
      })
    );

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      includeDaemonRouteObservation: true,
      profile: openClawProfile,
    });

    expect(snapshot.daemonRouteObservation).toEqual({
      detail: "This OpenMeld server can't report route status yet.",
      observedAt: expect.any(String),
      profileId: openClawProfile.openMeldProfileId,
      reasonCode: "server_unsupported",
      route: null,
      status: "unavailable",
    });
  });

  it("preserves lookup_failed diagnostics while keeping the shared unavailable copy", async () => {
    const openClawProfile = createAgentProfile("openclaw");
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(
      createDeviceReadiness()
    );
    fetchDaemonRouteObservationMock.mockRejectedValueOnce(
      new Error("gateway timeout while fetching daemon route")
    );

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      includeDaemonRouteObservation: true,
      profile: openClawProfile,
    });

    expect(snapshot.daemonRouteObservation).toEqual({
      detail:
        "OpenMeld couldn't confirm reply route status yet. Raw lookup error: gateway timeout while fetching daemon route",
      observedAt: expect.any(String),
      profileId: openClawProfile.openMeldProfileId,
      reasonCode: "lookup_failed",
      route: null,
      status: "unavailable",
    });
  });

  it("runs OpenClaw diagnostics in inspect mode for OpenClaw agent profiles", async () => {
    const openClawProfile = createAgentProfile("openclaw");
    const localReady = createDeviceReadiness();
    const openClawDiagnostics = {
      agentId: "openmeld-openclaw-phase-one",
      authStatus: "present" as const,
      bootstrapResolution: null,
      bootstrapStatus: "healthy" as const,
      errorCode: null,
      gatewayHealth: "healthy" as const,
      gatewayVisibility: "visible" as const,
      message: null,
      workspaceDir: "/tmp/openmeld-openclaw-profile",
    };
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(localReady);
    resolveOpenClawLocalDiagnosticsMock.mockResolvedValue(openClawDiagnostics);
    resolveAgentReplyReadinessStatusMock.mockResolvedValue({
      deviceReplyReadiness: localReady,
      profileId: openClawProfile.openMeldProfileId,
      reasonCodes: [],
      reasonText: "This profile can reply from Space when mentioned",
      replyReadiness: "ready",
      transportMode: "local-cli",
      updatedAt: "2026-03-24T00:00:00.000Z",
    });

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      openClawDiagnosticsMode: "inspect",
      profile: openClawProfile,
    });

    expect(resolveProfileWorkspaceRuntimeMock).toHaveBeenCalledWith({
      openMeldProfileId: openClawProfile.openMeldProfileId,
      mode: "inspect",
    });
    expect(resolveOpenClawLocalDiagnosticsMock).toHaveBeenCalledWith({
      mode: "inspect",
      profile: openClawProfile,
      providerRuntimeWorkingDirectory: "/tmp/openclaw-workspace",
    });
    expect(snapshot.openClawLocalDiagnostics).toEqual(openClawDiagnostics);
  });

  it("preserves OpenClaw diagnostics failures instead of collapsing them to null", async () => {
    const openClawProfile = createAgentProfile("openclaw");
    const localReady = createDeviceReadiness();
    const diagnosticsError = Object.assign(
      new Error("OpenClaw diagnostics probe failed"),
      {
        code: "openclaw.gateway.probe_failed",
      }
    );
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(localReady);
    resolveOpenClawLocalDiagnosticsMock.mockRejectedValue(diagnosticsError);
    resolveAgentReplyReadinessStatusMock.mockResolvedValue({
      deviceReplyReadiness: localReady,
      profileId: openClawProfile.openMeldProfileId,
      reasonCodes: ["controller.gateway.unhealthy"],
      reasonText: "OpenClaw diagnostics probe failed",
      replyReadiness: "blocked",
      transportMode: "local-cli",
      updatedAt: "2026-03-24T00:00:00.000Z",
    });

    const snapshot = await resolveCurrentReplyReadinessSnapshot({
      openClawDiagnosticsMode: "inspect",
      profile: openClawProfile,
    });

    expect(snapshot.openClawLocalDiagnostics).toEqual({
      errorCode: "openclaw.gateway.probe_failed",
      kind: "failed",
      message: "OpenClaw diagnostics probe failed",
    });
    expect(resolveAgentReplyReadinessStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coreWakeRouteOnline: false,
        deviceReplyReadiness: localReady,
        openClawLocalDiagnostics: {
          errorCode: "openclaw.gateway.probe_failed",
          kind: "failed",
          message: "OpenClaw diagnostics probe failed",
        },
        profile: openClawProfile,
        profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(),
      })
    );
  });

  it("runs OpenClaw diagnostics in repair mode only for OpenClaw profiles", async () => {
    const codexProfile = createAgentProfile("codex");
    const openClawProfile = createAgentProfile("openclaw");
    const localReady = createDeviceReadiness();
    resolveDeviceReplyReadinessStatusMock.mockResolvedValue(localReady);
    resolveAgentReplyReadinessStatusMock.mockResolvedValue(null);
    resolveOpenClawLocalDiagnosticsMock.mockResolvedValue({
      agentId: "openmeld-openclaw-phase-one",
      authStatus: "copied",
      bootstrapResolution: "adopted",
      bootstrapStatus: "healthy",
      errorCode: null,
      gatewayHealth: "healthy",
      gatewayVisibility: "visible",
      message: null,
      workspaceDir: "/tmp/openmeld-openclaw-profile",
    });

    const codexSnapshot = await resolveCurrentReplyReadinessSnapshot({
      openClawDiagnosticsMode: "repair",
      profile: codexProfile,
    });

    expect(resolveOpenClawLocalDiagnosticsMock).not.toHaveBeenCalled();
    expect(codexSnapshot.openClawLocalDiagnostics).toBeNull();
    resolveOpenClawLocalDiagnosticsMock.mockClear();

    await resolveCurrentReplyReadinessSnapshot({
      openClawDiagnosticsMode: "repair",
      profile: openClawProfile,
    });

    expect(resolveOpenClawLocalDiagnosticsMock).toHaveBeenCalledWith({
      mode: "repair",
      profile: openClawProfile,
      providerRuntimeWorkingDirectory: "/tmp/openclaw-workspace",
    });
  });

  it("skips OpenClaw diagnostics and passes workspace resolution through when workspace is missing", async () => {
    const openClawProfile = createAgentProfile("openclaw");
    const localBlocked = createDeviceReadiness({
      reasonCodes: ["workspace.missing"],
      reasonText: "This profile is missing its local workspace on this device.",
      replyReadiness: "blocked",
      wakeableRouteCount: 0,
    });
    const workspaceMissingResolution = {
      configPath: "/tmp/local-meta.json",
      reasonCode: "workspace.missing" as const,
      reasonText: "Profile workspace config is missing.",
      status: "missing" as const,
    };
    resolveProfileWorkspaceRuntimeMock.mockResolvedValueOnce(
      workspaceMissingResolution
    );
    resolveDeviceReplyReadinessStatusMock.mockResolvedValueOnce(localBlocked);
    resolveAgentReplyReadinessStatusMock.mockResolvedValueOnce(
      createAgentReadiness({
        deviceReplyReadiness: localBlocked,
        profileId: openClawProfile.openMeldProfileId,
        reasonCodes: ["workspace.missing"],
        reasonText:
          "This profile is missing its local workspace on this device.",
        replyReadiness: "blocked",
      })
    );

    await resolveCurrentReplyReadinessSnapshot({
      openClawDiagnosticsMode: "inspect",
      profile: openClawProfile,
    });

    expect(resolveDeviceReplyReadinessStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: openClawProfile,
        profileWorkspaceRuntimeResolution: workspaceMissingResolution,
      })
    );
    expect(resolveAgentReplyReadinessStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coreWakeRouteOnline: false,
        deviceReplyReadiness: localBlocked,
        openClawLocalDiagnostics: null,
        profile: openClawProfile,
        profileWorkspaceRuntimeResolution: workspaceMissingResolution,
      })
    );
    expect(resolveOpenClawLocalDiagnosticsMock).not.toHaveBeenCalled();
  });
});

function createLocalServiceObservation(): CurrentReplyReadinessLocalServiceObservation {
  return {
    daemonStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "1.0.0",
        installSource: "daemon.command.install",
        installedAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    },
    inventory: {
      activeBundle: {
        bundleId: "bundle-1",
      },
      serviceManager: null,
    } as CurrentReplyReadinessLocalServiceObservation["inventory"],
    runtimeStatus: {
      status: "running",
      pid: 1,
      mode: "background",
      startedAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    },
    serviceManagerStatus: null,
  };
}

function createAgentProfile(agentControllerRef: string): OpenMeldProfile {
  return {
    openMeldProfileId: `agt-${agentControllerRef}`,
    profileName: `Agent ${agentControllerRef}`,
    profileHandle: `agent-${agentControllerRef}`,
    profileKind: "agent",
    status: "active",
    ownerUserId: "user-owner",
    source: "cli_create",
    createdByUserId: "user-owner",
    lastUsedAt: null,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
  };
}
