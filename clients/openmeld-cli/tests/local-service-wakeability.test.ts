import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DaemonInstallState,
  DaemonServiceRuntimeStatus,
  DaemonStatus,
} from "../src/config/daemon-state";
import { resolveCurrentDaemonExpectedVersion } from "../src/local-service/lifecycle/current-daemon-version";
import type { DaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";

const {
  getEffectiveDaemonRuntimeStatusMock,
  inspectDaemonServiceInventoryMock,
  resolveLocalServiceDemandMock,
  resolveDaemonRuntimeStateMock,
  resolveDaemonServiceManagerForRuntimeStateMock,
  resolveGatewayChainReadinessMock,
  syncDeviceRuntimeStateProjectionMock,
} = vi.hoisted(() => ({
  getEffectiveDaemonRuntimeStatusMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  resolveLocalServiceDemandMock: vi.fn(),
  resolveDaemonRuntimeStateMock: vi.fn(),
  resolveDaemonServiceManagerForRuntimeStateMock: vi.fn(),
  resolveGatewayChainReadinessMock: vi.fn(),
  syncDeviceRuntimeStateProjectionMock: vi.fn(),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-inventory")
  >("../src/local-service/lifecycle/daemon-service-inventory");
  return {
    ...actual,
    inspectDaemonServiceInventory: inspectDaemonServiceInventoryMock,
  };
});

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  resolveLocalServiceDemand: resolveLocalServiceDemandMock,
}));

vi.mock(
  "../src/local-service/reporting/device-runtime-state-sync",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/reporting/device-runtime-state-sync")
    >("../src/local-service/reporting/device-runtime-state-sync");
    return {
      ...actual,
      syncDeviceRuntimeStateProjection: syncDeviceRuntimeStateProjectionMock,
    };
  }
);

vi.mock("../src/system/gateway-chain-readiness", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/gateway-chain-readiness")
  >("../src/system/gateway-chain-readiness");
  return {
    ...actual,
    resolveGatewayChainReadiness: resolveGatewayChainReadinessMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", () => ({
  getEffectiveDaemonRuntimeStatus: getEffectiveDaemonRuntimeStatusMock,
  resolveDaemonRuntimeState: resolveDaemonRuntimeStateMock,
  resolveDaemonServiceManagerForRuntimeState:
    resolveDaemonServiceManagerForRuntimeStateMock,
}));

import { resolveDeviceReplyReadinessStatus } from "../src/system/reply-readiness";

function createInstalledStatus(): DaemonStatus {
  const state: DaemonInstallState = {
    v: 1,
    schema: "openmeld-daemon-install-v1",
    daemonVersion: "0.2.2",
    installSource: "daemon.command.install",
    installedAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  };
  return {
    installed: true,
    state,
  };
}

function createNotRunningRuntimeStatus(): DaemonServiceRuntimeStatus {
  return {
    status: "not_running",
    mode: null,
    pid: null,
    startedAt: null,
    updatedAt: null,
    managedBySystemService: false,
    serviceController: "unknown",
    autoStart: false,
  };
}

function createRunningRuntimeStatus(): DaemonServiceRuntimeStatus {
  return {
    status: "running",
    mode: "background",
    pid: 111,
    startedAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    managedBySystemService: true,
    serviceController: "launchd",
    autoStart: true,
  };
}

function createInventory(
  status: DaemonStatus,
  runtimeStatus: DaemonServiceRuntimeStatus
): DaemonServiceInventory {
  return {
    expectedVersion: "0.2.2",
    installStatus: status,
    runtimeStatus,
    legacySharedService: null,
    activeBundle: null,
    activeBundleSourceAvailable: null,
    activeBundleEntryPath: null,
    runtimeCommandEntryPath: null,
    runtimeCommandPathExists: null,
    serviceManager: null,
    serviceManagerStatus: {
      installed: false,
      running: false,
      enabled: false,
      commandSummary: null,
      definitionPath: null,
    },
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [
      {
        code: "service_manager_path_drift",
        message:
          "The OS service manager is still pointing at an old CLI path instead of the OpenMeld-managed stable launcher.",
      },
    ],
  };
}

function withVerifiedExecutionEvidence(
  inventory: DaemonServiceInventory
): DaemonServiceInventory {
  return {
    ...inventory,
    activeBundleEntryPath:
      "/Users/felix/.openmeld-dev/runtime/daemon/bundles/current/dist/openmeld.js",
    runtimeCommandEntryPath:
      "/Users/felix/.openmeld-dev/runtime/daemon/bundles/current/dist/openmeld.js",
    runtimeCommandPathExists: true,
    runtimeContractCompatibility: {
      expectedEpoch: "daemon-runtime-epoch-test",
      observedEpoch: "daemon-runtime-epoch-test",
      reasonCode: "daemon.runtime_contract.compatible",
      status: "compatible",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
    serviceContract: {
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "dev-local",
      daemonVersion: inventory.expectedVersion,
      bundleId: "daemon-bundle-test",
      desiredState: "background",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "http://localhost:8080",
      profileId: "human-profile-test",
      deviceId: "device-test",
      heartbeatMs: 30_000,
      generation: 1,
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
  };
}

describe("reply readiness", () => {
  beforeEach(() => {
    resolveLocalServiceDemandMock.mockReset().mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are registered on this device",
      localExecutionRouteCount: 0,
      projection: null,
    });
    getEffectiveDaemonRuntimeStatusMock
      .mockReset()
      .mockReturnValue("not_running");
    inspectDaemonServiceInventoryMock.mockReset();
    resolveDaemonRuntimeStateMock.mockReset();
    resolveDaemonServiceManagerForRuntimeStateMock.mockReset();
    resolveGatewayChainReadinessMock.mockReset();
    syncDeviceRuntimeStateProjectionMock.mockReset().mockResolvedValue(null);
  });

  it("prioritizes runtime not-running over artifact drift in device readiness", async () => {
    const status = createInstalledStatus();
    const runtimeStatus = createNotRunningRuntimeStatus();
    resolveDaemonRuntimeStateMock.mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      status,
      runtimeProjection: null,
      inventory: createInventory(status, runtimeStatus),
    });

    expect(readiness.reasonCodes).toEqual(["service.not_running"]);
    expect(readiness.reasonText).toBe(
      "Connect OpenMeld Service on this device before this agent can reply."
    );
    expect(readiness.replyReadiness).toBe("blocked");
    expect(resolveDaemonRuntimeStateMock).not.toHaveBeenCalled();
  });

  it("passes an explicit null runtime projection without syncing again", async () => {
    const status = createInstalledStatus();
    const runtimeStatus = createRunningRuntimeStatus();
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");

    await resolveDeviceReplyReadinessStatus({
      status,
      runtimeStatus,
      runtimeProjection: null,
      inventory: withVerifiedExecutionEvidence(
        createInventory(status, runtimeStatus)
      ),
    });

    expect(syncDeviceRuntimeStateProjectionMock).not.toHaveBeenCalled();
    expect(resolveLocalServiceDemandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projection: null,
      })
    );
  });

  it("treats runtime bundle mismatch as service drift when runtime is healthy", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");

    const readiness = await resolveDeviceReplyReadinessStatus({
      status,
      runtimeStatus,
      runtimeProjection: null,
      inventory: {
        ...createInventory(status, runtimeStatus),
        anomalies: [
          {
            code: "runtime_bundle_mismatch",
            message:
              "OpenMeld Service runtime state still points at a bundle entry file that no longer exists.",
          },
        ],
      },
    });

    expect(readiness.reasonCodes).toContain("service.drifted");
    expect(readiness.replyReadiness).toBe("blocked");
  });

  it("treats runtime contract mismatch as service drift when runtime is healthy", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");

    const readiness = await resolveDeviceReplyReadinessStatus({
      status,
      runtimeStatus,
      runtimeProjection: null,
      inventory: {
        ...createInventory(status, runtimeStatus),
        anomalies: [
          {
            code: "runtime_contract_mismatch",
            message:
              "OpenMeld Service runtime contract epoch does not match the current CLI.",
          },
        ],
      },
    });

    expect(readiness.reasonCodes).toContain("service.drifted");
    expect(readiness.replyReadiness).toBe("blocked");
  });

  it("does not block wakeability for bundle content drift when execution evidence is verified", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local wakeable routes are registered on this device",
      localExecutionRouteCount: 2,
      projection: null,
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      status,
      runtimeStatus,
      runtimeProjection: null,
      inventory: withVerifiedExecutionEvidence({
        ...createInventory(status, runtimeStatus),
        anomalies: [
          {
            code: "bundle_content_drift",
            message:
              "OpenMeld Service is using older local service files than this lane expects, so OpenMeld needs to update the service.",
          },
        ],
      }),
    });

    expect(readiness.reasonCodes).toEqual([]);
    expect(readiness.replyReadiness).toBe("ready");
    expect(readiness.reasonText).toBe(
      "This device is ready for Space replies from local agent profiles"
    );
  });

  it("does not block wakeability for advisory service drift when execution evidence is verified", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local wakeable routes are registered on this device",
      localExecutionRouteCount: 2,
      projection: null,
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      status,
      runtimeStatus,
      runtimeProjection: null,
      inventory: withVerifiedExecutionEvidence({
        ...createInventory(status, runtimeStatus),
        anomalies: [
          {
            code: "bundle_id_drift",
            message:
              "The active OpenMeld Service bundle id differs from the installed service contract.",
          },
          {
            code: "bundle_version_drift",
            message:
              "The active OpenMeld Service bundle version differs from the current CLI.",
          },
          {
            code: "service_manager_path_drift",
            message:
              "The OS service manager is still pointing at an old CLI path.",
          },
        ],
      }),
    });

    expect(readiness.reasonCodes).toEqual([]);
    expect(readiness.replyReadiness).toBe("ready");
  });

  it("treats multiple active service owners as service drift even when execution evidence is otherwise verified", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");

    const readiness = await resolveDeviceReplyReadinessStatus({
      status,
      runtimeStatus,
      runtimeProjection: null,
      inventory: withVerifiedExecutionEvidence({
        ...createInventory(status, runtimeStatus),
        anomalies: [
          {
            code: "multiple_active_owners",
            message:
              "OpenMeld found multiple active service owners for this lane, so the current runtime owner cannot be trusted.",
          },
        ],
      }),
    });

    expect(readiness.reasonCodes).toContain("service.drifted");
    expect(readiness.replyReadiness).toBe("blocked");
  });

  it("does not block wakeability for bundle content drift without treating it as a breaking change", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local wakeable routes are registered on this device",
      localExecutionRouteCount: 1,
      projection: null,
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      status,
      runtimeStatus,
      runtimeProjection: null,
      inventory: {
        ...createInventory(status, runtimeStatus),
        anomalies: [
          {
            code: "bundle_content_drift",
            message:
              "OpenMeld Service is using older local service files than this lane expects, so OpenMeld needs to update the service.",
          },
        ],
      },
    });

    expect(readiness.reasonCodes).toEqual([]);
    expect(readiness.replyReadiness).toBe("ready");
  });

  it("does not block wakeability when runtime contract metadata is missing without a mismatch", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local wakeable routes are registered on this device",
      localExecutionRouteCount: 1,
      projection: null,
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      status,
      runtimeStatus,
      runtimeProjection: null,
      inventory: withVerifiedExecutionEvidence({
        ...createInventory(status, runtimeStatus),
        runtimeContractCompatibility: {
          expectedEpoch: "daemon-runtime-epoch-test",
          observedEpoch: null,
          reasonCode: "daemon.runtime_contract.missing",
          status: "missing",
          updatedAt: null,
        },
        anomalies: [
          {
            code: "runtime_contract_missing",
            message:
              "OpenMeld Service runtime contract metadata is missing for the active daemon.",
          },
        ],
      }),
    });

    expect(readiness.reasonCodes).toEqual([]);
    expect(readiness.replyReadiness).toBe("ready");
  });

  it("treats gateway chain failures as blocked even when runtime is healthy", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local wakeable routes are registered on this device",
      localExecutionRouteCount: 2,
      projection: null,
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      checkGatewayChain: true,
      gatewayChainReadiness: {
        applicable: true,
        baseUrl: "http://localhost:8080",
        checkedAt: "2026-03-10T00:00:00.000Z",
        details:
          'HTTP 502: upstream_unreachable: Cannot access "resolveRequestAuth" as we couldn\'t find a local dev session.',
        errorCode: "upstream_unreachable",
        errorMessage:
          'Cannot access "resolveRequestAuth" as we couldn\'t find a local dev session.',
        failureKind: "local_dev_session_missing",
        ready: false,
        status: 502,
        summary:
          "OpenMeld gateway can't reach the local OpenMeld auth worker session.",
      },
      inventory: {
        ...createInventory(status, runtimeStatus),
        anomalies: [],
      },
      runtimeProjection: null,
      runtimeStatus,
      status,
    });

    expect(readiness.reasonCodes).toEqual(["service.gateway_chain_unhealthy"]);
    expect(readiness.reasonText).toBe(
      "OpenMeld gateway can't reach the local OpenMeld auth worker session."
    );
    expect(readiness.replyReadiness).toBe("blocked");
  });

  it("maps dispatch storage gate failures to a dedicated readiness reason", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local wakeable routes are registered on this device",
      localExecutionRouteCount: 2,
      projection: null,
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      checkGatewayChain: true,
      gatewayChainReadiness: {
        applicable: true,
        baseUrl: "http://localhost:8080",
        checkedAt: "2026-03-10T00:00:00.000Z",
        details:
          "HTTP 503: upstream_unreachable: Core dispatch storage is not ready: Shared OPENMELD_DB migration is missing required index openMeldDaemon_dispatch_ledger_idempotency_key_unique.",
        errorCode: "upstream_unreachable",
        errorMessage:
          "Core dispatch storage is not ready: Shared OPENMELD_DB migration is missing required index openMeldDaemon_dispatch_ledger_idempotency_key_unique.",
        failureKind: "dispatch_storage_not_ready",
        ready: false,
        status: 503,
        summary: "Core dispatch storage is not ready for wake execution yet.",
      },
      inventory: {
        ...createInventory(status, runtimeStatus),
        anomalies: [],
      },
      runtimeProjection: null,
      runtimeStatus,
      status,
    });

    expect(readiness.reasonCodes).toEqual(["dispatch.storage_not_ready"]);
    expect(readiness.reasonText).toBe(
      "Core dispatch storage is not ready for wake execution yet."
    );
    expect(readiness.replyReadiness).toBe("blocked");
  });

  it("checks gateway chain with the selected profile id when full profile resolution is unavailable", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "indeterminate",
      hasLocalExecutionRoute: false,
      reason: "owner user is unavailable",
      localExecutionRouteCount: 0,
      projection: null,
    });
    resolveGatewayChainReadinessMock.mockResolvedValue({
      applicable: true,
      baseUrl: "http://localhost:8080",
      checkedAt: "2026-03-10T00:00:00.000Z",
      details: "HTTP 502: upstream_unreachable: local session missing",
      errorCode: "upstream_unreachable",
      errorMessage: "local session missing",
      failureKind: "local_dev_session_missing",
      ready: false,
      status: 502,
      summary:
        "OpenMeld gateway can't reach the local OpenMeld auth worker session.",
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      baseUrl: "http://localhost:8080",
      checkGatewayChain: true,
      gatewayChainProfile: {
        openMeldProfileId: "human-selected-profile",
      },
      inventory: {
        ...createInventory(status, runtimeStatus),
        anomalies: [],
      },
      runtimeProjection: null,
      runtimeStatus,
      status,
    });

    expect(resolveGatewayChainReadinessMock).toHaveBeenCalledWith({
      baseUrl: "http://localhost:8080",
      profile: {
        openMeldProfileId: "human-selected-profile",
        profileName: undefined,
      },
    });
    expect(readiness.reasonCodes).toEqual(["service.gateway_chain_unhealthy"]);
    expect(readiness.reasonText).toBe(
      "OpenMeld gateway can't reach the local OpenMeld auth worker session."
    );
  });

  it("treats zero projected local controllers as unknown instead of blocked", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "No local agents on this device need OpenMeld Service right now",
      localExecutionRouteCount: 0,
      projection: {
        status: "ok",
        mode: "check",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairRequiredControllerIds: [],
        repairedControllerIds: [],
        reason:
          "No local agents on this device need OpenMeld Service right now",
      },
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      inventory: {
        ...createInventory(status, runtimeStatus),
        anomalies: [],
      },
      runtimeProjection: {
        status: "ok",
        mode: "check",
        projectedControllerIds: [],
        missingControllerIds: [],
        disabledControllerIds: [],
        repairRequiredControllerIds: [],
        repairedControllerIds: [],
        reason:
          "No local agents on this device need OpenMeld Service right now",
      },
      runtimeStatus,
      status,
    });

    expect(readiness.reasonCodes).toEqual(["local_agents.none_needed"]);
    expect(readiness.reasonText).toBe(
      "No local agents on this device need OpenMeld Service right now"
    );
    expect(readiness.replyReadiness).toBe("unknown");
  });

  it("uses shared availability copy for disabled local agents", async () => {
    const status = createInstalledStatus();
    const runtimeStatus = createRunningRuntimeStatus();
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");

    const readiness = await resolveDeviceReplyReadinessStatus({
      inventory: withVerifiedExecutionEvidence(
        createInventory(status, runtimeStatus)
      ),
      runtimeProjection: {
        disabledControllerIds: ["codex"],
        missingControllerIds: [],
        mode: "check",
        projectedControllerIds: ["codex"],
        reason: "Codex is turned off",
        repairRequiredControllerIds: [],
        repairedControllerIds: [],
        status: "degraded",
      },
      runtimeStatus,
      status,
    });

    expect(readiness.reasonCodes).toEqual(["controller.registry.disabled"]);
    expect(readiness.reasonText).toBe(
      "This local agent is turned off in OpenMeld on this device. Turn it on before this profile can reply."
    );
  });

  it("uses shared recovery copy for local agents that need repair", async () => {
    const status = createInstalledStatus();
    const runtimeStatus = createRunningRuntimeStatus();
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");

    const readiness = await resolveDeviceReplyReadinessStatus({
      inventory: withVerifiedExecutionEvidence(
        createInventory(status, runtimeStatus)
      ),
      runtimeProjection: {
        disabledControllerIds: [],
        missingControllerIds: [],
        mode: "check",
        projectedControllerIds: ["codex"],
        reason: "Codex needs repair",
        repairRequiredControllerIds: ["codex"],
        repairedControllerIds: [],
        status: "degraded",
      },
      runtimeStatus,
      status,
    });

    expect(readiness.reasonCodes).toEqual(["controller.launch.needs_repair"]);
    expect(readiness.reasonText).toBe(
      "A local agent could not start on this device. Repair it on this device, then try again."
    );
  });

  it("uses shared availability copy when route setup has no diagnostic text", async () => {
    const status = createInstalledStatus();
    const runtimeStatus = createRunningRuntimeStatus();
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      localExecutionRouteCount: 0,
      projection: null,
      reason: "",
      repairableReplyCandidateCount: 0,
    });

    const readiness = await resolveDeviceReplyReadinessStatus({
      inventory: withVerifiedExecutionEvidence(
        createInventory(status, runtimeStatus)
      ),
      runtimeProjection: null,
      runtimeStatus,
      status,
    });

    expect(readiness.reasonCodes).toEqual(["route.not_registered"]);
    expect(readiness.reasonText).toBe("Checking this agent's Wake route.");
  });

  it("uses the current CLI local service version for reply readiness inventory checks", async () => {
    const status = createInstalledStatus();
    const runtimeStatus: DaemonServiceRuntimeStatus = {
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    };

    if (!status.state) {
      throw new Error("expected installed daemon state");
    }
    status.state.daemonVersion = "0.0.1";
    getEffectiveDaemonRuntimeStatusMock.mockReturnValue("running");
    inspectDaemonServiceInventoryMock.mockResolvedValue({
      ...createInventory(status, runtimeStatus),
      anomalies: [],
    });

    await resolveDeviceReplyReadinessStatus({ status });

    expect(inspectDaemonServiceInventoryMock).toHaveBeenCalledWith({
      expectedVersion: resolveCurrentDaemonExpectedVersion(),
      intent: "status_cleanup",
    });
  });
});
