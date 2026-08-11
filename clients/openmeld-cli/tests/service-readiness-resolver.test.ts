import { describe, expect, it } from "vitest";
import type { DaemonServiceRuntimeStatus } from "../src/config/daemon-state";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "../src/local-service/lifecycle/daemon-service-inventory";
import type { DeviceReplyReadinessStatus } from "../src/system/reply-readiness";
import {
  resolveServiceReadiness,
  resolveServiceReadinessFromServiceStatus,
} from "../src/system/service-readiness-resolver";

function createDeviceReplyReadiness(
  overrides: Partial<DeviceReplyReadinessStatus> = {}
): DeviceReplyReadinessStatus {
  return {
    reasonCodes: [],
    reasonText:
      "This device is ready for Space replies from local agent profiles",
    replyReadiness: "ready",
    updatedAt: "2026-05-06T00:00:00.000Z",
    wakeableRouteCount: 1,
    ...overrides,
  };
}

function createRuntimeStatus(
  overrides: Partial<DaemonServiceRuntimeStatus> = {}
): DaemonServiceRuntimeStatus {
  return {
    status: "running",
    mode: "background",
    pid: 1234,
    startedAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
    managedBySystemService: true,
    serviceController: "unknown",
    autoStart: false,
    ...overrides,
  };
}

function createInventory(
  anomalyCodes: DaemonServiceAnomalyCode[]
): DaemonServiceInventory {
  return {
    expectedVersion: "0.3.49",
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.3.49",
        installSource: "daemon.command.install",
        installedAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T00:00:00.000Z",
      },
    },
    runtimeStatus: createRuntimeStatus(),
    legacySharedService: null,
    activeBundle: null,
    activeBundleSourceAvailable: null,
    activeBundleEntryPath: null,
    runtimeCommandEntryPath: null,
    runtimeCommandPathExists: null,
    serviceManager: null,
    serviceManagerStatus: null,
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: anomalyCodes.map((code) => ({
      code,
      message: code,
    })),
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
      updatedAt: "2026-05-06T00:00:00.000Z",
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
      updatedAt: "2026-05-06T00:00:00.000Z",
    },
  };
}

describe("service readiness resolver", () => {
  it("maps advisory artifact drift to non-blocking update-available guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness(),
      inventory: withVerifiedExecutionEvidence(
        createInventory([
          "bundle_id_drift",
          "bundle_version_drift",
          "service_manager_path_drift",
        ])
      ),
      runtimeStatus: createRuntimeStatus(),
    });

    expect(readiness.state).toBe("update_available");
    expect(readiness.summaryText).toBe("Update OpenMeld Service");
    expect(readiness.detailText).toContain(
      "OpenMeld Service is running, but its local service bundle is not current"
    );
    expect(readiness.nextStepSummary).toBe(
      "Run `openmeld setup` to update OpenMeld Service."
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
    expect(readiness.reasonCodes).toEqual([]);
    expect(readiness.anomalyCodes).toEqual([
      "bundle_id_drift",
      "bundle_version_drift",
      "service_manager_path_drift",
    ]);
  });

  it("maps safe conditional bundle drift to non-blocking update-available guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness(),
      inventory: withVerifiedExecutionEvidence(
        createInventory(["bundle_content_drift"])
      ),
      runtimeStatus: createRuntimeStatus(),
    });

    expect(readiness.state).toBe("update_available");
    expect(readiness.summaryText).toBe("Update OpenMeld Service");
    expect(readiness.detailText).toContain(
      "OpenMeld Service is running, but its local service bundle is not current"
    );
    expect(readiness.reasonCodes).toEqual([]);
    expect(readiness.anomalyCodes).toEqual(["bundle_content_drift"]);
  });

  it("keeps ready service status honest when advisory drift is present", () => {
    const readiness = resolveServiceReadinessFromServiceStatus({
      advisoryAnomalyCodes: ["bundle_content_drift"],
      expectedVersion: "0.3.50",
      installedVersion: "0.3.49",
      kind: "ready",
      runtimeStatus: "running",
    });

    expect(readiness.state).toBe("update_available");
    expect(readiness.summaryText).toBe("Update OpenMeld Service");
    expect(readiness.detailText).toContain(
      "Update OpenMeld Service before this computer receives new local Wake work"
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
    expect(readiness.anomalyCodes).toEqual(["bundle_content_drift"]);
  });

  it("maps multiple active service owners to refresh guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.drifted"],
        reasonText: "OpenMeld Service has multiple active owners",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      inventory: withVerifiedExecutionEvidence(
        createInventory(["multiple_active_owners"])
      ),
      runtimeStatus: createRuntimeStatus(),
    });

    expect(readiness.state).toBe("refresh_needed");
    expect(readiness.reasonCodes).toEqual(["service.drifted"]);
    expect(readiness.anomalyCodes).toEqual(["multiple_active_owners"]);
  });

  it("maps running runtime contract drift to service update-required guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.drifted"],
        reasonText:
          "OpenMeld Service runtime contract compatibility was not confirmed",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      inventory: createInventory(["runtime_contract_mismatch"]),
      runtimeStatus: createRuntimeStatus(),
    });

    expect(readiness.state).toBe("refresh_needed");
    expect(readiness.summaryText).toBe("Update OpenMeld Service");
    expect(readiness.detailText).toBe(
      "OpenMeld Service is running, but this version is not safe for new Wake work. Update OpenMeld Service."
    );
    expect(readiness.detailText).not.toContain("runtime_contract_mismatch");
    expect(readiness.detailText).not.toContain("epoch");
    expect(readiness.nextStepSummary).toBe(
      "Update OpenMeld Service with `openmeld setup`."
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
    expect(readiness.anomalyCodes).toEqual(["runtime_contract_mismatch"]);
  });

  it("maps stopped runtime contract drift to update-before-start guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.drifted"],
        reasonText:
          "OpenMeld Service runtime contract compatibility was not confirmed",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      inventory: createInventory(["runtime_contract_mismatch"]),
      runtimeStatus: createRuntimeStatus({
        mode: null,
        pid: null,
        status: "not_running",
      }),
    });

    expect(readiness.state).toBe("refresh_needed");
    expect(readiness.summaryText).toBe("Update OpenMeld Service");
    expect(readiness.detailText).toBe(
      "OpenMeld Service must be updated before it can start safely."
    );
    expect(readiness.nextStepSummary).toBe(
      "Update OpenMeld Service with `openmeld setup`."
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
    expect(readiness.anomalyCodes).toEqual(["runtime_contract_mismatch"]);
  });

  it("maps not-running service evidence to a start-service next step", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.not_running"],
        reasonText: "OpenMeld Service is not running on this device",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      runtimeStatus: createRuntimeStatus({
        mode: null,
        pid: null,
        status: "not_running",
      }),
    });

    expect(readiness.state).toBe("not_running");
    expect(readiness.summaryText).toBe("Not running");
    expect(readiness.nextStepSummary).toBe(
      "Run `openmeld setup` to reconnect OpenMeld Service."
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
    expect(readiness.runtimeHeadline).toBe("not running");
  });

  it("maps missing service evidence to install then start guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["service.not_installed"],
        reasonText: "OpenMeld Service is not installed on this device",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
    });

    expect(readiness.state).toBe("not_installed");
    expect(readiness.summaryText).toBe("Not installed");
    expect(readiness.nextStepSummary).toBe(
      "Run `openmeld setup` to connect OpenMeld Service."
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
  });

  it("maps ready evidence to no user action", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness(),
      runtimeStatus: createRuntimeStatus(),
    });

    expect(readiness.state).toBe("ready");
    expect(readiness.summaryText).toBe("Running");
    expect(readiness.nextStepSummary).toBeNull();
    expect(readiness.nextSteps).toEqual([]);
    expect(readiness.runtimeHeadline).toBe("running");
  });

  it("maps foreground repair locks to refresh-blocked guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness(),
      inventory: createInventory([
        "runtime_contract_mismatch",
        "background_foreground_conflict",
        "lifecycle_locked",
      ]),
      runtimeStatus: createRuntimeStatus({
        mode: "foreground",
      }),
    });

    expect(readiness.state).toBe("refresh_blocked");
    expect(readiness.summaryText).toBe("Repair paused");
    expect(readiness.nextStepSummary).toBe(
      "Stop the foreground service first, then run `openmeld setup`."
    );
    expect(readiness.detailText).not.toContain("lifecycle action");
    expect(readiness.anomalyCodes).toEqual([
      "runtime_contract_mismatch",
      "background_foreground_conflict",
      "lifecycle_locked",
    ]);
  });

  it("maps lifecycle locks to retry-after-current-task guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness(),
      inventory: createInventory([
        "runtime_contract_mismatch",
        "lifecycle_locked",
      ]),
      runtimeStatus: createRuntimeStatus({
        mode: "background",
      }),
    });

    expect(readiness.state).toBe("refresh_blocked");
    expect(readiness.nextStepSummary).toBe(
      "Try again after the current OpenMeld Service task finishes."
    );
    expect(readiness.detailText).not.toContain("lifecycle action");
  });

  it("maps local launch repair evidence to local repair guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["controller.launch.needs_repair"],
        reasonText:
          "OpenMeld can't start one or more projected local agents on this device until launch repair completes.",
        replyReadiness: "blocked",
        wakeableRouteCount: 0,
      }),
      runtimeStatus: createRuntimeStatus(),
    });

    expect(readiness.state).toBe("local_repair_needed");
    expect(readiness.summaryText).toBe("Needs repair");
    expect(readiness.nextStepSummary).toBe(
      "Run `openmeld doctor --repair`, then retry."
    );
    expect(readiness.nextSteps).toEqual(["openmeld doctor --repair"]);
  });

  it("does not turn a no-local-agents-needed state into a service reinstall", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: ["local_agents.none_needed"],
        reasonText: "No local agents from this device are needed.",
        replyReadiness: "ready",
        wakeableRouteCount: 0,
      }),
    });

    expect(readiness.state).toBe("unknown");
    expect(readiness.summaryText).toBe("Not needed for this action");
    expect(readiness.nextStepSummary).toBe(
      "If you later bring local agents from this device into a space, run `openmeld setup`."
    );
  });

  it("falls back to service status inspection when readiness is unknown", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness({
        reasonCodes: [],
        reasonText:
          "OpenMeld couldn't confirm current reply readiness on this device",
        replyReadiness: "unknown",
        wakeableRouteCount: 0,
      }),
    });

    expect(readiness.state).toBe("unknown");
    expect(readiness.summaryText).toBe("Unknown");
    expect(readiness.nextStepSummary).toBe(
      "Run `openmeld service status` to inspect OpenMeld Service on this device."
    );
    expect(readiness.nextSteps).toEqual(["openmeld service status"]);
  });

  it("maps missing profile context to choose-agent-profile guidance", () => {
    const readiness = resolveServiceReadiness({
      deviceReplyReadiness: createDeviceReplyReadiness(),
      profileRequired: true,
    });

    expect(readiness.state).toBe("profile_required");
    expect(readiness.summaryText).toBe("Choose an Agent Profile");
    expect(readiness.nextStepSummary).toBe(
      "Choose an Agent Profile, then run this command again."
    );
    expect(readiness.nextSteps).toEqual([]);
  });

  it("maps command-entry missing service status to install guidance", () => {
    const readiness = resolveServiceReadinessFromServiceStatus({
      expectedVersion: "0.3.49",
      kind: "missing",
    });

    expect(readiness.state).toBe("not_installed");
    expect(readiness.summaryText).toBe("Not installed");
    expect(readiness.nextStepSummary).toBe(
      "Run `openmeld setup` to connect OpenMeld Service for local Wake work."
    );
  });

  it("maps command-entry CLI version drift to update-available guidance", () => {
    const readiness = resolveServiceReadinessFromServiceStatus({
      expectedVersion: "0.3.51",
      installedVersion: "0.3.49",
      kind: "outdated",
    });

    expect(readiness.state).toBe("update_available");
    expect(readiness.summaryText).toBe("Update OpenMeld Service");
    expect(readiness.detailText).toContain(
      "OpenMeld Service version is older than this CLI"
    );
    expect(readiness.nextStepSummary).toBe(
      "Run `openmeld setup` to update OpenMeld Service."
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
    expect(readiness.anomalyCodes).toEqual(["version_outdated"]);
  });

  it("maps bundle content drift without compatible running evidence to repair guidance", () => {
    const readiness = resolveServiceReadinessFromServiceStatus({
      anomalyCodes: ["bundle_content_drift"],
      detail: "bundle_content_drift",
      expectedVersion: "0.3.49",
      installedVersion: "0.3.49",
      kind: "needs_repair",
      runtimeStatus: "stale",
    });

    expect(readiness.state).toBe("refresh_needed");
    expect(readiness.summaryText).toBe("Needs repair");
    expect(readiness.detailText).toBe(
      "Reconnect OpenMeld Service before this computer can receive local Wake work."
    );
    expect(readiness.nextStepSummary).toBe(
      "OpenMeld Service needs repair. Run `openmeld setup`. If Wake or readiness still looks wrong after setup, run `openmeld service status`."
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
    expect(readiness.anomalyCodes).toEqual(["bundle_content_drift"]);
  });

  it("maps command-entry not-running status to start-only guidance", () => {
    const readiness = resolveServiceReadinessFromServiceStatus({
      expectedVersion: "0.3.49",
      installedVersion: "0.3.49",
      kind: "not_running",
      runtimeStatus: "not_running",
    });

    expect(readiness.state).toBe("not_running");
    expect(readiness.nextStepSummary).toBe(
      "Run `openmeld setup` to reconnect OpenMeld Service for local Wake work."
    );
    expect(readiness.nextSteps).toEqual(["openmeld setup"]);
  });

  it("maps command-entry repair-blocked status to refresh-blocked guidance", () => {
    const readiness = resolveServiceReadinessFromServiceStatus({
      detail: "Lifecycle lock is held",
      kind: "repair_blocked",
    });

    expect(readiness.state).toBe("refresh_blocked");
    expect(readiness.nextStepSummary).toBe(
      "Try again after the current OpenMeld Service task finishes."
    );
  });

  it("maps command-entry repair-failed status back to the repair command", () => {
    const readiness = resolveServiceReadinessFromServiceStatus({
      detail: "Repair failed",
      kind: "repair_failed",
    });

    expect(readiness.state).toBe("refresh_needed");
    expect(readiness.nextStepSummary).toBe(
      "OpenMeld Service needs repair. Run `openmeld setup`. If Wake or readiness still looks wrong after setup, run `openmeld service status`."
    );
  });
});
