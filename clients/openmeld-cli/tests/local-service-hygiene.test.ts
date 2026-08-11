import { describe, expect, it } from "vitest";
import { buildDaemonServiceCleanupPlan } from "../src/local-service/lifecycle/daemon-service-hygiene";
import type { DaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";

function createInventory(
  overrides: Partial<DaemonServiceInventory> = {}
): DaemonServiceInventory {
  return {
    expectedVersion: "0.1.9",
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.1.9",
        installSource: "daemon.command.install",
        installedAt: "2026-03-06T00:00:00.000Z",
        updatedAt: "2026-03-06T00:00:00.000Z",
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
    activeBundle: null,
    activeBundleSourceAvailable: null,
    activeBundleEntryPath: null,
    runtimeCommandEntryPath: null,
    runtimeCommandPathExists: null,
    serviceManager: null,
    serviceManagerStatus: null,
    ownedProcesses: [],
    lifecycleLock: null,
    legacySharedService: null,
    anomalies: [],
    ...overrides,
  };
}

describe("local service hygiene", () => {
  it("builds an auto-apply clean reinstall plan for duplicate and drift anomalies", () => {
    const plan = buildDaemonServiceCleanupPlan({
      intent: "reinstall",
      inventory: createInventory({
        anomalies: [
          {
            code: "duplicate_owned_processes",
            message:
              "Found multiple OpenMeld-owned service processes on this device.",
          },
          {
            code: "service_manager_path_drift",
            message: "OS manager points to an old CLI path.",
          },
        ],
      }),
    });

    expect(plan.autoApply).toBe(true);
    expect(plan.actions).toContain("stop_owned_processes");
    expect(plan.actions).toContain("remove_system_service_registration");
    expect(plan.actions).toContain("prepare_latest_bundle");
    expect(plan.primaryFinding).toContain(
      "multiple OpenMeld-owned service processes"
    );
    expect(plan.summary).toContain("multiple local service processes");
  });

  it("keeps cleanup finding aligned with summary priority when multiple anomalies exist", () => {
    const plan = buildDaemonServiceCleanupPlan({
      intent: "status_cleanup",
      inventory: createInventory({
        anomalies: [
          {
            code: "service_manager_path_drift",
            message: "OS manager points to an old CLI path.",
          },
          {
            code: "duplicate_owned_processes",
            message:
              "Found multiple OpenMeld-owned service processes on this device.",
          },
        ],
      }),
    });

    expect(plan.primaryFinding).toContain(
      "multiple OpenMeld-owned service processes"
    );
    expect(plan.summary).toContain("multiple local service processes");
  });

  it("requires confirmation for clean uninstall", () => {
    const plan = buildDaemonServiceCleanupPlan({
      intent: "uninstall",
      inventory: createInventory(),
    });

    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.desiredState).toBe("not_installed");
    expect(plan.actions).toContain("remove_runtime_artifacts");
    expect(plan.actions).toContain("remove_system_service_registration");
  });

  it("treats legacy linked bundles as prepare-latest repair work", () => {
    const plan = buildDaemonServiceCleanupPlan({
      intent: "status_cleanup",
      inventory: createInventory({
        anomalies: [
          {
            code: "bundle_strategy_legacy",
            message:
              "The active OpenMeld Service bundle still uses the legacy linked dependency layout.",
          },
        ],
      }),
    });

    expect(plan.actions).toContain("prepare_latest_bundle");
    expect(plan.primaryFinding).toContain("legacy linked dependency layout");
    expect(plan.summary).toContain("repair local service files");
  });

  it("treats active bundle version drift as prepare-latest repair work", () => {
    const plan = buildDaemonServiceCleanupPlan({
      intent: "status_cleanup",
      inventory: createInventory({
        anomalies: [
          {
            code: "bundle_version_drift",
            message:
              "The active OpenMeld Service bundle version is v1.0.0, but the installed service expects v0.2.0.",
          },
        ],
      }),
    });

    expect(plan.actions).toContain("prepare_latest_bundle");
    expect(plan.primaryFinding).toContain("bundle version is v1.0.0");
    expect(plan.summary).toContain("repair local service files");
  });

  it("treats bundle content drift as prepare-latest repair work", () => {
    const plan = buildDaemonServiceCleanupPlan({
      intent: "status_cleanup",
      inventory: createInventory({
        anomalies: [
          {
            code: "bundle_content_drift",
            message:
              "OpenMeld Service is using older local service files than this lane expects, so OpenMeld needs to update the service.",
          },
        ],
      }),
    });

    expect(plan.actions).toContain("prepare_latest_bundle");
    expect(plan.primaryFinding).toContain("older local service files");
    expect(plan.summary).toContain("repair local service files");
  });

  it("treats bundle ID drift as prepare-latest repair work", () => {
    const plan = buildDaemonServiceCleanupPlan({
      intent: "status_cleanup",
      inventory: createInventory({
        anomalies: [
          {
            code: "bundle_id_drift",
            message:
              "The active OpenMeld Service bundle ID is active-bundle, but the current service contract expects contract-bundle.",
          },
        ],
      }),
    });

    expect(plan.actions).toContain("prepare_latest_bundle");
    expect(plan.primaryFinding).toContain("bundle ID is active-bundle");
    expect(plan.summary).toContain("repair local service files");
  });

  it("treats lane drift and runtime bundle mismatch as prepare-latest repair work", () => {
    const plan = buildDaemonServiceCleanupPlan({
      intent: "status_cleanup",
      inventory: createInventory({
        anomalies: [
          {
            code: "bundle_lane_drift",
            message:
              "The active OpenMeld Service bundle came from repo-local workspace source, but this lane only allows published or packaged OpenMeld bundles. Use `openmeld-dev` for repo-local service validation.",
          },
          {
            code: "runtime_bundle_mismatch",
            message:
              "OpenMeld Service runtime state still points at a bundle entry file that no longer exists.",
          },
        ],
      }),
    });

    expect(plan.actions).toContain("prepare_latest_bundle");
    expect(plan.primaryFinding).toContain("runtime state still points");
    expect(plan.summary).toContain("repair local service files");
  });
});
