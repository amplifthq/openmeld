import { describe, expect, it } from "vitest";
import type { DaemonServiceRuntimeStatus } from "../src/config/daemon-state";
import type {
  DaemonServiceAnomalyCode,
  DaemonServiceInventory,
} from "../src/local-service/lifecycle/daemon-service-inventory";
import { resolveDaemonStatusAttention } from "../src/local-service/status/daemon-status-attention";

function createRuntimeStatus(
  overrides: Partial<DaemonServiceRuntimeStatus> = {}
): DaemonServiceRuntimeStatus {
  return {
    status: "running",
    mode: "foreground",
    pid: 123,
    startedAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
    managedBySystemService: false,
    serviceController: "unknown",
    autoStart: false,
    ...overrides,
  };
}

function createInventory(
  anomalyCodes: DaemonServiceAnomalyCode[]
): DaemonServiceInventory {
  return {
    expectedVersion: "0.2.0",
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.2.0",
        installSource: "daemon.command.install",
        installedAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
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
      "/Users/felix/.openmeld/runtime/daemon/bundles/current/dist/openmeld.js",
    runtimeCommandEntryPath:
      "/Users/felix/.openmeld/runtime/daemon/bundles/current/dist/openmeld.js",
    runtimeCommandPathExists: true,
    runtimeContractCompatibility: {
      expectedEpoch: "daemon-runtime-epoch-test",
      observedEpoch: "daemon-runtime-epoch-test",
      reasonCode: "daemon.runtime_contract.compatible",
      status: "compatible",
      updatedAt: "2026-03-09T00:00:00.000Z",
    },
    serviceContract: {
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "prod",
      daemonVersion: inventory.expectedVersion,
      bundleId: "daemon-bundle-test",
      desiredState: "background",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "https://openmeld.invalid",
      profileId: "human-profile-test",
      deviceId: "device-test",
      heartbeatMs: 30_000,
      generation: 1,
      updatedAt: "2026-03-09T00:00:00.000Z",
    },
  };
}

describe("local service status attention", () => {
  it("treats foreground lifecycle lock as informational and skips auto-heal", () => {
    const inventory = createInventory([
      "background_foreground_conflict",
      "lifecycle_locked",
    ]);
    const runtimeState = createRuntimeStatus();

    expect(
      resolveDaemonStatusAttention({
        inventory,
        runtimeState,
      })
    ).toMatchObject({
      level: "info",
      code: "foreground_service_active",
      anomalyCodes: ["background_foreground_conflict", "lifecycle_locked"],
    });
  });

  it("keeps repair-needed anomalies visible when a lifecycle lock is also present", () => {
    const inventory = createInventory([
      "background_foreground_conflict",
      "lifecycle_locked",
      "duplicate_owned_processes",
    ]);
    const runtimeState = createRuntimeStatus();

    expect(
      resolveDaemonStatusAttention({
        inventory,
        runtimeState,
      })
    ).toMatchObject({
      level: "warning",
      code: "service_repair_recommended",
      title: "OpenMeld Service Repair Paused",
      message:
        "Reconnect OpenMeld Service before this computer can receive local Wake work. Stop the foreground service first, then run `openmeld setup`.",
      nextStep: "Stop the foreground service first, then run `openmeld setup`.",
      anomalyCodes: [
        "duplicate_owned_processes",
        "background_foreground_conflict",
        "lifecycle_locked",
      ],
    });
  });

  it("describes lifecycle locks as plain OpenMeld Service tasks in human attention", () => {
    const inventory = createInventory(["lifecycle_locked"]);
    const runtimeState = createRuntimeStatus({
      mode: "background",
    });

    const attention = resolveDaemonStatusAttention({
      inventory,
      runtimeState,
    });

    expect(attention).toMatchObject({
      level: "info",
      code: "lifecycle_action_in_progress",
      title: "OpenMeld Service Task In Progress",
      message:
        "Another OpenMeld Service task is already running, so this status check stays read-only until it finishes.",
      nextStep:
        "Try `openmeld service status` again after the current OpenMeld Service task finishes.",
      anomalyCodes: ["lifecycle_locked"],
    });
    expect(attention?.message).not.toContain("lifecycle");
    expect(attention?.nextStep).not.toContain("lifecycle");
  });

  it("shows compatible bundle version drift as update-available attention", () => {
    const inventory = withVerifiedExecutionEvidence(
      createInventory(["bundle_version_drift"])
    );
    const runtimeState = createRuntimeStatus({
      mode: "background",
    });

    expect(
      resolveDaemonStatusAttention({
        inventory,
        runtimeState,
      })
    ).toMatchObject({
      level: "info",
      code: "service_update_available",
      title: "Update OpenMeld Service",
      message:
        "OpenMeld Service is running, but its local service bundle is not current. Update OpenMeld Service before this computer receives new local Wake work.",
      nextStep: "Run `openmeld setup` to update OpenMeld Service.",
      anomalyCodes: ["bundle_version_drift"],
    });
  });

  it("shows compatible bundle content drift as update-available attention", () => {
    const inventory = withVerifiedExecutionEvidence(
      createInventory(["bundle_content_drift"])
    );
    const runtimeState = createRuntimeStatus({
      mode: "background",
    });

    expect(
      resolveDaemonStatusAttention({
        inventory,
        runtimeState,
      })
    ).toMatchObject({
      level: "info",
      code: "service_update_available",
      anomalyCodes: ["bundle_content_drift"],
    });
  });

  it("treats artifact identity drift without safe execution evidence as repair", () => {
    const inventory = createInventory(["bundle_id_drift"]);
    const runtimeState = createRuntimeStatus({
      mode: null,
      pid: null,
      status: "not_running",
    });

    expect(
      resolveDaemonStatusAttention({
        inventory,
        runtimeState,
      })
    ).toMatchObject({
      level: "warning",
      code: "service_repair_recommended",
      title: "OpenMeld Service Needs Repair",
      anomalyCodes: ["bundle_id_drift"],
    });
  });

  it("shows update-required attention when a running service has runtime contract drift", () => {
    const inventory = createInventory(["runtime_contract_mismatch"]);
    const runtimeState = createRuntimeStatus({
      mode: "background",
    });

    const attention = resolveDaemonStatusAttention({
      inventory,
      runtimeState,
    });

    expect(attention).toMatchObject({
      level: "warning",
      code: "service_update_required",
      title: "Update OpenMeld Service",
      message:
        "OpenMeld Service is running, but this version is not safe for new Wake work. Update OpenMeld Service.",
      nextStep: "Update OpenMeld Service with `openmeld setup`.",
      anomalyCodes: ["runtime_contract_mismatch"],
    });
    expect(attention?.message).not.toContain("runtime_contract_mismatch");
    expect(attention?.message).not.toContain("epoch");
  });

  it("shows update-before-start attention when a stopped service has runtime contract drift", () => {
    const inventory = createInventory(["runtime_contract_mismatch"]);
    const runtimeState = createRuntimeStatus({
      mode: null,
      pid: null,
      status: "not_running",
    });

    const attention = resolveDaemonStatusAttention({
      inventory,
      runtimeState,
    });

    expect(attention).toMatchObject({
      level: "warning",
      code: "service_update_required",
      title: "Update OpenMeld Service",
      message: "OpenMeld Service must be updated before it can start safely.",
      nextStep: "Update OpenMeld Service with `openmeld setup`.",
      anomalyCodes: ["runtime_contract_mismatch"],
    });
  });

  it("treats bundle ID drift as repair instead of update", () => {
    const inventory = createInventory(["bundle_id_drift"]);
    const runtimeState = createRuntimeStatus({
      mode: "background",
    });

    expect(
      resolveDaemonStatusAttention({
        inventory,
        runtimeState,
      })
    ).toMatchObject({
      level: "warning",
      code: "service_repair_recommended",
      anomalyCodes: ["bundle_id_drift"],
    });
  });

  it("treats multiple active owners as a repair-needed warning", () => {
    const inventory = createInventory(["multiple_active_owners"]);
    const runtimeState = createRuntimeStatus({
      mode: "background",
    });

    expect(
      resolveDaemonStatusAttention({
        inventory,
        runtimeState,
      })
    ).toMatchObject({
      level: "warning",
      code: "service_repair_recommended",
      anomalyCodes: ["multiple_active_owners"],
    });
  });
});
